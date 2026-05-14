# github-lfs-server

A [Git LFS](https://git-lfs.com/) server running as a Cloudflare Worker. Stores objects in Cloudflare R2, authenticates via GitHub OAuth, and supports [file locking](https://github.com/git-lfs/git-lfs/wiki/File-Locking).

## Setup

### 1. Copy the example config

```sh
cp wrangler.jsonc.example wrangler.jsonc
```

Edit `wrangler.jsonc` and fill in:
- `S3_ENDPOINT` — `https://<your-account-id>.r2.cloudflarestorage.com`
- `S3_BUCKET_NAME` — your R2 bucket name
- `GITHUB_APP_HOME` — your worker URL
- `GITHUB_ORG` — your GitHub org

### 2. Create an R2 API token

- Account dashboard → R2 (not _Manage account_) → API tokens → Create API token
  - Permissions: Object Read & Write
  - Scope: the bucket named in `S3_BUCKET_NAME`

```sh
wrangler secret put S3_ACCESS_KEY_ID      # R2 Access Key ID
wrangler secret put S3_SECRET_ACCESS_KEY  # R2 Secret Access Key
```

### 3. Register a GitHub OAuth App

Go to https://github.com/settings/applications/new:
- **Homepage URL**: `https://<your-worker-domain>`
- **Authorization callback URL**: `https://<your-worker-domain>/login/oauth/callback`

```sh
wrangler secret put GITHUB_CLIENT_ID      # Client ID from GitHub
wrangler secret put GITHUB_CLIENT_SECRET  # Client Secret from GitHub
wrangler secret put LOGIN_SECRET          # run: openssl rand -hex 32
```

## Deploy

```sh
bun install
bun run deploy
```

## Development

```sh
bun run dev
```

## Test

```sh
bun run test
```
