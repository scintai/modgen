import { Hono } from "hono";
import { cors } from "hono/cors";
import type { CloudflareBindings, JobRecord } from "./types.js";
import {
  applyModalResult,
  buildModalPayload,
  isTerminal,
  kvGet,
  kvKey,
  kvPut,
  parseEnqueueBody,
  postModalAsync,
  postModalClear,
  postModalResults,
  toPollResponse,
  uidToModalId,
} from "./utils.js";

const app = new Hono<{ Bindings: CloudflareBindings }>();

app.use("/api/*", cors());

// Optional inbound auth: if the MIDDLEMAN_KEY secret is set, the caller
// (reddit-bot) must send it as X-Api-Key. Unset = open (dev only).
app.use("/api/*", async (c, next) => {
  const key = c.env.MIDDLEMAN_KEY;
  if (key && c.req.header("X-Api-Key") !== key) {
    console.warn("[modgen] unauthorized", c.req.path);
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

function requireConfig(env: CloudflareBindings): string {
  if (!env.MODAL_LITE_URL) throw new Error("MODAL_LITE_URL is not configured");
  if (!env.HF_TOKEN) throw new Error("HF_TOKEN is not configured");
  return env.MODAL_LITE_URL;
}

app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "modgen",
    endpoints: {
      "POST /api/offload/scintai": "enqueue {prompt, aspectRatio, uid}",
      "GET /api/offload/scintai/:uid": "lazy-poll single job (live Modal proxy)",
      "POST /api/offload/scintai/results": "batch poll {uids: string[]}",
      "DELETE /api/offload/scintai/:uid": "purge KV record",
    },
  });
});

// ---- Enqueue: bot sends {prompt, aspectRatio, uid}, gets id back instantly ----
app.post("/api/offload/scintai", async (c) => {
  let baseUrl: string;
  try {
    baseUrl = requireConfig(c.env);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  let parsed;
  try {
    parsed = parseEnqueueBody((body ?? {}) as Record<string, unknown>);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
  const { prompt, aspectRatio, mappedRatio, uid } = parsed;
  console.log("[modgen] enqueue received", JSON.stringify({ uid, aspectRatio, mappedRatio }));

  // Idempotency: same uid (postId) never queues twice.
  const existing = await kvGet(c.env.KV, uid).catch(() => null);
  if (existing) {
    console.log("[modgen] enqueue deduped", JSON.stringify({ uid, modalId: existing.modalId, status: existing.status }));
    return c.json(
      {
        uid: existing.uid,
        modalId: existing.modalId,
        status: existing.status,
        mappedRatio: existing.mappedRatio,
        deduped: true,
      },
      200,
    );
  }

  const modalId = uidToModalId(uid);
  const now = new Date().toISOString();
  const record: JobRecord = {
    uid,
    modalId,
    prompt,
    aspectRatio,
    mappedRatio,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    startedAt: null,
  };
  await kvPut(c.env.KV, record);

  try {
    await postModalAsync(
      baseUrl,
      c.env.HF_TOKEN,
      buildModalPayload(modalId, prompt, mappedRatio),
    );
  } catch (err) {
    const failed: JobRecord = {
      ...record,
      status: "error",
      error: (err as Error).message,
      error_code: "QUEUE_FAILED",
      updatedAt: new Date().toISOString(),
    };
    await kvPut(c.env.KV, failed);
    console.error("[modgen] enqueue failed", JSON.stringify({ uid, modalId, error: (err as Error).message }));
    return c.json(
      { uid, modalId, status: "error", error: (err as Error).message },
      502,
    );
  }

  console.log("[modgen] enqueue accepted", JSON.stringify({ uid, modalId }));
  return c.json({ uid, modalId, status: "queued", mappedRatio }, 202);
});

// ---- Batch poll (mirrors Modal {ids} shape, but keyed by our uid) ----
app.post("/api/offload/scintai/results", async (c) => {
  let baseUrl: string;
  try {
    baseUrl = requireConfig(c.env);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }

  let body: { uids?: unknown } | null = null;
  try {
    body = (await c.req.json()) as { uids?: unknown };
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const uids = Array.isArray(body?.uids) ? (body.uids as unknown[]) : null;
  if (!uids || uids.length === 0 || uids.length > 50) {
    return c.json({ error: "uids must be a non-empty array (max 50)" }, 400);
  }

  const results: Record<string, ReturnType<typeof toPollResponse>> = {};
  const toFetch: JobRecord[] = [];
  for (const u of uids) {
    if (typeof u !== "string") continue;
    const rec = await kvGet(c.env.KV, u).catch(() => null);
    if (!rec) {
      continue; // unknown uid omitted; single-GET returns 404 for these
    }
    if (isTerminal(rec.status)) {
      results[rec.uid] = toPollResponse(rec);
    } else {
      toFetch.push(rec);
    }
  }

  if (toFetch.length > 0) {
    try {
      const modal = await postModalResults(
        baseUrl,
        c.env.HF_TOKEN,
        toFetch.map((r) => r.modalId),
      );
      const clearIds: number[] = [];
      let terminal = 0;
      for (const rec of toFetch) {
        const updated = applyModalResult(rec, modal[String(rec.modalId)]);
        await kvPut(c.env.KV, updated);
        results[updated.uid] = toPollResponse(updated);
        if (isTerminal(updated.status)) {
          clearIds.push(updated.modalId);
          terminal++;
        } else if (updated.status !== rec.status) {
          console.log("[modgen] batch transition", JSON.stringify({ uid: updated.uid, from: rec.status, to: updated.status }));
        }
      }
      console.log("[modgen] batch poll", JSON.stringify({ fetched: toFetch.length, terminal }));
      if (clearIds.length > 0) {
        c.executionCtx.waitUntil(postModalClear(baseUrl, c.env.HF_TOKEN, clearIds));
      }
    } catch (err) {
      console.error("[modgen] batch poll modal fetch failed", JSON.stringify({ count: toFetch.length, error: (err as Error).message }));
      for (const rec of toFetch) results[rec.uid] = toPollResponse(rec); // stale
    }
  }

  return c.json({ results });
});

// ---- Single poll: cached terminal, else live-proxy Modal ----
app.get("/api/offload/scintai/:uid", async (c) => {
  let baseUrl: string;
  try {
    baseUrl = requireConfig(c.env);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }

  const uid = c.req.param("uid");
  const record = await kvGet(c.env.KV, uid).catch(() => null);
  if (!record) return c.json({ error: "unknown uid" }, 404);
  if (isTerminal(record.status)) return c.json(toPollResponse(record));

  try {
    const modal = await postModalResults(baseUrl, c.env.HF_TOKEN, [
      record.modalId,
    ]);
    const updated = applyModalResult(record, modal[String(record.modalId)]);
    await kvPut(c.env.KV, updated);
    if (updated.status !== record.status) {
      console.log("[modgen] poll transition", JSON.stringify({ uid, from: record.status, to: updated.status }));
    }
    if (isTerminal(updated.status)) {
      // Free the Modal Dict entry (same contract as Next.js lite-sync clear).
      c.executionCtx.waitUntil(
        postModalClear(baseUrl, c.env.HF_TOKEN, [updated.modalId]),
      );
    }
    return c.json(toPollResponse(updated));
  } catch (err) {
    console.error("[modgen] poll modal fetch failed", JSON.stringify({ uid, error: (err as Error).message }));
    return c.json(toPollResponse(record)); // stale but retryable
  }
});

app.delete("/api/offload/scintai/:uid", async (c) => {
  const uid = c.req.param("uid");
  const record = await kvGet(c.env.KV, uid).catch(() => null);
  await c.env.KV.delete(kvKey(uid)).catch(() => null);
  if (record && c.env.MODAL_LITE_URL && c.env.HF_TOKEN) {
    c.executionCtx.waitUntil(
      postModalClear(c.env.MODAL_LITE_URL, c.env.HF_TOKEN, [record.modalId]),
    );
  }
  return c.json({ deleted: Boolean(record), uid });
});

export default app;
