## Configure

```
S3_ENDPOINT = https://<your-account-id>.r2.cloudflarestorage.com
S3_BUCKET_NAME = lfs-objects
S3_PRESIGN_TTL = 3600
```

Generating CloudFlare R2 Account API token:
* Account dashboard
* R2 (_not_ Manage account)
* API tokens
* Create an API token
  * Object Read & Write
  * Specify bucket(s): <S3_BUCKET_NAME> above

```sh
wrangler secret put S3_ACCESS_KEY_ID        # <Cloudflare R2 Access Key ID>
wrangler secret put S3_SECRET_ACCESS_KEY    # <Cloudflare R2 Secret Access Key>
```

## Authentication GitHub App

1. Register a GitHub OAuth App at https://github.com/settings/applications/new:
  - Application name: anything (e.g. github-lfs-server)
  - Homepage URL: https://<your-worker-domain>
  - Authorization callback URL: https://<your-worker-domain>/login/oauth/callback
2. Set the secrets (run from this repo):
```sh
wrangler secret put GITHUB_CLIENT_ID       # paste the Client ID from GitHub
wrangler secret put GITHUB_CLIENT_SECRET   # paste the Client Secret from GitHub
wrangler secret put LOGIN_SECRET           # run: openssl rand -hex 32
```

## Deploy

```sh
bun deploy
```

## Develop

```txt
bun install
bun run dev
```

[For generating/synchronizing types based on your Worker configuration run](https://developers.cloudflare.com/workers/wrangler/commands/#types):

```txt
bun run cf-typegen
```

Pass the `CloudflareBindings` as generics when instantiation `Hono`:

```ts
// src/index.ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```
