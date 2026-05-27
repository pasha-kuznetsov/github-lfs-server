import { Hono } from "hono";
import type { AppEnv } from "../app";
import { orgsFromEnv } from "./utils";

import { githubProxy } from "./github-proxy";
import { deviceApi } from "./device";
import { oauthApi } from "./oauth";
import { tokenApi } from "./oauth-token";

export const loginApi = new Hono<AppEnv>();

loginApi.use("/*", async (c, next) => {
  if (c.env) {
    const isDev = (c.env as { DEV?: string }).DEV === "1";
    const required = isDev
      ? (["GITHUB_APP_HOME"] as const)
      : (["GITHUB_APP_HOME", "GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"] as const);
    const missing = required.filter((key) => !c.env[key]);
    if (missing.length)
      throw new Error(
        `Missing required vars: ${missing.join(", ")} — set them in .dev.vars (local) or via wrangler secret put (production)`,
      );
    const orgs = orgsFromEnv(c.env);
    const user = c.env.GITHUB_USER?.trim() || null;
    if (!orgs.length && !user)
      throw new Error("No access control: set GITHUB_ORG[S] or GITHUB_USER");
    if (orgs.length && user)
      throw new Error("Conflicting config: set GITHUB_ORG[S] or GITHUB_USER, not both");
    if (orgs.length > 5)
      throw new Error("Too many orgs: GITHUB_ORG[S] must not exceed 5");
  }
  await next();
});

loginApi.route("/api", githubProxy);
loginApi.route("/login/device", deviceApi);
loginApi.route("/login/oauth", oauthApi);
loginApi.route("/login/oauth", tokenApi);
