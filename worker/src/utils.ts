import {
  DEFAULT_MAPPED_RATIO,
  KV_PENDING_TTL_SECONDS,
  KV_PREFIX,
  KV_TTL_SECONDS,
  MAX_PROMPT_LENGTH,
  MODAL_ASPECTS,
  MODAL_ASYNC_PATH,
  MODAL_CLEAR_PATH,
  MODAL_FETCH_TIMEOUT_MS,
  MODAL_RESULTS_PATH,
  PROMPT_PREFIX,
  SCINT_LITE_ASPECT_MAP,
  SCINT_LITE_NEGATIVE_PROMPT,
  UID_REGEX,
} from "./consts.js";
import type {
  EnqueueBody,
  JobRecord,
  JobStatus,
  KVStore,
  ModalAsyncPayload,
  ModalResult,
  PollResponse,
} from "./types.js";

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, "");
}

/** UI aspect (e.g. "16:9") -> Modal fast bucket (e.g. "f-16:9"). Never throws. */
export function mapAspectRatio(inbound: unknown): {
  aspectRatio: string;
  mappedRatio: string;
} {
  const raw = typeof inbound === "string" ? inbound.trim() : "";
  // Lite fast bucket first: "16:9" -> "f-16:9" (matches Next.js
  // SCINT_LITE_ASPECT_RATIOS[aspect] ?? default). Raw Modal check comes
  // second so explicit "f-16:9" still passes through untouched.
  if (raw && SCINT_LITE_ASPECT_MAP[raw]) {
    return { aspectRatio: raw, mappedRatio: SCINT_LITE_ASPECT_MAP[raw] };
  }
  if (raw && MODAL_ASPECTS.has(raw)) return { aspectRatio: raw, mappedRatio: raw };
  if (raw && MODAL_ASPECTS.has(`f-${raw}`)) {
    return { aspectRatio: raw, mappedRatio: `f-${raw}` };
  }
  return { aspectRatio: raw || "9:16", mappedRatio: DEFAULT_MAPPED_RATIO };
}

export function buildModalPrompt(prompt: string): string {
  if (prompt.startsWith(PROMPT_PREFIX)) return prompt;
  return `${PROMPT_PREFIX}, ${prompt}`;
}

export function buildModalPayload(
  modalId: number,
  prompt: string,
  mappedRatio: string,
): ModalAsyncPayload {
  return {
    offload_id: modalId,
    request: {
      prompt: buildModalPrompt(prompt),
      negative_prompt: SCINT_LITE_NEGATIVE_PROMPT,
      aspect_ratio: mappedRatio,
    },
  };
}

/**
 * Deterministic string -> positive 31-bit int for Modal `offload_id`.
 * Same uid always yields same modalId (idempotent retries safe).
 * FNV-1a 32-bit, masked to [1, 2^31-1].
 */
export function uidToModalId(uid: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < uid.length; i++) {
    hash ^= uid.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const masked = (hash >>> 0) & 0x7fffffff;
  return masked === 0 ? 1 : masked;
}

export function kvKey(uid: string): string {
  return `${KV_PREFIX}${uid}`;
}

export async function kvGet(
  kv: KVStore,
  uid: string,
): Promise<JobRecord | null> {
  const raw = await kv.get(kvKey(uid));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as JobRecord;
  } catch {
    return null;
  }
}

export async function kvPut(kv: KVStore, record: JobRecord): Promise<void> {
  const ttl = isTerminal(record.status) ? KV_TTL_SECONDS : KV_PENDING_TTL_SECONDS;
  await kv.put(kvKey(record.uid), JSON.stringify(record), {
    expirationTtl: ttl,
  });
}

export function isTerminal(status: JobStatus): boolean {
  return status === "success" || status === "error";
}

export interface ParsedEnqueue {
  prompt: string;
  aspectRatio: string;
  mappedRatio: string;
  uid: string;
}

/** Throws Error on invalid prompt/uid; aspect falls back to default. */
export function parseEnqueueBody(body: EnqueueBody): ParsedEnqueue {
  const promptRaw = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!promptRaw) throw new Error("Prompt is required");
  if (promptRaw.length > MAX_PROMPT_LENGTH) {
    throw new Error(`Prompt too long (max ${MAX_PROMPT_LENGTH} chars)`);
  }
  const uidRaw = typeof body.uid === "string" ? body.uid.trim() : "";
  if (!uidRaw) throw new Error("uid is required");
  if (!UID_REGEX.test(uidRaw)) throw new Error("uid has invalid format");

  const aspectIn =
    typeof body.aspectRatio === "string"
      ? body.aspectRatio
      : typeof body.aspect_ratio === "string"
        ? body.aspect_ratio
        : "9:16";
  const { aspectRatio, mappedRatio } = mapAspectRatio(aspectIn);
  return { prompt: promptRaw, aspectRatio, mappedRatio, uid: uidRaw };
}

async function modalFetch(
  url: string,
  apiKey: string,
  body: unknown,
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MODAL_FETCH_TIMEOUT_MS),
  });
}

export async function postModalAsync(
  baseUrl: string,
  apiKey: string,
  payload: ModalAsyncPayload,
): Promise<void> {
  const res = await modalFetch(
    `${normalizeBaseUrl(baseUrl)}${MODAL_ASYNC_PATH}`,
    apiKey,
    payload,
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Modal queue rejected (${res.status}): ${text.slice(0, 300)}`);
  }
}

export async function postModalResults(
  baseUrl: string,
  apiKey: string,
  ids: number[],
): Promise<Record<string, ModalResult>> {
  const res = await modalFetch(
    `${normalizeBaseUrl(baseUrl)}${MODAL_RESULTS_PATH}`,
    apiKey,
    { ids },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Modal results fetch failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as { results?: Record<string, ModalResult> };
  return data.results ?? {};
}

/** Best-effort clear; never throws (called via ctx.waitUntil). */
export async function postModalClear(
  baseUrl: string,
  apiKey: string,
  ids: number[],
): Promise<void> {
  if (ids.length === 0) return;
  try {
    await modalFetch(`${normalizeBaseUrl(baseUrl)}${MODAL_CLEAR_PATH}`, apiKey, {
      ids,
    });
  } catch (err) {
    console.error("[modgen] modal clear failed:", err);
  }
}

export function toPollResponse(r: JobRecord): PollResponse {
  return {
    uid: r.uid,
    modalId: r.modalId,
    status: r.status,
    image_b64: r.image_b64 ?? null,
    image_format: r.image_format ?? null,
    seed: r.seed ?? null,
    width: r.width ?? null,
    height: r.height ?? null,
    error: r.error ?? null,
    error_code: r.error_code ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Merge a Modal result into our stored record. Returns true if terminal. */
export function applyModalResult(
  record: JobRecord,
  result: ModalResult | undefined,
): JobRecord {
  const now = new Date().toISOString();
  if (!result || result.status === "pending") {
    return { ...record, status: "pending", updatedAt: now };
  }
  if (result.status === "queued" || result.status === "started") {
    return {
      ...record,
      status: result.status,
      startedAt:
        result.status === "started" && "started_at" in result && result.started_at != null
          ? String(result.started_at)
          : (record.startedAt ?? now),
      updatedAt: now,
    };
  }
  if (result.status === "error") {
    return {
      ...record,
      status: "error",
      error: result.error ?? "Generation failed",
      error_code: result.error_code ?? "GENERATION_FAILED",
      updatedAt: now,
    };
  }
  // success — keep b64 verbatim (1-4MB, under KV 25MB limit)
  return {
    ...record,
    status: "success",
    image_b64: result.image_b64 ?? result.image ?? null,
    image_format: result.image_format ?? "webp",
    seed: result.seed ?? null,
    width: result.width ?? null,
    height: result.height ?? null,
    error: null,
    error_code: null,
    updatedAt: now,
  };
}
