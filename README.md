# scintai-mono

pnpm workspace with two independent apps. Each tool runs inside its own
folder, so they never interfere with each other.

```
.
├── worker/               # Cloudflare Worker (Hono) — image-job queue
│   ├── src/              # routes in index.ts, types.ts, utils.ts, consts.ts
│   ├── wrangler.jsonc    # Worker config (name, KV, LITE_URL)
│   └── .env.example      # copy to .dev.vars for local dev
└── scintai-reddit-mod/   # Devvit app (Reddit bot) — queue client
    ├── src/main.ts       # PostCreate trigger + scheduler jobs
    └── devvit.json       # Devvit config
```

## Commands (run from repo root)

```txt
pnpm install

pnpm dev:worker        # wrangler dev (Cloudflare, CLI auth via `wrangler login`)
pnpm deploy:worker     # wrangler deploy --minify
pnpm typecheck:worker

pnpm dev:reddit        # devvit playtest (Reddit, auth via `devvit login`)
pnpm upload:reddit     # devvit upload — publishes the bot, touches nothing else
pnpm typecheck:reddit

pnpm typecheck          # both
```

Worker secrets (never in git): `wrangler secret put HF_TOKEN`
(optional `wrangler secret put MIDDLEMAN_KEY`), run from `worker/`.
