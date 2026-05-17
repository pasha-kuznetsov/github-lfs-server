import { vi, describe, test, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../app";

// ---------------------------------------------------------------------------
// Octokit mock — must be set up before auth.ts is imported
// ---------------------------------------------------------------------------

const mockState = {
  authenticated: true,
  hasRepoAccess: true,
  hasWriteAccess: true,
  isMember: true,
  githubLogin: "alice",
};

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
      repos: {
        get: async () => {
          if (!mockState.hasRepoAccess)
            throw Object.assign(new Error("Not found"), { status: 404 });
          return {
            data: {
              permissions: {
                pull: true,
                push: mockState.hasWriteAccess,
                admin: false,
              },
            },
          };
        },
      },
      orgs: {
        getMembershipForAuthenticatedUser: async () => {
          if (!mockState.isMember)
            throw Object.assign(new Error("Not a member"), { status: 404 });
          return { data: { state: "active" } };
        },
      },
    };
  },
}));

const { authMiddleware, extractToken } = await import("./auth");

// ---------------------------------------------------------------------------
// extractToken — pure function tests, no app needed
// ---------------------------------------------------------------------------

describe("extractToken", () => {
  describe("Basic scheme", () => {
    test("returns username and password from valid Basic credentials", () => {
      const result = extractToken(`Basic ${btoa("alice:secret")}`);
      expect(result).toEqual({ username: "alice", token: "secret" });
    });

    test("splits on the first colon only (password may contain colons)", () => {
      const result = extractToken(`Basic ${btoa("alice:pass:with:colons")}`);
      expect(result).toEqual({ username: "alice", token: "pass:with:colons" });
    });

    test("allows an empty username", () => {
      const result = extractToken(`Basic ${btoa(":token-only")}`);
      expect(result).toEqual({ username: "", token: "token-only" });
    });

    test("returns null for malformed base64", () => {
      expect(extractToken("Basic !!!not-base64!!!")).toBeNull();
    });

    test("returns null when decoded value has no colon", () => {
      expect(extractToken(`Basic ${btoa("nocohereseparator")}`)).toBeNull();
    });

    test("scheme matching is case-insensitive", () => {
      expect(extractToken(`BASIC ${btoa("alice:secret")}`)).toEqual({
        username: "alice",
        token: "secret",
      });
    });
  });

  describe("non-Basic schemes", () => {
    test("RemoteAuth: treats raw credential as token, username empty", () => {
      expect(extractToken("RemoteAuth my-opaque-token")).toEqual({
        username: "",
        token: "my-opaque-token",
      });
    });

    test("Bearer: treats raw credential as token", () => {
      expect(extractToken("Bearer eyJhbGciOiJIUzI1NiJ9")).toEqual({
        username: "",
        token: "eyJhbGciOiJIUzI1NiJ9",
      });
    });
  });

  test("returns null when no space separates scheme from credentials", () => {
    expect(extractToken("BasicYWxpY2U6c2VjcmV0")).toBeNull();
  });
});

const TEST_ENV = { GITHUB_ORG: "TestOrg" } as unknown as CloudflareBindings;

function makeApp() {
  const hono = new Hono<AppEnv>();
  hono.use("/lfs/:owner/:repo/*", authMiddleware);
  hono.get("/lfs/:owner/:repo/", (c) =>
    c.json({ ok: true, user: c.get("user"), access: c.get("access") }),
  );
  return {
    request: (url: string, init?: RequestInit) => hono.request(url, init, TEST_ENV),
  };
}

const app = makeApp();
const REPO_URL = "http://w/lfs/alice/repo/";

function basic(username: string, password: string) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

describe("authMiddleware", () => {
  beforeEach(() => {
    mockState.authenticated = true;
    mockState.hasRepoAccess = true;
    mockState.hasWriteAccess = true;
    mockState.isMember = true;
    mockState.githubLogin = "alice";
  });

  describe("401 responses", () => {
    test("rejects requests with no Authorization header", async () => {
      const res = await app.request(REPO_URL);
      expect(res.status).toBe(401);
    });

    test("rejects malformed Basic credentials", async () => {
      const res = await app.request(REPO_URL, {
        headers: { Authorization: "Basic !!!bad-base64!!!" },
      });
      expect(res.status).toBe(401);
    });

    test("rejects Basic with no colon in decoded value", async () => {
      const res = await app.request(REPO_URL, {
        headers: { Authorization: `Basic ${btoa("nocolon")}` },
      });
      expect(res.status).toBe(401);
    });

    test("rejects when GitHub says token is invalid", async () => {
      mockState.authenticated = false;
      const res = await app.request(REPO_URL, {
        headers: { Authorization: basic("alice", "bad-token") },
      });
      expect(res.status).toBe(401);
    });

    test("rejects when GitHub says no read access to repo", async () => {
      mockState.hasRepoAccess = false;
      const res = await app.request(REPO_URL, {
        headers: { Authorization: basic("alice", "valid-token") },
      });
      expect(res.status).toBe(401);
    });

    test("401 carries LFS-Authenticate header", async () => {
      const res = await app.request(REPO_URL);
      expect(res.headers.get("LFS-Authenticate")).toBe('Basic realm="Git LFS"');
    });

    test("401 body contains credentials-needed message", async () => {
      const res = await app.request(REPO_URL);
      const body = (await res.json()) as any;
      expect(body.message).toBe("Credentials needed");
    });
  });

  describe("successful authentication", () => {
    test("accepts request when GitHub confirms token and repo access", async () => {
      const res = await app.request(REPO_URL, {
        headers: { Authorization: basic("alice", "ghp_valid_token") },
      });
      expect(res.status).toBe(200);
    });

    test("sets user variable to the GitHub login", async () => {
      mockState.githubLogin = "gh-alice";
      const res = await app.request(REPO_URL, {
        headers: { Authorization: basic("alice", "ghp_valid_token") },
      });
      const body = (await res.json()) as any;
      expect(body.user).toBe("gh-alice");
    });

    test("accepts RemoteAuth scheme when GitHub confirms access", async () => {
      const res = await app.request(REPO_URL, {
        headers: { Authorization: "RemoteAuth ghp_some_token" },
      });
      expect(res.status).toBe(200);
    });

    test("strips .git from repo name before checking GitHub", async () => {
      const res = await app.request("http://w/lfs/alice/repo.git/", {
        headers: { Authorization: basic("alice", "ghp_valid_token") },
      });
      expect(res.status).toBe(200);
    });

    test("sets access to 'write' when user has push permission", async () => {
      mockState.hasWriteAccess = true;
      const res = await app.request(REPO_URL, {
        headers: { Authorization: basic("alice", "ghp_valid_token") },
      });
      expect(((await res.json()) as any).access).toBe("write");
    });

    test("sets access to 'read' when user only has pull permission", async () => {
      mockState.hasWriteAccess = false;
      const res = await app.request(REPO_URL, {
        headers: { Authorization: basic("alice", "ghp_valid_token") },
      });
      expect(((await res.json()) as any).access).toBe("read");
    });
  });
});
