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

app.onError((err, c) => {
  console.error(err);
  // In dev, surface the stack in the response body so callers see it even when
  // the runner (vite dev / aux worker) swallows or buffers worker stderr.
  const dev = (c.env as { DEV?: string }).DEV === "1";
  const body = dev
    ? `Internal Server Error\n\n${err.stack ?? err.message ?? String(err)}`
    : "Internal Server Error";
  return c.text(body, 500);
});

export default app;

// required for Wrangler
export { Locks } from "./db/locks";
export { Admin } from "./db/admin";
export { AdminEntrypoint } from "./admin/entrypoint";
