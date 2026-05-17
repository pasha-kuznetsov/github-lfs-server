import { Hono } from "hono";
import type { AppEnv } from "../app";

import { githubProxy } from "./github-proxy";
import { deviceApi } from "./device";
import { oauthApi } from "./oauth";
import { tokenApi } from "./oauth-token";

export const loginApi = new Hono<AppEnv>();

loginApi.use("/*", async (c, next) => {
  if (c.env) {
    const missing = (["GITHUB_APP_HOME", "GITHUB_ORG", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"] as const)
      .filter((key) => !c.env[key]);
    if (missing.length)
      throw new Error(
        `Missing required env vars: ${missing.join(", ")} — set them in .dev.vars (local) or via wrangler secret put (production)`,
      );
  }
  await next();
});

loginApi.route("/api", githubProxy);
loginApi.route("/login/device", deviceApi);
loginApi.route("/login/oauth", oauthApi);
loginApi.route("/login/oauth", tokenApi);
