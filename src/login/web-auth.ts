import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { Octokit } from "@octokit/rest";
import type { AppEnv } from "../app";
import { decryptCode } from "./utils";

export const SESSION_COOKIE = "gh_session_v2";
export const SESSION_TTL = 86400; // 1 day

export const webAuthMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (new URL(c.req.url).hostname === "localhost") return next();

  const loginUrl = `/login/oauth/authorize?redirect_uri=${encodeURIComponent(c.env.GITHUB_APP_HOME + "/")}&scope=read%3Aorg`;

  const cookie = getCookie(c, SESSION_COOKIE);
  if (!cookie) return c.redirect(loginUrl);

  const payload = await decryptCode(cookie, c.env.LOGIN_SECRET);
  if (!payload) return c.redirect(loginUrl);

  const octokit = new Octokit({ auth: payload.token });
  const [userResult, membershipResult] = await Promise.allSettled([
    octokit.rest.users.getAuthenticated(),
    octokit.rest.orgs.getMembershipForAuthenticatedUser({ org: c.env.GITHUB_ORG }),
  ]);

  if (userResult.status === "rejected") return c.redirect(loginUrl);

  const { login } = userResult.value.data;

  if (membershipResult.status === "rejected" || membershipResult.value.data.state !== "active") {
    return c.text(`Access denied: ${login} is not an active member of ${c.env.GITHUB_ORG}`, 403);
  }

  c.set("user", login);

  if (new URL(c.req.url).search) return c.redirect(new URL(c.req.url).pathname);

  await next();
};
