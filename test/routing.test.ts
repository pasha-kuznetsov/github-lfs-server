import { describe, test, expect } from "vitest";
import app from "../src/index";

const BASE = "http://w/lfs/alice/repo";

const LFS_CT = "application/vnd.git-lfs+json";
// Any LFS sub-path works: auth 401s before touching any binding.
const PROBE = "http://w/lfs/alice/repo/locks";

// ---------------------------------------------------------------------------
// Accept header guard
// ---------------------------------------------------------------------------

describe("Accept header guard", () => {
  test("returns 404 when Accept header is missing", async () => {
    const res = await app.request(PROBE);
    expect(res.status).toBe(404);
  });

  test("returns 404 when Accept is wrong", async () => {
    const res = await app.request(PROBE, {
      headers: { Accept: "application/json" },
    });
    expect(res.status).toBe(404);
  });

  test("passes when Accept matches exactly", async () => {
    const res = await app.request(PROBE, { headers: { Accept: LFS_CT } });
    expect(res.status).not.toBe(404);
  });

  test("passes when Accept has a charset suffix", async () => {
    const res = await app.request(PROBE, {
      headers: { Accept: `${LFS_CT}; charset=utf-8` },
    });
    expect(res.status).not.toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Content-Type response header
// ---------------------------------------------------------------------------

describe("Content-Type response header", () => {
  test("is set on LFS API responses", async () => {
    const res = await app.request(PROBE, { headers: { Accept: LFS_CT } });
    expect(res.headers.get("Content-Type")).toBe(LFS_CT);
  });

  test("is not set when the Accept guard rejects the request", async () => {
    const res = await app.request(PROBE);
    expect(res.headers.get("Content-Type")).not.toContain("vnd.git-lfs");
  });
});

// ---------------------------------------------------------------------------
// Locks routes — each should 401 (not 404), confirming the route is mounted
// and auth runs before any handler logic or binding access.
// ---------------------------------------------------------------------------

describe("locks routes", () => {
  const lfs = { Accept: LFS_CT };

  test("POST /locks enforces auth", async () => {
    const res = await app.request(`${BASE}/locks`, { method: "POST", headers: lfs });
    expect(res.status).toBe(401);
  });

  test("GET /locks enforces auth", async () => {
    const res = await app.request(`${BASE}/locks`, { headers: lfs });
    expect(res.status).toBe(401);
  });

  test("POST /locks/verify enforces auth", async () => {
    const res = await app.request(`${BASE}/locks/verify`, { method: "POST", headers: lfs });
    expect(res.status).toBe(401);
  });

  test("POST /locks/:id/unlock enforces auth", async () => {
    const res = await app.request(`${BASE}/locks/abc/unlock`, { method: "POST", headers: lfs });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Objects routes — same pattern.
// ---------------------------------------------------------------------------

describe("objects routes", () => {
  const lfs = { Accept: LFS_CT };

  test("POST /objects/batch enforces auth", async () => {
    const res = await app.request(`${BASE}/objects/batch`, { method: "POST", headers: lfs });
    expect(res.status).toBe(401);
  });

  test("POST /objects/verify enforces auth", async () => {
    const res = await app.request(`${BASE}/objects/verify`, { method: "POST", headers: lfs });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Login routes — confirm all families are reachable through the main app.
// Tests pick inputs that return deterministic non-404 responses without
// triggering any outbound fetch calls.
// ---------------------------------------------------------------------------

describe("login routes", () => {
  test("GET /api/v3/meta returns 200", async () => {
    const res = await app.request("http://w/api/v3/meta");
    expect(res.status).toBe(200);
  });

  test("GET /login/oauth/authorize without redirect_uri returns 400, not 404", async () => {
    const res = await app.request("http://w/login/oauth/authorize?state=s");
    expect(res.status).toBe(400);
  });

  test("GET /login/oauth/callback without state returns 400, not 404", async () => {
    const res = await app.request("http://w/login/oauth/callback?code=x");
    expect(res.status).toBe(400);
  });

  test("POST /login/oauth/access_token with no grant params returns 400, not 404", async () => {
    const res = await app.request("http://w/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ unrelated: "param" }),
    });
    expect(res.status).toBe(400);
  });
});
