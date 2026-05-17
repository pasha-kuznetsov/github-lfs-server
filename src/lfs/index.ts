import { Hono } from "hono";
import type { AppEnv } from "../app";
import { authMiddleware } from "./auth";
import { objectsApi } from "./objects";
import { locksApi } from "./locks";
import { ObjectsStorage } from "../storage/objects";

const LFS_CONTENT_TYPE = "application/vnd.git-lfs+json";

export const lfsApi = new Hono<AppEnv>();

// All LFS API requests must carry Accept: application/vnd.git-lfs+json.
// Strip charset suffix before comparing; wrong Accept → 404 (matches test server).
// Use an explicit Response (not c.notFound()) so nested routes finalize under Workers.
lfsApi.use("/:owner/:repo/*", async (c, next) => {
  const accept = (c.req.header("Accept") ?? "").split(";")[0].trim();
  if (accept !== LFS_CONTENT_TYPE) return new Response(null, { status: 404 });
  await next();
  c.res.headers.set("Content-Type", LFS_CONTENT_TYPE);
});

// Authenticate all LFS routes.
lfsApi.use("/:owner/:repo/*", authMiddleware);

// Inject ObjectsStorage instance.
let objects: ObjectsStorage | null = null;
lfsApi.use("/:owner/:repo/objects/*", async (c, next) => {
  c.set("objects", objects || (objects = new ObjectsStorage(c.env)));
  await next();
});

lfsApi.route("/", objectsApi);
lfsApi.route("/", locksApi);
