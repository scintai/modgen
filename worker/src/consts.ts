// Central constants for the modgen worker.
// Sources:
// - aspect map + negative prompt copied from scint/src/lib/scint-lite.ts
// - Modal bucket list copied from modal-deployment/stableyogi/lite.py ASPECT_RATIOS
// - prompt prefix copied from scint/src/app/api/lite/route.ts (payloadBody.prompt)

export const DEFAULT_ASPECT_INBOUND = "9:16";
export const DEFAULT_MAPPED_RATIO = "f-9:16";

// What the reddit-bot is allowed to send (src/type.ts AspectRatio + lenient extras).
export const SUPPORTED_INBOUND_ASPECTS = [
  "1:1",
  "9:16",
  "16:9",
  "4:3",
  "3:4",
  "2:3",
  "3:2",
  "4:5",
  "5:4",
] as const;

// UI aspect -> Modal `f-` fast bucket (scint-lite.ts:16-24).
export const SCINT_LITE_ASPECT_MAP: Record<string, string> = {
  "1:1": "f-1:1",
  "3:4": "f-3:4",
  "9:16": "f-9:16",
  "16:9": "f-16:9",
  "2:3": "f-2:3",
  "3:2": "f-3:2",
  "4:3": "f-4:3",
};

// Full allow-list of Modal aspect_ratio values (lite.py:74-86).
export const MODAL_ASPECTS = new Set([
  "1:1",
  "2:3",
  "3:2",
  "4:3",
  "3:4",
  "9:16",
  "16:9",
  "9:21",
  "21:9",
  "f-1:1",
  "f-2:3",
  "f-3:2",
  "f-4:3",
  "f-3:4",
  "f-9:16",
  "f-16:9",
  "f-9:21",
  "f-21:9",
]);

export const SCINT_LITE_NEGATIVE_PROMPT =
  "lowres, worst quality, low quality, blurry, jpeg artifacts, " +
  "bad anatomy, deformed anatomy, malformed anatomy, " +
  "fused limbs, merged limbs, fused body parts, merged body parts, " +
  "melting body, melted body parts, warped limbs, twisted limbs, " +
  "extra limbs, missing limbs, duplicate limbs, " +
  "bad hands, malformed hands, fused fingers, extra fingers, missing fingers, " +
  "bad feet, malformed feet, " +
  "text, watermark, signature, username, cropped";

// Prefix applied to every prompt before queueing (lite/route.ts:260).
export const PROMPT_PREFIX =
  "raw photo, sharp focus, photorealistic, 1girl, realistic skin texture";

// ---- KV ----
export const KV_PREFIX = "offload:";
export const KV_TTL_SECONDS = 60 * 60 * 24; // 24h — auto-evict finished jobs
export const KV_PENDING_TTL_SECONDS = 60 * 60 * 6; // 6h for non-terminal records

// ---- Modal wire ----
export const MODAL_ASYNC_PATH = "/lite-async";
export const MODAL_RESULTS_PATH = "/lite-results";
export const MODAL_CLEAR_PATH = "/lite-results/clear";
export const MODAL_FETCH_TIMEOUT_MS = 15_000;

// ---- Validation limits ----
export const MAX_PROMPT_LENGTH = 2000;
export const MAX_UID_LENGTH = 128;
// Reddit post ids look like `t3_abc123`; allow generic safe uid chars.
export const UID_REGEX = /^[A-Za-z0-9:_.-]{1,128}$/;
