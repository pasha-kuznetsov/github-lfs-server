import { Hono } from "hono";
import { sentry } from "@sentry/hono/cloudflare";

import { loginApi } from "./login";
import { lfsApi } from "./lfs";
import { webAuthMiddleware } from "./login/web-auth";
import { ObjectsStorage } from "./storage/objects";

export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    user: string;
    access: "read" | "write";
    objects: ObjectsStorage;
  };
};

const app = new Hono<AppEnv>();

// Options callback reads SENTRY_DSN from Worker bindings per-request.
// Sentry is a no-op when DSN is not configured.
app.use(sentry(app, (env) => ({ dsn: env?.SENTRY_DSN, sendDefaultPii: true })));

app.route("/", loginApi);
app.route("/lfs", lfsApi);

app.all("/:org/:repo/*", (c, next) => {
  if (!c.env.GITHUB_ORG || c.req.param("org").toLowerCase() !== c.env.GITHUB_ORG.toLowerCase()) return next();
  const url = new URL(c.req.url);
  url.pathname = "/lfs" + url.pathname;
  return app.fetch(new Request(url, c.req.raw), c.env, executionCtx());
  function executionCtx() {
    try { return c.executionCtx; } catch { return undefined; }
  }
});
app.get("/*", webAuthMiddleware, (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;

// required for Wrangler
export { Locks } from "./db/locks";
