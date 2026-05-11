import { Context, Hono, MiddlewareHandler } from "hono";

import { authMiddleware } from "./api/auth";
import { initObjectsApi } from "./api/objects";
import { initLocksApi } from "./api/locks";
import { ObjectsStorage } from "./storage/objects";

const LFS_CONTENT_TYPE = "application/vnd.git-lfs+json";

export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    user: string;
    access: "read" | "write";
    objects: ObjectsStorage;
  };
};

const app = new Hono<AppEnv>();

// All LFS API requests must carry Accept: application/vnd.git-lfs+json.
// Strip charset suffix before comparing; wrong Accept → 404 (matches test server).
app.use("/:owner/:repo/*", async (c, next) => {
  const accept = (c.req.header("Accept") ?? "").split(";")[0].trim();
  if (accept !== LFS_CONTENT_TYPE) return c.notFound();
  await next();
});

// Set Content-Type on all LFS API responses.
app.use("/:owner/:repo/*", async (c, next) => {
  await next();
  c.res.headers.set("Content-Type", LFS_CONTENT_TYPE);
});

// Authenticate all LFS routes.
app.use("/:owner/:repo/*", authMiddleware);

// Inject ObjectsStorage instance.
let objects: ObjectsStorage | null = null;
app.use("/:owner/:repo/objects/*", async (c, next) => {
  c.set("objects", objects || (objects = new ObjectsStorage(c.env)));
  await next();
});

// Routes
initObjectsApi(app);
initLocksApi(app);

export default app;

// required for Wrangler
export { RepoLocks } from "./db/locks";
