import { describe, test, expect, vi } from "vitest";
import { Hono } from "hono";

import type { AppEnv } from "../app";
import { objectsApi } from "./objects";

function makeEnv() {
  const send = vi.fn(async () => {});
  const sendBatch = vi.fn(async () => {});
  return {
    OBJECT_EVENTS: { send, sendBatch },
  } as any;
}

const testCtx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

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
      makeEnv(),
      testCtx,
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
      makeEnv(),
      testCtx,
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
      makeEnv(),
      testCtx,
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
      makeEnv(),
      testCtx,
    );
    expect(res.status).toBe(200);
  });

  test("400 for invalid JSON body", async () => {
    const res = await makeApp().request(
      "http://worker/lfs/alice/repo/objects/verify",
      { method: "POST", headers: LFS_HEADERS, body: "bad" },
      makeEnv(),
      testCtx,
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
      makeEnv(),
      testCtx,
    );
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// OBJECT_EVENTS queue producer
// ---------------------------------------------------------------------------

describe("verify queue producer", () => {
  test("successful verify sends message with operation=verify", async () => {
    const env = makeEnv();
    const res = await makeApp({ "alice/repo/abc123": 42 }).request(
      "http://worker/lfs/alice/repo/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "abc123", size: 42 }),
      },
      env,
      testCtx,
    );
    expect(res.status).toBe(200);
    expect(env.OBJECT_EVENTS.send).toHaveBeenCalledTimes(1);
    expect(env.OBJECT_EVENTS.send.mock.calls[0][0]).toEqual({
      owner: "alice",
      repo: "repo",
      oid: "abc123",
      size: 42,
      operation: "verify",
    });
    expect(env.OBJECT_EVENTS.sendBatch).not.toHaveBeenCalled();
  });

  test("failed verify (object missing) does not enqueue", async () => {
    const env = makeEnv();
    await makeApp().request(
      "http://worker/lfs/alice/repo/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "missing", size: 10 }),
      },
      env,
      testCtx,
    );
    expect(env.OBJECT_EVENTS.send).not.toHaveBeenCalled();
  });

  test("failed verify (size mismatch) does not enqueue", async () => {
    const env = makeEnv();
    await makeApp({ "alice/repo/abc": 42 }).request(
      "http://worker/lfs/alice/repo/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "abc", size: 99 }),
      },
      env,
      testCtx,
    );
    expect(env.OBJECT_EVENTS.send).not.toHaveBeenCalled();
  });

  test("strips .git suffix from repo in message", async () => {
    const env = makeEnv();
    await makeApp({ "alice/repo/abc": 1 }).request(
      "http://worker/lfs/alice/repo.git/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "abc", size: 1 }),
      },
      env,
      testCtx,
    );
    expect(env.OBJECT_EVENTS.send.mock.calls[0][0].repo).toBe("repo");
  });

  test("invalid request body (400) does not enqueue", async () => {
    const env = makeEnv();
    await makeApp().request(
      "http://worker/lfs/alice/repo/objects/verify",
      { method: "POST", headers: LFS_HEADERS, body: "bad" },
      env,
      testCtx,
    );
    expect(env.OBJECT_EVENTS.send).not.toHaveBeenCalled();
  });
});
