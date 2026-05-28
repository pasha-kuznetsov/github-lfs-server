import { describe, test, expect, vi } from "vitest";
import { Hono } from "hono";
import { objectsApi } from "./objects";
import { ObjectsStorage } from "../storage/objects";
import type { AppEnv } from "../app";
import { emptyR2Bucket } from "../test/r2-bucket-mock";

function makeEnv() {
  const send = vi.fn(async () => {});
  const sendBatch = vi.fn(async () => {});
  return {
    LFS_BUCKET: emptyR2Bucket(),
    OBJECT_EVENTS: { send, sendBatch },
    S3_ENDPOINT: "https://test-account.r2.cloudflarestorage.com",
    S3_ACCESS_KEY_ID: "test-key",
    S3_SECRET_ACCESS_KEY: "test-secret",
    S3_BUCKET_NAME: "lfs-objects",
    S3_PRESIGN_TTL: "3600",
  } as any;
}

const testCtx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

function makeApp(access: "read" | "write" = "write") {
  const app = new Hono<AppEnv>();
  app.use("/lfs/:owner/:repo/*", (c, next) => {
    c.set("access", access);
    c.set("objects", new ObjectsStorage(c.env));
    return next();
  });
  app.route("/lfs", objectsApi);
  return app;
}

const LFS_HEADERS = {
  Accept: "application/vnd.git-lfs+json",
  "Content-Type": "application/vnd.git-lfs+json",
};

const app = makeApp();

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

describe("batch upload", () => {
  test("new object returns upload and verify actions", async () => {
    const res = await app.request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "upload",
          objects: [{ oid: "abc123", size: 10 }],
        }),
      },
      makeEnv(),
      testCtx,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.transfer).toBe("basic");
    expect(body.hash_algo).toBe("sha256");
    expect(body.objects[0].actions.upload.href).toMatch(/^https:\/\//);
    expect(body.objects[0].actions.verify.href).toMatch(/^https?:\/\//);
    expect(body.objects[0]).not.toHaveProperty("error");
  });

  test("verify href uses request origin", async () => {
    const res = await app.request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "upload",
          objects: [{ oid: "deadbeef", size: 1 }],
        }),
      },
      makeEnv(),
      testCtx,
    );
    const body = (await res.json()) as any;
    expect(body.objects[0].actions.verify.href).toBe(
      "http://worker/lfs/alice/repo/objects/verify",
    );
  });
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe("batch authorization", () => {
  test("403 when read-only user attempts upload", async () => {
    const res = await makeApp("read").request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "upload",
          objects: [{ oid: "abc123", size: 10 }],
        }),
      },
      makeEnv(),
      testCtx,
    );
    expect(res.status).toBe(403);
  });

  test("read-only user can download", async () => {
    const res = await makeApp("read").request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "download",
          objects: [{ oid: "missing", size: 10 }],
        }),
      },
      makeEnv(),
      testCtx,
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

describe("batch download", () => {
  test("missing object returns per-object 404 error", async () => {
    const res = await app.request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "download",
          objects: [{ oid: "missing", size: 10 }],
        }),
      },
      makeEnv(),
      testCtx,
    );
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.objects[0].error.code).toBe(404);
    expect(body.objects[0]).not.toHaveProperty("actions");
  });

  test("empty objects array returns empty objects", async () => {
    const res = await app.request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ operation: "download", objects: [] }),
      },
      makeEnv(),
      testCtx,
    );
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.objects).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("request validation", () => {
  test("returns 400 for invalid JSON body", async () => {
    const res = await app.request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: "not json",
      },
      makeEnv(),
      testCtx,
    );
    expect(res.status).toBe(400);
  });

  test("returns 422 when operation is unknown", async () => {
    const res = await app.request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ operation: "delete", objects: [] }),
      },
      makeEnv(),
      testCtx,
    );
    expect(res.status).toBe(422);
  });

  test("returns 422 when objects is missing", async () => {
    const res = await app.request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ operation: "upload" }),
      },
      makeEnv(),
      testCtx,
    );
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// OBJECT_EVENTS queue producer
// ---------------------------------------------------------------------------

describe("batch queue producer", () => {
  test("upload batch sends one message per object with operation=upload", async () => {
    const env = makeEnv();
    const res = await app.request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "upload",
          objects: [
            { oid: "aaa", size: 10 },
            { oid: "bbb", size: 20 },
          ],
        }),
      },
      env,
      testCtx,
    );
    expect(res.status).toBe(200);
    expect(env.OBJECT_EVENTS.sendBatch).toHaveBeenCalledTimes(1);
    expect(env.OBJECT_EVENTS.send).not.toHaveBeenCalled();
    expect(env.OBJECT_EVENTS.sendBatch.mock.calls[0][0]).toEqual([
      { body: { owner: "alice", repo: "repo", oid: "aaa", size: 10, operation: "upload" } },
      { body: { owner: "alice", repo: "repo", oid: "bbb", size: 20, operation: "upload" } },
    ]);
  });

  test("download batch filters out objects with errors before enqueueing", async () => {
    const env = makeEnv();
    // bucket is empty → all download presigns will return 404 errors
    const res = await app.request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "download",
          objects: [{ oid: "missing", size: 10 }],
        }),
      },
      env,
      testCtx,
    );
    expect(res.status).toBe(200);
    expect(env.OBJECT_EVENTS.sendBatch).not.toHaveBeenCalled();
    expect(env.OBJECT_EVENTS.send).not.toHaveBeenCalled();
  });

  test("empty objects array does not enqueue", async () => {
    const env = makeEnv();
    await app.request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ operation: "download", objects: [] }),
      },
      env,
      testCtx,
    );
    expect(env.OBJECT_EVENTS.sendBatch).not.toHaveBeenCalled();
    expect(env.OBJECT_EVENTS.send).not.toHaveBeenCalled();
  });

  test("strips .git suffix from repo in messages", async () => {
    const env = makeEnv();
    await app.request(
      "http://worker/lfs/alice/repo.git/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "upload",
          objects: [{ oid: "abc", size: 1 }],
        }),
      },
      env,
      testCtx,
    );
    expect(env.OBJECT_EVENTS.sendBatch.mock.calls[0][0][0].body.repo).toBe("repo");
  });

  test("forbidden upload (read-only) does not enqueue", async () => {
    const env = makeEnv();
    await makeApp("read").request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "upload",
          objects: [{ oid: "abc", size: 10 }],
        }),
      },
      env,
      testCtx,
    );
    expect(env.OBJECT_EVENTS.sendBatch).not.toHaveBeenCalled();
  });
});
