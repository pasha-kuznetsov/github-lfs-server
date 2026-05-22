# Git LFS Hub — server

The Cloudflare Worker at the heart of [Git LFS Hub](https://github.com/git-lfs-hub) — a [Hono](https://hono.dev/) app implementing the full [Git LFS](https://git-lfs.com/) batch API, GitHub OAuth (web + device flow), presigned R2 URLs for object transfer, and a Durable Object lock store for [file locking](https://github.com/git-lfs/git-lfs/wiki/File-Locking).

For the bigger picture (what the stack does, the deploy flow, the other repos) see the [org overview](https://github.com/git-lfs-hub).

## Setup and Deployment

To stand up an instance, start at [git-lfs-hub/deploy](https://github.com/git-lfs-hub/deploy) — it consumes this repo as a submodule and wires it up with config, docs, and CI. Use this repo directly only if you want the Worker source standalone and intend to manage Wrangler config + static assets yourself (see [Standalone development](#standalone-development) below).

## Architecture

**Entry:** `src/index.ts` → `src/app.ts`

**Route structure:**

LFS API

- **`/:owner/:repo/objects/*`** — LFS batch API; issues presigned R2 URLs; `lfs/objects.ts`.
- **`/:owner/:repo/locks/*`** — LFS file locking (Durable Object); `lfs/locks.ts`.

Authentication

- **`/login/device`** — GitHub device flow (`gh`, `git-credential-manager`); `login/device.ts`.
- **`/login/oauth`** — GitHub web OAuth + token exchange; `login/oauth.ts`, `login/oauth-token.ts`.
- **`/api/*`** — GitHub API proxy (device flow polling); `login/github-proxy.ts`.

Docs

- **`/*`** — Static docs site (behind web auth); served via `ASSETS` binding.

**Bindings:**

- **`LFS_BUCKET`** (R2) — LFS object storage.
- **`LOCKS`** (Durable Object, SQLite) — File lock state.
- **`ASSETS`** (Static assets) — Docs site.

Objects are transferred via presigned R2 URLs -- the Worker issues URLs but does not proxy object data. Auth uses GitHub OAuth (web + device flow) with JWT session tokens; access is gated by org membership and/or GitHub login allowlist. Sentry is loaded lazily if `SENTRY_DSN` is set.

## Development

### Deploy repo pipeline

In **[git-lfs-hub/deploy](https://github.com/git-lfs-hub/deploy)**, `bun run config` (Turbo task `//#config`) renders `wrangler.jsonc` and `worker-configuration.d.ts` at the repo root, symlinks them into `server/`, and points `server/public/` at the docs build output. Run `turbo dev`, `turbo build`, or `turbo deploy` from the monorepo root so docs, config, and the Worker stay in sync — `@git-lfs-hub/server#{build,test,deploy}` all depend on `@git-lfs-hub/docs#build`, which itself depends on `//#config`.

### Standalone development

Use this when you work from **[git-lfs-hub/server](https://github.com/git-lfs-hub/server)** only. Keep local `wrangler.jsonc`, `worker-configuration.d.ts`, `vars.json`, and a `public/` tree (built docs or a minimal static site)—the deploy checkout normally supplies these via symlinks. Configure Wrangler secrets and R2 bindings for your account, then:

```sh
bun install
bun run dev       # wrangler dev — local Worker
bun run test      # vitest (unit + integration via @cloudflare/vitest-pool-workers)
bun run types     # regenerate worker-configuration.d.ts after changing wrangler.jsonc bindings
```

### Standalone deployment

With Cloudflare auth in place (`wrangler login` or `CLOUDFLARE_API_TOKEN`) and secrets applied (`wrangler secret put` for GitHub OAuth, R2 keys, `LOGIN_SECRET`, etc.), `bun run deploy` ships the Worker from this package. You own `public/` and binding definitions. Full releases that rebuild docs, render `vars`, and deploy in one step use **[git-lfs-hub/deploy](https://github.com/git-lfs-hub/deploy)** (`turbo deploy`).
