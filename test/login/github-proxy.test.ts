import { vi, describe, test, expect, afterEach } from "vitest";
import { githubProxy as proxyApi } from "../../src/login/github-proxy";

// ---------------------------------------------------------------------------
// GET /api/v3/meta
// ---------------------------------------------------------------------------

describe("GET /api/v3/meta", () => {
  test("returns 200", async () => {
    const res = await proxyApi.request("/v3/meta");
    expect(res.status).toBe(200);
  });

  test("returns JSON content-type", async () => {
    const res = await proxyApi.request("/v3/meta");
    expect(res.headers.get("content-type")).toMatch("application/json");
  });

  test("verifiable_password_authentication is false", async () => {
    const body = (await (await proxyApi.request("/v3/meta")).json()) as any;
    expect(body.verifiable_password_authentication).toBe(false);
  });

  test("installed_version satisfies GCM minimum for OAuth (>= 3.2.0)", async () => {
    const body = (await (await proxyApi.request("/v3/meta")).json()) as any;
    const [major, minor] = (body.installed_version as string)
      .split(".")
      .map(Number);
    expect(major > 3 || (major === 3 && minor >= 2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function mockGitHub(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json", ...extraHeaders },
    }),
  );
}

function capturedHeaders(
  spy: ReturnType<typeof vi.spyOn>,
): Record<string, string> {
  const [, init] = spy.mock.calls[0] as [string, RequestInit];
  return init.headers as Record<string, string>;
}

// ---------------------------------------------------------------------------
// GET /api/v3/user
// ---------------------------------------------------------------------------

const USER_RESPONSE = { login: "alice", id: 1, type: "User" };

describe("GET /api/v3/user", () => {
  afterEach(() => vi.restoreAllMocks());

  test("proxies response body and status from GitHub", async () => {
    mockGitHub(USER_RESPONSE);
    const res = await proxyApi.request("/v3/user");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(USER_RESPONSE);
  });

  test("forwards Authorization header to GitHub", async () => {
    const spy = mockGitHub(USER_RESPONSE);
    await proxyApi.request("/v3/user", {
      headers: { Authorization: "Bearer ghu_token" },
    });
    expect(capturedHeaders(spy)["Authorization"]).toBe("Bearer ghu_token");
  });

  test("omits Authorization when not provided", async () => {
    const spy = mockGitHub(USER_RESPONSE);
    await proxyApi.request("/v3/user");
    expect(capturedHeaders(spy)["Authorization"]).toBeUndefined();
  });

  test("forwards X-OAuth-Scopes from GitHub response", async () => {
    mockGitHub(USER_RESPONSE, 200, { "X-OAuth-Scopes": "repo,gist,read:org" });
    const res = await proxyApi.request("/v3/user");
    expect(res.headers.get("X-OAuth-Scopes")).toBe("repo,gist,read:org");
  });

  test("forwards X-Accepted-OAuth-Scopes from GitHub response", async () => {
    mockGitHub(USER_RESPONSE, 200, { "X-Accepted-OAuth-Scopes": "repo" });
    const res = await proxyApi.request("/v3/user");
    expect(res.headers.get("X-Accepted-OAuth-Scopes")).toBe("repo");
  });

  test("omits scope headers when GitHub does not return them", async () => {
    mockGitHub(USER_RESPONSE);
    const res = await proxyApi.request("/v3/user");
    expect(res.headers.get("X-OAuth-Scopes")).toBeNull();
  });

  test("proxies 401 from GitHub verbatim", async () => {
    mockGitHub({ message: "Bad credentials" }, 401);
    const res = await proxyApi.request("/v3/user", {
      headers: { Authorization: "Bearer bad_token" },
    });
    expect(res.status).toBe(401);
  });

  test("targets the correct GitHub endpoint", async () => {
    const spy = mockGitHub(USER_RESPONSE);
    await proxyApi.request("/v3/user");
    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/user");
  });

  test("sends required GitHub API headers", async () => {
    const spy = mockGitHub(USER_RESPONSE);
    await proxyApi.request("/v3/user");
    const headers = capturedHeaders(spy);
    expect(headers["Accept"]).toBe("application/vnd.github+json");
    expect(headers["User-Agent"]).toBe("github-lfs-server");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });
});

// ---------------------------------------------------------------------------
// POST /api/graphql
// ---------------------------------------------------------------------------

const GRAPHQL_RESPONSE = { data: { viewer: { login: "alice" } } };

describe("POST /api/graphql", () => {
  afterEach(() => vi.restoreAllMocks());

  const QUERY = JSON.stringify({ query: "{ viewer { login } }" });

  test("proxies response body and status from GitHub", async () => {
    mockGitHub(GRAPHQL_RESPONSE);
    const res = await proxyApi.request("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: QUERY,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(GRAPHQL_RESPONSE);
  });

  test("forwards Authorization header to GitHub", async () => {
    const spy = mockGitHub(GRAPHQL_RESPONSE);
    await proxyApi.request("/graphql", {
      method: "POST",
      headers: {
        Authorization: "Bearer ghu_token",
        "Content-Type": "application/json",
      },
      body: QUERY,
    });
    expect(capturedHeaders(spy)["Authorization"]).toBe("Bearer ghu_token");
  });

  test("forwards request body to GitHub", async () => {
    const spy = mockGitHub(GRAPHQL_RESPONSE);
    await proxyApi.request("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: QUERY,
    });
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe(QUERY);
  });

  test("targets the correct GitHub endpoint", async () => {
    const spy = mockGitHub(GRAPHQL_RESPONSE);
    await proxyApi.request("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: QUERY,
    });
    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/graphql");
  });

  test("proxies GraphQL errors from GitHub", async () => {
    mockGitHub({ errors: [{ message: "NOT_FOUND" }] }, 200);
    const res = await proxyApi.request("/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: QUERY,
    });
    expect(((await res.json()) as any).errors[0].message).toBe("NOT_FOUND");
  });
});
