import { Hono } from "hono";
import { env } from "cloudflare:workers";

import routes, { AppEnv } from "./app";
export type { AppEnv } from "./app";

const app = new Hono<AppEnv>();

if (env?.SENTRY_DSN) {
  const { sentry } = await import("@sentry/hono/cloudflare");
  app.use(sentry(app, (c) => ({
    dsn: c?.SENTRY_DSN,
    sendDefaultPii: true
  })));
}

app.route("/", routes);

export default app;

// required for Wrangler
export { Locks } from "./db/locks";
export { Admin } from "./db/admin";
export { AdminEntrypoint } from "./admin/entrypoint";
