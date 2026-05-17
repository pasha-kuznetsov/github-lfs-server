import { describe, test, expect } from "vitest";
import app from "./app";

const BASE = "http://w/lfs/alice/repo";
const LFS_CT = "application/vnd.git-lfs+json";
const PROBE = "http://w/lfs/alice/repo/locks";

const TEST_ENV = {
  S3_ENDPOINT: "https://account-id.r2.cloudflarestorage.com",
  S3_ACCESS_KEY_ID: "test-access-key-id",
  S3_SECRET_ACCESS_KEY: "test-secret-access-key",
  S3_BUCKET_NAME: "lfs-objects",
  S3_PRESIGN_TTL: "3600",
  GITHUB_APP_HOME: "https://test.example.com",
  GITHUB_ORG: "Test-Org",
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
  LOGIN_SECRET: "a".repeat(64),
};

function req(
  path: string,
  init?: RequestInit,
  env: Record<string, string> = TEST_ENV,
) {
  return app.request(path, init, env);
}

describe("Accept header guard", () => {
  test("returns 404 when Accept header is missing", async () => {
    const res = await req(PROBE);
    expect(res.status).toBe(404);
  });

  test("returns 404 when Accept is wrong", async () => {
    const res = await req(PROBE, {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(404);
  });

  test("passes when Accept matches exactly", async () => {
    const res = await req(PROBE, { headers: { Accept: LFS_CT } });
    expect(res.status).not.toBe(404);
  });

  test("passes when Accept has a charset suffix", async () => {
    const res = await req(PROBE, {
      headers: { Accept: `${LFS_CT}; charset=utf-8` },
    });
    expect(res.status).not.toBe(404);
  });
});

describe("Content-Type response header", () => {
  test("is set on LFS API responses", async () => {
    const res = await req(PROBE, { headers: { Accept: LFS_CT } });
    expect(res.headers.get("Content-Type")).toBe(LFS_CT);
  });

  test("is not set when the Accept guard rejects the request", async () => {
    const res = await req(PROBE);
    expect(res.status).toBe(404);
    expect(res.headers.get("Content-Type")).toBeNull();
  });
});

describe("locks routes", () => {
  const lfs = { Accept: LFS_CT };

  test("POST /locks enforces auth", async () => {
    const res = await req(`${BASE}/locks`, { method: "POST", headers: lfs });
    expect(res.status).toBe(401);
  });

  test("GET /locks enforces auth", async () => {
    const res = await req(`${BASE}/locks`, { headers: lfs });
    expect(res.status).toBe(401);
  });

  test("POST /locks/verify enforces auth", async () => {
    const res = await req(`${BASE}/locks/verify`, {
      method: "POST",
      headers: lfs,
    });
    expect(res.status).toBe(401);
  });

  test("POST /locks/:id/unlock enforces auth", async () => {
    const res = await req(`${BASE}/locks/abc/unlock`, {
      method: "POST",
      headers: lfs,
    });
    expect(res.status).toBe(401);
  });
});

describe("objects routes", () => {
  const lfs = { Accept: LFS_CT };

  test("POST /objects/batch enforces auth", async () => {
    const res = await req(`${BASE}/objects/batch`, {
      method: "POST",
      headers: lfs,
    });
    expect(res.status).toBe(401);
  });

  test("POST /objects/verify enforces auth", async () => {
    const res = await req(`${BASE}/objects/verify`, {
      method: "POST",
      headers: lfs,
    });
    expect(res.status).toBe(401);
  });
});

describe("org alias routes", () => {
  const lfs = { Accept: LFS_CT };

  test("alias with correct org enforces auth (not 404)", async () => {
    const res = await req("http://w/Test-Org/repo/locks", { headers: lfs });
    expect(res.status).toBe(401);
  });

  test("alias with correct org but different casing enforces auth (not 404)", async () => {
    const res = await req("http://w/test-org/repo/locks", { headers: lfs });
    expect(res.status).toBe(401);
  });

  test("alias requires LFS Accept header", async () => {
    const res = await req("http://w/Test-Org/repo/locks");
    expect(res.status).toBe(404);
  });

  test("alias with wrong org falls through to web auth (302)", async () => {
    const res = await req("http://w/other-org/repo/locks", {
      headers: lfs,
      redirect: "manual",
    });
    expect(res.status).toBe(302);
  });

  test("alias resolves org from c.env, not process.env", async () => {
    const res = await req("http://w/Different-Org/repo/locks", {
      headers: lfs,
    }, { ...TEST_ENV, GITHUB_ORG: "Different-Org" });
    expect(res.status).toBe(401);
  });
});
