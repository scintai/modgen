# Modgen API

Public endpoint documentation for the modgen worker
(`https://modgen.scintai.com`). This repo is open source so reviewers
and users can verify exactly what happens to a prompt.

Base URL: `https://modgen.scintai.com`

## Auth

All `/api/*` routes require `X-Api-Key: <MODGEN_KEY>` when the worker
has the key set (production does). Health (`GET /`) is open.

## Endpoints

### `GET /` — health (open)

```json
{ "status": "ok", "service": "modgen", "endpoints": { "...": "..." } }
```

### `POST /api/offload/scintai` — enqueue

Request (JSON):

```json
{ "prompt": "a portrait of a cat", "aspectRatio": "9:16", "uid": "t3_abc123" }
```

- `prompt`: 1–2000 chars. `aspectRatio`: `1:1|9:16|16:9|4:3|3:4|2:3|3:2` (unknown → `9:16`).
- `uid`: caller-chosen id, `[A-Za-z0-9:_.-]{1,128}`. Re-enqueueing the same `uid` never queues twice (idempotent).

Responses:

- `202 { "uid", "modalId", "status": "queued", "mappedRatio": "f-9:16" }` — accepted, GPU job spawned.
- `200 { ..., "deduped": true }` — this `uid` was already queued.
- `400` bad input · `401` bad key · `502` GPU queue unreachable.

### `GET /api/offload/scintai/:uid` — poll one

- Terminal (`success`/`error`) answers come straight from cache — no GPU hit.
- Otherwise the worker live-checks the GPU and updates the record.
- `success` includes `image_b64` (webp, base64) + `seed/width/height`.
- `404 { "error": "unknown uid" }` for never-seen ids.

`status` is one of `queued | started | pending | success | error`.

### `POST /api/offload/scintai/results` — poll many

```json
{ "uids": ["t3_aaa", "t3_bbb"] }
```

Max 50. Returns `{ "results": { "<uid>": { ...same shape as single poll... } } }`.
Unknown uids are omitted.

### `DELETE /api/offload/scintai/:uid` — purge

Deletes the stored record immediately and tells the GPU to drop its
queue entry. Called automatically when a Reddit post/comment is deleted.

## Data & retention

| What                  | Where              | Why                               | Dies when                              |
| --------------------- | ------------------ | --------------------------------- | -------------------------------------- |
| Prompt + aspect       | Worker KV          | Needed to run + deliver the job   | ~6h pending / ~24h finished, auto      |
| Finished image (b64)  | Worker KV          | Bot collects it by polling later  | On delivery, or ~24h, or on purge      |
| GPU queue entry       | Modal Dict         | In-flight job state               | Cleared right after delivery           |
| Daily counter (int)   | Reddit's own Redis | Per-user rate limiting            | Auto-expires (~2 days), never leaves Reddit |

Never stored, anywhere: usernames, profiles, post bodies beyond the
rendered prompt, history, analytics, DMs. Prompts are never used for training.
