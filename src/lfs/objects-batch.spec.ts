import { describe, test, expect, vi } from "vitest";
import { Hono } from "hono";
import { objectsApi } from "./objects";
import { ObjectsStorage } from "../storage/objects";
import type { AppEnv } from "../app";
import { emptyR2Bucket } from "../test/r2-bucket-mock";

function makeEnv(overrides?: Record<string, unknown>) {
  return {
    LFS_BUCKET: emptyR2Bucket(),
    S3_ENDPOINT: "https://test-account.r2.cloudflarestorage.com",
    S3_ACCESS_KEY_ID: "test-key",
    S3_SECRET_ACCESS_KEY: "test-secret",
    S3_BUCKET_NAME: "lfs-objects",
    S3_PRESIGN_TTL: "3600",
    ...overrides,
  } as any;
}

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
    );
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// GC Ingest
// ---------------------------------------------------------------------------

describe("batch admin ingest", () => {
  const execCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

  test("calls LFS_ADMIN.ingest on download with objects", async () => {
    const ingest = vi.fn().mockResolvedValue(undefined);
    const env = makeEnv({ LFS_ADMIN: { ingest } });
    const res = await app.request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "download",
          objects: [{ oid: "abc123", size: 77 }],
        }),
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(200);
    expect(ingest).toHaveBeenCalledWith({
      owner: "alice",
      repo: "repo",
      oid: "abc123",
      size: 77,
      event: "download",
    });
  });

  test("does not call ingest on upload", async () => {
    const ingest = vi.fn().mockResolvedValue(undefined);
    const env = makeEnv({ LFS_ADMIN: { ingest } });
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
      env,
      execCtx,
    );
    expect(res.status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
  });

  test("does not call ingest on empty download", async () => {
    const ingest = vi.fn().mockResolvedValue(undefined);
    const env = makeEnv({ LFS_ADMIN: { ingest } });
    const res = await app.request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ operation: "download", objects: [] }),
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(200);
    expect(ingest).not.toHaveBeenCalled();
  });

  test("succeeds when LFS_ADMIN is absent", async () => {
    const res = await app.request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "download",
          objects: [{ oid: "abc123", size: 10 }],
        }),
      },
      makeEnv(),
      execCtx,
    );
    expect(res.status).toBe(200);
  });

  test("succeeds when ingest throws", async () => {
    const ingest = vi.fn().mockRejectedValue(new Error("boom"));
    const env = makeEnv({ LFS_ADMIN: { ingest } });
    const res = await app.request(
      "http://worker/lfs/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "download",
          objects: [{ oid: "abc123", size: 10 }],
        }),
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(200);
  });
});
