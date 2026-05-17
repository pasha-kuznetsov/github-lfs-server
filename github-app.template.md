# GitHub OAuth app — {{[org-name]}}

Create an OAuth app at [https://github.com/settings/applications/new] (or your organization’s **Settings → Developer settings → OAuth Apps**).

- **Application name**: for example:
  ```
  {{org-name}} LFS Server
  ```
- **Homepage URL:** (matching `GITHUB_APP_HOME` in the generated `wrangler.jsonc`)
  ```
  https://lfs-server.{{[cloudflare-account-slug]}}.workers.dev
  ```
- **Application description**: for example:
  ```
  Enable automatic LFS Server login from `gh`, `git-credential-manager` etc.
  ```
- **Authorization callback URL:**
  ```
  https://lfs-server.{{[cloudflare-account-slug]}}.workers.dev/login/oauth/callback
  ```

**Generate a new client secret**. After GitHub shows the client credentials, store them with Wrangler (**you won't see them again**):

```sh
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

LFS access is limited to org **`{{[github-org]}}`** (`GITHUB_ORG` in `wrangler.jsonc`).
