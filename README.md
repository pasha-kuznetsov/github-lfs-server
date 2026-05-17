# github-lfs-server

A [Git LFS](https://git-lfs.com/) server running as a Cloudflare Worker. Stores objects in Cloudflare R2, authenticates via GitHub OAuth, and supports [file locking](https://github.com/git-lfs/git-lfs/wiki/File-Locking).

## Setup

### 0. Install Dependencies and create `vars.json`

Install dependencies:

```sh
bun install
```

Create a `vars.json` file in the repository root (gitignored), for example:

```json
{
  "org-name": "<user-friendly-name>",
  "github-org": "<your-github-org>",
  "cloudflare-account-slug": "<cloudflare-account-slug>",
  "cloudflare-account-id": "<your-cloudflare-account-id>"
}
```

* `cloudflare-account-slug` affects worker URLs (`GITHUB_APP_HOME`)
* `cloudflare-account-affects` affects R2 bucket URLs (`S3_ENDPOINT`)

### 1. Generate deployment files

Generate (gitignored) `wrangler.jsonc` and `github-app.md` from `wrangler.template.jsonc` and `github-app.template.md`:

```sh
scripts/run.sh prepare-deployment
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

Follow the generated **`github-app.md`** (from **`github-app.template.md`**) to register your GitHub OAuth app.

```sh
wrangler secret put GITHUB_CLIENT_ID      # Client ID from GitHub
wrangler secret put GITHUB_CLIENT_SECRET  # Client Secret from GitHub
wrangler secret put LOGIN_SECRET          # run: openssl rand -hex 32
```

## Deploy

### Locally

After `vars.json` exists and secrets are set:

```sh
bun run deploy
```

### GitHub Actions

* Set a repository variable **`VARS_JSON`** to your `vars.json` content.
* Set a `CLOUDFLARE_API_TOKEN` secret to your Cloudflare token.

## Development

```sh
bun run dev
```

## Test

```sh
bun run test
```
