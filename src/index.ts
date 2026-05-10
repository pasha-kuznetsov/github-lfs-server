import { Context, Hono, MiddlewareHandler } from "hono";
import { authMiddleware } from "./auth";
import { batchValidator, batchHandler } from "./batch";
import { verifyValidator, verifyHandler } from "./verify";
import {
  createLockValidator,
  createLockHandler,
  listLocksHandler,
  verifyLocksValidator,
  verifyLocksHandler,
  unlockValidator,
  unlockHandler,
} from "./locks";
import { S3Bucket } from "./s3";

const LFS_CONTENT_TYPE = "application/vnd.git-lfs+json";

export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: { user: string; s3bucket: S3Bucket };
};

export type Ctx<Schema> = Context<
  AppEnv,
  string,
  { in: { json: Schema }; out: { json: Schema } }
>;

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

// Inject S3Bucket instance.
let s3Bucket: S3Bucket | null = null;
app.use("/:owner/:repo/objects/*", async (c, next) => {
  c.set("s3bucket", s3Bucket || (s3Bucket = new S3Bucket(c.env)));
  await next();
});

// Routes
app.post("/:owner/:repo/objects/batch", batchValidator, batchHandler);
app.post("/:owner/:repo/objects/verify", verifyValidator, verifyHandler);
app.post("/:owner/:repo/locks", createLockValidator, createLockHandler);
app.get("/:owner/:repo/locks", listLocksHandler);
app.post(
  "/:owner/:repo/locks/verify",
  verifyLocksValidator,
  verifyLocksHandler,
);
app.post("/:owner/:repo/locks/:id/unlock", unlockValidator, unlockHandler);

export default app;
