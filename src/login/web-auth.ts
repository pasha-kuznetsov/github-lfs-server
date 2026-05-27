import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../app";
import { validateSession, checkOrgRole, SESSION_COOKIE, SESSION_TTL } from "@git-lfs-hub/auth";
import { orgsFromEnv } from "./utils";

export const webAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (new URL(c.req.url).hostname === "localhost") return next();

  const loginUrl = `/login/oauth/authorize?redirect_uri=${encodeURIComponent(c.env.GITHUB_APP_HOME + "/")}&scope=read%3Aorg`;

  const cookie = getCookie(c, SESSION_COOKIE);
  const session = await validateSession(cookie, c.env.LOGIN_SECRET);
  if (!session) return c.redirect(loginUrl);

  const allowUser = c.env.GITHUB_USER?.trim() || null;
  if (allowUser) {
    if (session.username.toLowerCase() !== allowUser.toLowerCase())
      return c.text(`Access denied: ${session.username} is not ${allowUser}`, 403);
  } else {
    const allowOrgs = orgsFromEnv(c.env);
    const roles = await Promise.all(allowOrgs.map((slug) => checkOrgRole(session.token, slug)));
    if (!roles.some((r) => r !== null))
      return c.text(
        `Access denied: ${session.username} is not an active member of ${allowOrgs.join(", ")}`,
        403,
      );
  }

  c.set("user", session.username);
  if (new URL(c.req.url).search) return c.redirect(new URL(c.req.url).pathname);
  await next();
};
