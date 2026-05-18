# GitHub OAuth app

Create an OAuth app at [https://github.com/settings/applications/new] (or your organization’s **Settings → Developer settings → OAuth Apps**).

- **Application name**: for example:
  ```
  {{org}} LFS Server
  ```
- **Homepage URL:** (matching `GITHUB_APP_HOME` in the generated `wrangler.jsonc`)
  ```
  {{github.appHome}}
  ```
- **Application description**: for example:
  ```
  Enable automatic LFS Server login from `gh`, `git-credential-manager` etc.
  ```
- **Authorization callback URL:**
  ```
  {{github.appHome}}/login/oauth/callback
  ```

**Generate a new client secret**. After GitHub shows the client credentials, store them with Wrangler (**you won't see them again**):

```sh
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

Access requires active membership in the configured GitHub org (`GITHUB_ORGS` in `wrangler.jsonc`). `GITHUB_USERS` further restricts access to specific GitHub logins.
