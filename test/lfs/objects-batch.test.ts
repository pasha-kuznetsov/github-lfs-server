import { describe, test, expect } from "vitest";
import { Hono } from "hono";
import { objectsApi } from "../../src/lfs/objects";
import { ObjectsStorage } from "../../src/storage/objects";
import type { AppEnv } from "../../src/index";

function makeEnv() {
  return {
    S3_ENDPOINT: "https://test-account.r2.cloudflarestorage.com",
    S3_ACCESS_KEY_ID: "test-key",
    S3_SECRET_ACCESS_KEY: "test-secret",
    S3_BUCKET_NAME: "lfs-objects",
    S3_PRESIGN_TTL: "3600",
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
