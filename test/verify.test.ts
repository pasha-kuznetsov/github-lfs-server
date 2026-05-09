import { describe, test, expect } from "bun:test";
import { Hono } from "hono";
import { verifyHandler } from "../src/verify";

type AppEnv = { Bindings: CloudflareBindings; Variables: { user: string } };

function makeEnv(objects: Record<string, number> = {}) {
  return {
    LFS_BUCKET: {
      async head(key: string) {
        return key in objects ? { size: objects[key] } : null;
      },
    },
  } as any;
}

function makeApp() {
  const app = new Hono<AppEnv>();
  app.post("/:owner/:repo/objects/verify", verifyHandler);
  return app;
}

const LFS_HEADERS = {
  "Accept": "application/vnd.git-lfs+json",
  "Content-Type": "application/vnd.git-lfs+json",
};

const app = makeApp();

describe("verifyHandler", () => {
  test("200 when object exists and size matches", async () => {
    const res = await app.request(
      "http://worker/alice/repo/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "abc123", size: 42 }),
      },
      makeEnv({ "alice/repo/abc123": 42 }),
    );
    expect(res.status).toBe(200);
  });

  test("422 when object does not exist", async () => {
    const res = await app.request(
      "http://worker/alice/repo/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "missing", size: 10 }),
      },
      makeEnv(),
    );
    expect(res.status).toBe(422);
  });

  test("422 when size does not match", async () => {
    const res = await app.request(
      "http://worker/alice/repo/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "abc123", size: 99 }),
      },
      makeEnv({ "alice/repo/abc123": 42 }),
    );
    expect(res.status).toBe(422);
  });

  test("strips .git suffix when checking R2 key", async () => {
    const res = await app.request(
      "http://worker/alice/repo.git/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ oid: "abc123", size: 42 }),
      },
      makeEnv({ "alice/repo/abc123": 42 }),
    );
    expect(res.status).toBe(200);
  });

  test("422 for invalid JSON body", async () => {
    const res = await app.request(
      "http://worker/alice/repo/objects/verify",
      { method: "POST", headers: LFS_HEADERS, body: "bad" },
      makeEnv(),
    );
    expect(res.status).toBe(422);
  });

  test("422 when oid is missing", async () => {
    const res = await app.request(
      "http://worker/alice/repo/objects/verify",
      {
        method: "POST",
        headers: LFS_HEADERS,
        body: JSON.stringify({ size: 10 }),
      },
      makeEnv(),
    );
    expect(res.status).toBe(422);
  });
});
