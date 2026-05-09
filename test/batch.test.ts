import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { batchHandler } from "../src/batch";

type AppEnv = { Bindings: CloudflareBindings; Variables: { user: string } };

function makeEnv(existingKeys: string[] = []) {
  const keys = new Set(existingKeys);
  return {
    LFS_BUCKET: {
      async head(key: string) {
        return keys.has(key) ? { key } : null;
      },
    },
    S3_ENDPOINT: "https://test-account.r2.cloudflarestorage.com",
    S3_ACCESS_KEY_ID: "test-key",
    S3_SECRET_ACCESS_KEY: "test-secret",
    S3_BUCKET_NAME: "lfs-objects",
  } as any;
}

function makeApp() {
  const app = new Hono<AppEnv>();
  app.post("/:owner/:repo/objects/batch", batchHandler);
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
      "http://worker/alice/repo/objects/batch",
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

  test("existing object returns no actions", async () => {
    const res = await app.request(
      "http://worker/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "upload",
          objects: [{ oid: "abc123", size: 10 }],
        }),
      },
      makeEnv(["alice/repo/abc123"]),
    );
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.objects[0]).not.toHaveProperty("actions");
    expect(body.objects[0]).not.toHaveProperty("error");
  });

  test("strips .git suffix from repo when computing the R2 key", async () => {
    // If .git is NOT stripped, the head check will fail even though we seed
    // without it — the existing object won't be found and upload actions will
    // be returned instead of no-actions.
    const res = await app.request(
      "http://worker/alice/repo.git/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "upload",
          objects: [{ oid: "abc123", size: 10 }],
        }),
      },
      makeEnv(["alice/repo/abc123"]),
    );
    const body = (await res.json()) as any;
    expect(body.objects[0]).not.toHaveProperty("actions");
  });

  test("verify href uses request origin", async () => {
    const res = await app.request(
      "http://worker/alice/repo/objects/batch",
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
      "http://worker/alice/repo/objects/verify",
    );
  });

  test("mixed objects: some new, some existing", async () => {
    const res = await app.request(
      "http://worker/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "upload",
          objects: [
            { oid: "new-one", size: 10 },
            { oid: "existing", size: 5 },
          ],
        }),
      },
      makeEnv(["alice/repo/existing"]),
    );
    const body = (await res.json()) as any;
    expect(body.objects[0].actions).toBeDefined(); // new-one: has actions
    expect(body.objects[1]).not.toHaveProperty("actions"); // existing: no actions
  });
});

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

describe("batch download", () => {
  test("existing object returns download action", async () => {
    const res = await app.request(
      "http://worker/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "download",
          objects: [{ oid: "abc123", size: 10 }],
        }),
      },
      makeEnv(["alice/repo/abc123"]),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.objects[0].actions.download.href).toMatch(/^https:\/\//);
    expect(body.objects[0]).not.toHaveProperty("error");
  });

  test("missing object returns per-object 404 error", async () => {
    const res = await app.request(
      "http://worker/alice/repo/objects/batch",
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
      "http://worker/alice/repo/objects/batch",
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

  test("mixed: some present, some missing", async () => {
    const res = await app.request(
      "http://worker/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({
          operation: "download",
          objects: [
            { oid: "present", size: 5 },
            { oid: "absent", size: 5 },
          ],
        }),
      },
      makeEnv(["alice/repo/present"]),
    );
    const body = (await res.json()) as any;
    expect(body.objects[0].actions.download).toBeDefined();
    expect(body.objects[1].error.code).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("request validation", () => {
  test("returns 422 for invalid JSON body", async () => {
    const res = await app.request(
      "http://worker/alice/repo/objects/batch",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: "not json",
      },
      makeEnv(),
    );
    expect(res.status).toBe(422);
  });

  test("returns 422 when operation is unknown", async () => {
    const res = await app.request(
      "http://worker/alice/repo/objects/batch",
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
      "http://worker/alice/repo/objects/batch",
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
