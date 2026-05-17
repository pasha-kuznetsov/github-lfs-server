import { vi, describe, test, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../app";
import { encryptCode } from "./utils";

// ---------------------------------------------------------------------------
// Octokit mock — must be set up before web-auth.ts is imported
// ---------------------------------------------------------------------------

const mockState = vi.hoisted(() => ({
  authenticated: true,
  isMember: true,
  memberState: "active",
  githubLogin: "alice",
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    rest = {
      users: {
        getAuthenticated: async () => {
          if (!mockState.authenticated)
            throw Object.assign(new Error("Unauthorized"), { status: 401 });
          return { data: { login: mockState.githubLogin } };
        },
      },
      orgs: {
        getMembershipForAuthenticatedUser: async () => {
          if (!mockState.isMember)
            throw Object.assign(new Error("Not a member"), { status: 404 });
          return { data: { state: mockState.memberState } };
        },
      },
    };
  },
}));

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------
const { webAuthMiddleware, SESSION_COOKIE, SESSION_TTL } = await import(
  "./web-auth"
);

const LOGIN_SECRET = "a".repeat(64);
const TEST_ENV = {
  LOGIN_SECRET,
  GITHUB_APP_HOME: "https://example.com",
  GITHUB_ORG: "TestOrg",
} as unknown as CloudflareBindings;

function makeApp() {
  const hono = new Hono<AppEnv>();
  hono.get("/*", webAuthMiddleware, (c) =>
    c.json({ ok: true, user: c.get("user") }),
  );
  return {
    request: (url: string, init?: RequestInit) => hono.request(url, init, TEST_ENV),
  };
}

const app = makeApp();

async function sessionCookie(token = "ghu_token") {
  const val = await encryptCode({ token }, LOGIN_SECRET, SESSION_TTL);
  return `${SESSION_COOKIE}=${val}`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("webAuthMiddleware", () => {
  beforeEach(() => {
    mockState.authenticated = true;
    mockState.isMember = true;
    mockState.memberState = "active";
    mockState.githubLogin = "alice";
  });

  describe("unauthenticated → redirects to login", () => {
    test("no cookie returns 302", async () => {
      const res = await app.request("http://w/");
      expect(res.status).toBe(302);
    });

    test("redirect points to /login/oauth/authorize", async () => {
      const res = await app.request("http://w/");
      expect(res.headers.get("Location")).toContain("/login/oauth/authorize");
    });

    test("redirect encodes GITHUB_APP_HOME as redirect_uri", async () => {
      const res = await app.request("http://w/");
      expect(res.headers.get("Location")).toContain(
        encodeURIComponent("https://example.com/"),
      );
    });

    test("redirect requests read:org scope", async () => {
      const res = await app.request("http://w/");
      const location = new URL(res.headers.get("Location")!, "http://w");
      expect(location.searchParams.get("scope")).toBe("read:org");
    });

    test("invalid cookie returns 302", async () => {
      const res = await app.request("http://w/", {
        headers: { Cookie: `${SESSION_COOKIE}=not-a-valid-token` },
      });
      expect(res.status).toBe(302);
    });

    test("invalid GitHub token returns 302", async () => {
      mockState.authenticated = false;
      const res = await app.request("http://w/", {
        headers: { Cookie: await sessionCookie() },
      });
      expect(res.status).toBe(302);
    });
  });

  describe("org membership", () => {
    test("non-member returns 403", async () => {
      mockState.isMember = false;
      const res = await app.request("http://w/", {
        headers: { Cookie: await sessionCookie() },
      });
      expect(res.status).toBe(403);
    });

    test("pending membership returns 403", async () => {
      mockState.memberState = "pending";
      const res = await app.request("http://w/", {
        headers: { Cookie: await sessionCookie() },
      });
      expect(res.status).toBe(403);
    });

    test("403 body names the user and org", async () => {
      mockState.isMember = false;
      mockState.githubLogin = "bob";
      const res = await app.request("http://w/", {
        headers: { Cookie: await sessionCookie() },
      });
      const body = await res.text();
      expect(body).toContain("bob");
      expect(body).toContain("TestOrg");
    });
  });

  describe("successful auth", () => {
    test("active member passes through with 200", async () => {
      const res = await app.request("http://w/", {
        headers: { Cookie: await sessionCookie() },
      });
      expect(res.status).toBe(200);
    });

    test("sets c.var.user to the GitHub login", async () => {
      mockState.githubLogin = "gh-alice";
      const res = await app.request("http://w/", {
        headers: { Cookie: await sessionCookie() },
      });
      const body = (await res.json()) as { user: string };
      expect(body.user).toBe("gh-alice");
    });

    test("URL with query params redirects to clean pathname", async () => {
      const res = await app.request("http://w/?code=ephemeral&state=xyz", {
        headers: { Cookie: await sessionCookie() },
      });
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/");
    });
  });
});
