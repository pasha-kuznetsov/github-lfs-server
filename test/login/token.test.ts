import { vi, describe, test, expect, afterEach } from "vitest";
import { tokenApi } from "../../src/login/oauth-token";
import { oauthApi } from "../../src/login/oauth";
import { encryptCode } from "../../src/login/utils";

const LOGIN_SECRET = "a".repeat(64);
const TEST_ENV = {
  GITHUB_CLIENT_ID: "test-client-id",
  GITHUB_CLIENT_SECRET: "test-client-secret",
  LOGIN_SECRET,
};

function mockGitHub(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

function post(fields: Record<string, string>) {
  return tokenApi.request(
    "/access_token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields),
    },
    TEST_ENV,
  );
}

function sentParams(spy: ReturnType<typeof vi.spyOn>): URLSearchParams {
  const [, init] = spy.mock.calls[0] as [string, RequestInit];
  return init.body as URLSearchParams;
}

describe("POST /login/oauth/access_token — device code grant", () => {
  afterEach(() => vi.restoreAllMocks());

  test("returns token on successful poll", async () => {
    const token = { access_token: "ghu_abc", token_type: "bearer", scope: "" };
    mockGitHub(token);
    const res = await post({ device_code: "dev123", client_id: "caller-id" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(token);
  });

  test("proxies authorization_pending verbatim", async () => {
    mockGitHub({ error: "authorization_pending" });
    const res = await post({ device_code: "dev123" });
    expect((await res.json() as any).error).toBe("authorization_pending");
  });

  test("proxies slow_down verbatim", async () => {
    mockGitHub({ error: "slow_down" });
    const res = await post({ device_code: "dev123" });
    expect((await res.json() as any).error).toBe("slow_down");
  });

  test("proxies expired_token verbatim", async () => {
    mockGitHub({ error: "expired_token" });
    const res = await post({ device_code: "dev123" });
    expect((await res.json() as any).error).toBe("expired_token");
  });

  test("proxies access_denied verbatim", async () => {
    mockGitHub({ error: "access_denied" });
    const res = await post({ device_code: "dev123" });
    expect((await res.json() as any).error).toBe("access_denied");
  });

  test("substitutes client_id and adds client_secret", async () => {
    const spy = mockGitHub({ access_token: "ghu_abc" });
    await post({ device_code: "dev123", client_id: "caller-id" });
    const params = sentParams(spy);
    expect(params.get("client_id")).toBe("test-client-id");
    expect(params.get("client_secret")).toBe("test-client-secret");
  });

  test("forwards device_code to GitHub", async () => {
    const spy = mockGitHub({ access_token: "ghu_abc" });
    await post({ device_code: "dev123" });
    expect(sentParams(spy).get("device_code")).toBe("dev123");
  });

  test("sets the device code grant_type", async () => {
    const spy = mockGitHub({ access_token: "ghu_abc" });
    await post({ device_code: "dev123" });
    expect(sentParams(spy).get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:device_code",
    );
  });

  test("targets the correct GitHub endpoint", async () => {
    const spy = mockGitHub({ access_token: "ghu_abc" });
    await post({ device_code: "dev123" });
    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://github.com/login/oauth/access_token");
  });
});

describe("POST /login/oauth/access_token — auth code grant", () => {
  test("returns token when ephemeral code is valid", async () => {
    const code = await encryptCode({ token: "ghu_real" }, LOGIN_SECRET);
    const res = await post({ code });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.access_token).toBe("ghu_real");
    expect(body.token_type).toBe("bearer");
    expect(body.scope).toBe("");
  });

  test("returns 400 for a tampered ephemeral code", async () => {
    const code = await encryptCode({ token: "ghu_real" }, LOGIN_SECRET);
    const parts = code.split(".");
    parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
    const res = await post({ code: parts.join(".") });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe("invalid_grant");
  });

  test("returns 400 for an expired ephemeral code", async () => {
    const code = await encryptCode({ token: "ghu_real" }, LOGIN_SECRET, -1);
    const res = await post({ code });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe("invalid_grant");
  });

  test("returns 400 for a garbage code string", async () => {
    const res = await post({ code: "not-a-real-code" });
    expect(res.status).toBe(400);
  });
});

describe("POST /login/oauth/access_token — unsupported grant", () => {
  test("returns 400 when neither device_code nor code is present", async () => {
    const res = await post({ grant_type: "client_credentials" });
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe("unsupported_grant_type");
  });
});

// ---------------------------------------------------------------------------
// Full browser flow: authorize → callback → access_token
// ---------------------------------------------------------------------------

describe("browser flow end-to-end", () => {
  afterEach(() => vi.restoreAllMocks());

  test("token survives the full authorize → callback → access_token chain", async () => {
    // Step 1: authorize — get a signed state from our server
    const authorizeRes = await oauthApi.request(
      "/authorize?redirect_uri=http://127.0.0.1:8080/&scope=repo&state=e2e-state",
      {},
      TEST_ENV,
    );
    const authorizeLocation = new URL(authorizeRes.headers.get("Location")!);
    const signedState = authorizeLocation.searchParams.get("state")!;

    // Step 2: callback — GitHub redirects back; exchange code for ephemeral token
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: "ghu_e2e_token" }), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    const callbackRes = await oauthApi.request(
      `/callback?code=gh_code&state=${encodeURIComponent(signedState)}`,
      {},
      TEST_ENV,
    );
    const callbackLocation = new URL(callbackRes.headers.get("Location")!);
    const ephemeralCode = callbackLocation.searchParams.get("code")!;
    const returnedState = callbackLocation.searchParams.get("state");

    // Step 3: access_token — client exchanges ephemeral code for real token
    const tokenRes = await post({ code: ephemeralCode });
    const tokenBody = await tokenRes.json() as any;

    expect(tokenRes.status).toBe(200);
    expect(tokenBody.access_token).toBe("ghu_e2e_token");
    expect(tokenBody.token_type).toBe("bearer");
    expect(returnedState).toBe("e2e-state");
  });
});
