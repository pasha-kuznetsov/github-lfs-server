import { vi, describe, test, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../app";

const mockValidateSession = vi.fn();
const mockCheckOrgRole = vi.fn();

vi.mock("@git-lfs-hub/auth", () => ({
  validateSession: mockValidateSession,
  checkOrgRole: mockCheckOrgRole,
  SESSION_COOKIE: "gh_session_v2",
  SESSION_TTL: 86400,
}));

const { webAuthMiddleware } = await import("./web-auth");
const { SESSION_COOKIE, SESSION_TTL } = await import("@git-lfs-hub/auth");

const LOGIN_SECRET = "a".repeat(64);
const TEST_ENV = {
  LOGIN_SECRET,
  GITHUB_APP_HOME: "https://example.com",
  GITHUB_ORG: "TestOrg",
} as unknown as CloudflareBindings;

function makeApp(env = TEST_ENV) {
  const hono = new Hono<AppEnv>();
  hono.get("/*", webAuthMiddleware, (c) =>
    c.json({ ok: true, user: c.get("user") }),
  );
  return (url: string, init?: RequestInit) => hono.request(url, init, env);
}

const app = makeApp();

describe("webAuthMiddleware", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockValidateSession.mockResolvedValue({ token: "ghu_token", username: "alice" });
    mockCheckOrgRole.mockResolvedValue("member");
  });

  describe("unauthenticated → redirects to login", () => {
    test("no session returns 302", async () => {
      mockValidateSession.mockResolvedValue(null);
      const res = await app("http://w/");
      expect(res.status).toBe(302);
    });

    test("redirect points to /login/oauth/authorize", async () => {
      mockValidateSession.mockResolvedValue(null);
      const res = await app("http://w/");
      expect(res.headers.get("Location")).toContain("/login/oauth/authorize");
    });

    test("redirect encodes GITHUB_APP_HOME as redirect_uri", async () => {
      mockValidateSession.mockResolvedValue(null);
      const res = await app("http://w/");
      expect(res.headers.get("Location")).toContain(
        encodeURIComponent("https://example.com/"),
      );
    });

    test("redirect requests read:org scope", async () => {
      mockValidateSession.mockResolvedValue(null);
      const res = await app("http://w/");
      const location = new URL(res.headers.get("Location")!, "http://w");
      expect(location.searchParams.get("scope")).toBe("read:org");
    });
  });

  describe("org membership", () => {
    test("non-member returns 403", async () => {
      mockCheckOrgRole.mockResolvedValue(null);
      const res = await app("http://w/");
      expect(res.status).toBe(403);
    });

    test("403 body names the user and org", async () => {
      mockValidateSession.mockResolvedValue({ token: "ghu_token", username: "bob" });
      mockCheckOrgRole.mockResolvedValue(null);
      const res = await app("http://w/");
      const body = await res.text();
      expect(body).toContain("bob");
      expect(body).toContain("TestOrg");
    });
  });

  describe("GITHUB_USER (user mode)", () => {
    const envUser = {
      LOGIN_SECRET,
      GITHUB_APP_HOME: "https://example.com",
      GITHUB_USER: "carol",
    } as unknown as CloudflareBindings;

    test("matching user is allowed without org check", async () => {
      mockValidateSession.mockResolvedValue({ token: "ghu_token", username: "carol" });
      const res = await makeApp(envUser)("http://w/");
      expect(res.status).toBe(200);
      expect(mockCheckOrgRole).not.toHaveBeenCalled();
    });

    test("non-matching user is denied", async () => {
      mockValidateSession.mockResolvedValue({ token: "ghu_token", username: "alice" });
      const res = await makeApp(envUser)("http://w/");
      expect(res.status).toBe(403);
    });

    test("match is case-insensitive", async () => {
      mockValidateSession.mockResolvedValue({ token: "ghu_token", username: "Carol" });
      const res = await makeApp(envUser)("http://w/");
      expect(res.status).toBe(200);
    });
  });

  describe("localhost bypass", () => {
    test("localhost requests skip auth entirely", async () => {
      const res = await app("http://localhost/");
      expect(res.status).toBe(200);
      expect(mockValidateSession).not.toHaveBeenCalled();
    });
  });

  describe("successful auth", () => {
    test("active member passes through with 200", async () => {
      const res = await app("http://w/");
      expect(res.status).toBe(200);
    });

    test("sets c.var.user to the GitHub login", async () => {
      mockValidateSession.mockResolvedValue({ token: "ghu_token", username: "gh-alice" });
      const res = await app("http://w/");
      const body = (await res.json()) as { user: string };
      expect(body.user).toBe("gh-alice");
    });

    test("URL with query params redirects to clean pathname", async () => {
      const res = await app("http://w/?code=ephemeral&state=xyz");
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/");
    });
  });
});

test("SESSION_COOKIE and SESSION_TTL are exported", () => {
  expect(typeof SESSION_COOKIE).toBe("string");
  expect(typeof SESSION_TTL).toBe("number");
});
