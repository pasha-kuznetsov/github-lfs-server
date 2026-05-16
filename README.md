# github-lfs-server

A [Git LFS](https://git-lfs.com/) server running as a Cloudflare Worker. Stores objects in Cloudflare R2, authenticates via GitHub OAuth, and supports [file locking](https://github.com/git-lfs/git-lfs/wiki/File-Locking).

## Setup

### 1. Generate `wrangler.jsonc`

Create a `vars.json` file in the repository root (gitignored), for example:

```json
{
  "cloudflare-account-id": "<your-cloudflare-account-id>",
  "github-org": "<your-github-org>"
}
```

Install dependencies and run `scripts/run.sh` to create (gitignored) `wrangler.jsonc`:

```sh
bun install
scripts/run.sh create-wrangler-json
```

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

Locally (after `vars.json` exists and secrets are set):

```sh
bun install
bun run deploy
```

For **GitHub Actions** (`workflow_dispatch` in `.github/workflows/deploy.yml`), set a repository variable **`VARS_JSON`** to the same JSON you would put in `vars.json`. The workflow writes it to `vars.json` before rendering `wrangler.jsonc`.

## Development

```sh
bun run dev
```

## Test

```sh
bun run test
```
