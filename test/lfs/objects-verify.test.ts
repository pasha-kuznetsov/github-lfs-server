import { describe, test, expect } from "vitest";
import { Hono } from "hono";

import type { AppEnv } from "../../src/index";
import { objectsApi } from "../../src/lfs/objects";

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
