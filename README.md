# Git LFS Hub Server

A [Git LFS](https://git-lfs.com/) server running as a Cloudflare Worker. Stores objects in Cloudflare R2, authenticates via GitHub OAuth, and supports the full Git LFS API including [file locking](https://github.com/git-lfs/git-lfs/wiki/File-Locking).

## Setup and Deployment

See [git-lfs-hub/deploy](https://github.com/git-lfs-hub/deploy).

## Architecture

**Entry:** `src/index.ts` → `src/app.ts`

**Route structure:**

| Path | Handler | Description |
|------|---------|-------------|
| `/login/device` | `login/device.ts` | GitHub device flow (`gh`, `git-credential-manager`) |
| `/login/oauth` | `login/oauth.ts`, `login/oauth-token.ts` | GitHub web OAuth + token exchange |
| `/api/*` | `login/github-proxy.ts` | GitHub API proxy (device flow polling) |
| `/:owner/:repo/objects/*` | `lfs/objects.ts` | LFS batch API — issues presigned R2 URLs |
| `/:owner/:repo/locks/*` | `lfs/locks.ts` | LFS file locking (Durable Object) |
| `/*` | ASSETS binding | Static docs site, behind web auth |

**Bindings:**

| Binding | Type | Purpose |
|---------|------|---------|
| `LFS_BUCKET` | R2 | LFS object storage |
| `LOCKS` | Durable Object (SQLite) | File lock state |
| `ASSETS` | Static assets | Docs site |

Objects are transferred via presigned R2 URLs -- the Worker issues URLs but does not proxy object data. Auth uses GitHub OAuth (web + device flow) with JWT session tokens; access is gated by org membership and/or GitHub login allowlist. Sentry is loaded lazily if `SENTRY_DSN` is set.

## Development

### Deploy repo pipeline

In **git-lfs-hub/deploy**, `turbo init` renders `wrangler.jsonc` and related files at the repo root; `sync-server` symlinks them into `server/` and points `public/` at the docs build output. Run `turbo dev`, `turbo build`, or `turbo deploy` from the monorepo root so docs, config, and the Worker stay in sync (see [git-lfs-hub/deploy](https://github.com/git-lfs-hub/deploy)).

### Standalone development

Use this when you work from **git-lfs-hub/server** only. Keep local `wrangler.jsonc`, `worker-configuration.d.ts`, `vars.json`, and a `public/` tree (built docs or a minimal static site)—the deploy checkout normally supplies these via symlinks. Configure Wrangler secrets and R2 bindings for your account, then:

```sh
bun install
bun run dev       # wrangler dev — local Worker
bun run test      # vitest (unit + integration via @cloudflare/vitest-pool-workers)
bun run types     # regenerate worker-configuration.d.ts after changing wrangler.jsonc bindings
```

### Standalone deployment

With Cloudflare auth in place (`wrangler login` or `CLOUDFLARE_API_TOKEN`) and secrets applied (`wrangler secret put` for GitHub OAuth, R2 keys, `LOGIN_SECRET`, etc.), `bun run deploy` ships the Worker from this package. You own `public/` and binding definitions. Full releases that rebuild docs, render `vars`, and deploy in one step use **git-lfs-hub/deploy** (`turbo deploy`).
