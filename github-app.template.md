# GitHub App for Git LFS Hub

A single GitHub App handles user authentication (web OAuth + device flow) for the LFS server, admin login for the GC admin UI, and server-to-server API access (installation tokens for reconciliation, tree scanning, etc).

Create a GitHub App at your organization's **Settings → Developer settings → GitHub Apps → New GitHub App**.

## App Settings

- **GitHub App name**: for example:
  ```
  {{org}} LFS
  ```
- **Homepage URL:**
  ```
  {{github.appHome}}
  ```
- **Callback URLs** (add both):
  ```
  {{github.appHome}}/login/oauth/callback
  {{github.adminHome}}/auth/callback
  ```
- **Expire user authorization tokens**: Yes (recommended)
- **Request user authorization (OAuth) during installation**: No
- **Enable Device Flow**: Yes (for `gh` / `git-credential-manager` login from CLI)
- **Webhook**: uncheck **Active** (reconciliation is poll-based)

## Permissions

Under **Repository permissions**:

| Permission | Access |
|------------|--------|
| Contents | Read-only |
| Metadata | Read-only |

No organization or account permissions needed.

## Installation

- **Where can this GitHub App be installed?** → Only on this account
- After creating, click **Install App** → install on `{{github.org}}`
- Grant access to **All repositories** (admin can only reconcile repos it can see)

## Secrets

From the app's settings page, collect:

1. **App ID** — numeric ID shown at the top
2. **Client ID** — shown under "About" (format: `Iv23li...`)
3. **Client secret** — click "Generate a new client secret"
4. **Private key** — click "Generate a private key" (downloads `.pem`)

Store with Wrangler on both workers:

```sh
# LFS server — user OAuth (web + device flow)
cd server/
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET

# Admin worker — admin OAuth + installation tokens
cd ../admin/
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put GITHUB_APP_ID           # numeric App ID (e.g. 123456)
wrangler secret put GITHUB_APP_PRIVATE_KEY  # full PEM contents
```

| Secret | Worker | Used for |
|--------|--------|----------|
| `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` | `server`, `admin` | User OAuth login (LFS users via gh / git-credential-manager; admin UI) |
| `GITHUB_APP_ID` + `GITHUB_APP_PRIVATE_KEY` | `admin` | Installation tokens — reconciliation, branch/tag listing, tree scanning |

Access is controlled by `GITHUB_ORG`/`GITHUB_ORGS` (org mode — active members only) or `GITHUB_USER` (user mode — single login). Configure in `wrangler.jsonc`.
