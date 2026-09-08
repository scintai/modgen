// Shared wire + storage types. No runtime code here.

export interface KVStore {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    opts?: { expirationTtl?: number },
  ): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface CloudflareBindings {
  KV: KVStore;
  /** Base URL of deployed lite.py fastapi_app, e.g. https://xxx.modal.run */
  MODAL_LITE_URL: string;
  /** Outbound key: sent as X-Api-Key to Modal (== HF_TOKEN server-side). */
  HF_TOKEN: string;
  /** Optional inbound key: if set, bot must send X-Api-Key == this. */
  MIDDLEMAN_KEY?: string;
}

// ---- Client (reddit-bot) -> modgen ----

export interface EnqueueBody {
  prompt?: unknown;
  aspectRatio?: unknown;
  aspect_ratio?: unknown;
  uid?: unknown;
}

// ---- Modgen KV record (key = `offload:{uid}`) ----

export type JobStatus =
  | "queued"
  | "started"
  | "pending"
  | "success"
  | "error";

export interface JobRecord {
  uid: string;
  /** int sent to Modal as offload_id (Modal requires int). */
  modalId: number;
  prompt: string;
  aspectRatio: string;
  mappedRatio: string;
  status: JobStatus;
  image_b64?: string | null;
  image_format?: string | null;
  seed?: number | null;
  width?: number | null;
  height?: number | null;
  error?: string | null;
  error_code?: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
}

// ---- Modgen -> Modal (lite.py) ----

export interface ModalAsyncPayload {
  offload_id: number;
  request: {
    prompt: string;
    negative_prompt: string;
    aspect_ratio: string;
  };
}

export type ModalResult =
  | { status: "pending" }
  | { status: "queued" }
  | { status: "started"; started_at?: number | string | null }
  | {
      status: "success";
      image?: string | null;
      image_b64?: string | null;
      image_format?: string | null;
      seed?: number | null;
      width?: number | null;
      height?: number | null;
      started_at?: number | string | null;
      updated_at?: number | string | null;
      error?: string | null;
    }
  | { status: "error"; error?: string | null; error_code?: string | null };

// ---- Modgen -> client responses ----

export interface EnqueueResponse {
  uid: string;
  modalId: number;
  status: JobStatus;
  mappedRatio: string;
}

export interface PollResponse {
  uid: string;
  modalId: number;
  status: JobStatus;
  image_b64?: string | null;
  image_format?: string | null;
  seed?: number | null;
  width?: number | null;
  height?: number | null;
  error?: string | null;
  error_code?: string | null;
  createdAt: string;
  updatedAt: string;
}
