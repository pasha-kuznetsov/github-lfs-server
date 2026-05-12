import { vi, describe, test, expect, afterEach } from "vitest";
import { oauthApi } from "../../src/login/oauth";
import { verifyState, decryptCode } from "../../src/login/utils";

const LOGIN_SECRET = "a".repeat(64);
const TEST_ENV = {
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
  LOGIN_SECRET,
};

function get(path: string, env = TEST_ENV) {
  return oauthApi.request(path, {}, env);
}

function mockGitHub(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

// ---------------------------------------------------------------------------
// GET /authorize
// ---------------------------------------------------------------------------

describe("GET /authorize", () => {
  test("redirects to GitHub authorize endpoint", async () => {
    const res = await get(
      "/authorize?redirect_uri=http://127.0.0.1:8080/&scope=repo,gist&state=abc",
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
  });

  test("substitutes GITHUB_CLIENT_ID", async () => {
    const res = await get(
      "/authorize?redirect_uri=http://127.0.0.1:8080/&state=s",
    );
    const location = new URL(res.headers.get("Location")!);
    expect(location.searchParams.get("client_id")).toBe("test-client-id");
  });

  test("sets redirect_uri to our own callback URL", async () => {
    const res = await get(
      "/authorize?redirect_uri=http://127.0.0.1:8080/&state=s",
    );
    const location = new URL(res.headers.get("Location")!);
    expect(location.searchParams.get("redirect_uri")).toMatch(
      /\/login\/oauth\/callback$/,
    );
  });

  test("forwards scope", async () => {
    const res = await get(
      "/authorize?redirect_uri=http://127.0.0.1:8080/&scope=repo,gist&state=s",
    );
    const location = new URL(res.headers.get("Location")!);
    expect(location.searchParams.get("scope")).toBe("repo,gist");
  });

  test("omits scope when not provided", async () => {
    const res = await get(
      "/authorize?redirect_uri=http://127.0.0.1:8080/&state=s",
    );
    const location = new URL(res.headers.get("Location")!);
    expect(location.searchParams.has("scope")).toBe(false);
  });

  test("forwards login hint when present", async () => {
    const res = await get(
      "/authorize?redirect_uri=http://127.0.0.1:8080/&state=s&login=alice",
    );
    const location = new URL(res.headers.get("Location")!);
    expect(location.searchParams.get("login")).toBe("alice");
  });

  test("omits login when not provided", async () => {
    const res = await get(
      "/authorize?redirect_uri=http://127.0.0.1:8080/&state=s",
    );
    const location = new URL(res.headers.get("Location")!);
    expect(location.searchParams.has("login")).toBe(false);
  });

  test("state round-trip: signed state embeds redirect_uri and client_state", async () => {
    const res = await get(
      "/authorize?redirect_uri=http://127.0.0.1:8080/&scope=repo&state=my-state",
    );
    const location = new URL(res.headers.get("Location")!);
    const signedState = location.searchParams.get("state")!;

    const payload = await verifyState(signedState, LOGIN_SECRET);
    expect(payload).not.toBeNull();
    expect(payload!.redirect_uri).toBe("http://127.0.0.1:8080/");
    expect(payload!.client_state).toBe("my-state");
    expect(payload!.scopes).toBe("repo");
  });

  test("returns 400 when redirect_uri is missing", async () => {
    const res = await get("/authorize?state=s");
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /callback
// ---------------------------------------------------------------------------

async function makeSignedState(
  redirectUri = "http://127.0.0.1:8080/",
  clientState = "client-state",
) {
  // Drive authorize to get a real signed state token.
  const res = await get(
    `/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&scope=repo&state=${clientState}`,
  );
  const location = new URL(res.headers.get("Location")!);
  return location.searchParams.get("state")!;
}

describe("GET /callback", () => {
  afterEach(() => vi.restoreAllMocks());

  test("redirects to loopback with ephemeral code on success", async () => {
    const signedState = await makeSignedState();
    mockGitHub({ access_token: "ghu_real_token", token_type: "bearer", scope: "" });

    const res = await get(
      `/callback?code=gh_code&state=${encodeURIComponent(signedState)}`,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe("http://127.0.0.1:8080/");
    expect(location.searchParams.has("code")).toBe(true);
  });

  test("ephemeral code round-trip: decrypts to the real GitHub token", async () => {
    const signedState = await makeSignedState();
    mockGitHub({ access_token: "ghu_real_token" });

    const res = await get(
      `/callback?code=gh_code&state=${encodeURIComponent(signedState)}`,
    );
    const location = new URL(res.headers.get("Location")!);
    const ephemeralCode = location.searchParams.get("code")!;

    const decoded = await decryptCode(ephemeralCode, LOGIN_SECRET);
    expect(decoded).not.toBeNull();
    expect(decoded!.token).toBe("ghu_real_token");
  });

  test("preserves client state in redirect", async () => {
    const signedState = await makeSignedState("http://127.0.0.1:8080/", "xyz789");
    mockGitHub({ access_token: "ghu_token" });

    const res = await get(
      `/callback?code=gh_code&state=${encodeURIComponent(signedState)}`,
    );
    const location = new URL(res.headers.get("Location")!);
    expect(location.searchParams.get("state")).toBe("xyz789");
  });

  test("returns 400 for invalid signed state", async () => {
    const res = await get("/callback?code=gh_code&state=invalid");
    expect(res.status).toBe(400);
  });

  test("returns 400 when state is missing", async () => {
    const res = await get("/callback?code=gh_code");
    expect(res.status).toBe(400);
  });

  test("redirects to loopback with error when GitHub returns an error", async () => {
    const signedState = await makeSignedState();
    mockGitHub({ error: "bad_verification_code" });

    const res = await get(
      `/callback?code=bad&state=${encodeURIComponent(signedState)}`,
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe("http://127.0.0.1:8080/");
    expect(location.searchParams.get("error")).toBe("bad_verification_code");
  });

  test("sends our client_id and client_secret to GitHub for code exchange", async () => {
    const signedState = await makeSignedState();
    const spy = mockGitHub({ access_token: "ghu_token" });

    await get(
      `/callback?code=gh_code&state=${encodeURIComponent(signedState)}`,
    );
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const params = init.body as URLSearchParams;
    expect(params.get("client_id")).toBe("test-client-id");
    expect(params.get("client_secret")).toBe("test-client-secret");
    expect(params.get("code")).toBe("gh_code");
  });
});
