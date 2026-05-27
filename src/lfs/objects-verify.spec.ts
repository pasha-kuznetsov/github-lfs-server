import { describe, test, expect, vi } from "vitest";
import { Hono } from "hono";

import type { AppEnv } from "../app";
import { objectsApi } from "./objects";

function makeApp(objects: Record<string, number> = {}) {
  const app = new Hono<AppEnv>();
  app.use("/lfs/:owner/:repo/*", (c, next) => {
    c.set("objects", {
      verifyObject: async (key: string, size?: number) => {
        if (!(key in objects)) return { message: "Object not found" };
        if (size !== undefined && size !== objects[key])
          return { message: "Object size mismatch" };
        return {};
      },
    } as any);
    return next();
  });
  app.route("/lfs", objectsApi);
  return app;
}

const LFS_HEADERS = {
  Accept: "application/vnd.git-lfs+json",
  "Content-Type": "application/vnd.git-lfs+json",
};

describe("verifyHandler", () => {
  test("200 when object exists and size matches", async () => {
    const res = await makeApp({ "alice/repo/abc123": 42 }).request(
      "http://worker/lfs/alice/repo/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "abc123", size: 42 }),
      },
    );
    expect(res.status).toBe(200);
  });

  test("422 when object does not exist", async () => {
    const res = await makeApp().request(
      "http://worker/lfs/alice/repo/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "missing", size: 10 }),
      },
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).message).toBe("Object not found");
  });

  test("422 when size does not match", async () => {
    const res = await makeApp({ "alice/repo/abc123": 42 }).request(
      "http://worker/lfs/alice/repo/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "abc123", size: 99 }),
      },
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as any).message).toBe("Object size mismatch");
  });

  test("strips .git suffix when checking key", async () => {
    const res = await makeApp({ "alice/repo/abc123": 42 }).request(
      "http://worker/lfs/alice/repo.git/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "abc123", size: 42 }),
      },
    );
    expect(res.status).toBe(200);
  });

  test("400 for invalid JSON body", async () => {
    const res = await makeApp().request(
      "http://worker/lfs/alice/repo/objects/verify",
      { method: "POST", headers: LFS_HEADERS, body: "bad" },
    );
    expect(res.status).toBe(400);
  });

  test("422 when oid is missing", async () => {
    const res = await makeApp().request(
      "http://worker/lfs/alice/repo/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ size: 10 }),
      },
    );
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// GC Ingest
// ---------------------------------------------------------------------------

describe("verify admin ingest", () => {
  const execCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

  test("calls LFS_ADMIN.ingest on successful verify", async () => {
    const ingest = vi.fn().mockResolvedValue(undefined);
    const res = await makeApp({ "alice/repo/abc123": 42 }).request(
      "http://worker/lfs/alice/repo/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "abc123", size: 42 }),
      },
      { LFS_ADMIN: { ingest } } as any,
      execCtx,
    );
    expect(res.status).toBe(200);
    expect(ingest).toHaveBeenCalledWith({
      owner: "alice",
      repo: "repo",
      oid: "abc123",
      size: 42,
      event: "upload",
    });
  });

  test("does not call ingest when verify fails", async () => {
    const ingest = vi.fn().mockResolvedValue(undefined);
    const res = await makeApp({}).request(
      "http://worker/lfs/alice/repo/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "missing", size: 10 }),
      },
      { LFS_ADMIN: { ingest } } as any,
      execCtx,
    );
    expect(res.status).toBe(422);
    expect(ingest).not.toHaveBeenCalled();
  });

  test("succeeds when LFS_ADMIN is absent", async () => {
    const res = await makeApp({ "alice/repo/abc123": 42 }).request(
      "http://worker/lfs/alice/repo/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "abc123", size: 42 }),
      },
      {} as any,
      execCtx,
    );
    expect(res.status).toBe(200);
  });

  test("succeeds when ingest throws", async () => {
    const ingest = vi.fn().mockRejectedValue(new Error("boom"));
    const res = await makeApp({ "alice/repo/abc123": 42 }).request(
      "http://worker/lfs/alice/repo/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "abc123", size: 42 }),
      },
      { LFS_ADMIN: { ingest } } as any,
      execCtx,
    );
    expect(res.status).toBe(200);
  });
});
