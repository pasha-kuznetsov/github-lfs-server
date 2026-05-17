import { Hono } from "hono";

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

app.route("/", loginApi);
app.route("/lfs", lfsApi);

app.all("/:org/:repo/*", (c, next) => {
  if (!c.env.GITHUB_ORG || c.req.param("org").toLowerCase() !== c.env.GITHUB_ORG.toLowerCase()) return next();
  const url = new URL(c.req.url);
  url.pathname = "/lfs" + url.pathname;
  let ctx; try { ctx = c.executionCtx; } catch {}
  return app.fetch(new Request(url, c.req.raw), c.env, ctx);
});
app.get("/*", webAuthMiddleware, (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
