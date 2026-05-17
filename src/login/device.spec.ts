import { vi, describe, test, expect, afterEach } from "vitest";
import { deviceApi } from "./device";

const TEST_ENV = { GITHUB_CLIENT_ID: "test-client-id" };

const DEVICE_CODE_BODY = {
  device_code: "abc123",
  user_code: "ABCD-1234",
  verification_uri: "https://github.com/login/device",
  expires_in: 900,
  interval: 5,
};

function mockGitHub(body: unknown, status = 200, contentType = "application/json") {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": contentType },
    }),
  );
}

function post(scope?: string, accept = "application/json") {
  const params = new URLSearchParams({ client_id: "caller-client-id" });
  if (scope) params.set("scope", scope);
  return deviceApi.request(
    "/code",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: accept },
      body: params,
    },
    TEST_ENV,
  );
}

// Extracts the URLSearchParams sent to GitHub from the spy's first call.
function sentParams(spy: ReturnType<typeof vi.spyOn>): URLSearchParams {
  const [, init] = spy.mock.calls[0] as [string, RequestInit];
  return init.body as URLSearchParams;
}

describe("POST /device/code", () => {
  afterEach(() => vi.restoreAllMocks());

  test("returns 200 with GitHub's response body", async () => {
    mockGitHub(DEVICE_CODE_BODY);
    const res = await post("repo,gist");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEVICE_CODE_BODY);
  });

  test("substitutes GITHUB_CLIENT_ID, discards caller's client_id", async () => {
    const spy = mockGitHub(DEVICE_CODE_BODY);
    await post("repo");
    expect(sentParams(spy).get("client_id")).toBe("test-client-id");
  });

  test("forwards scope to GitHub", async () => {
    const spy = mockGitHub(DEVICE_CODE_BODY);
    await post("repo,gist,workflow");
    expect(sentParams(spy).get("scope")).toBe("repo,gist,workflow");
  });

  test("omits scope when caller sends none", async () => {
    const spy = mockGitHub(DEVICE_CODE_BODY);
    await post();
    expect(sentParams(spy).has("scope")).toBe(false);
  });

  test("forwards Accept header to GitHub", async () => {
    const spy = mockGitHub(DEVICE_CODE_BODY);
    await post("repo", "application/json");
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["Accept"]).toBe("application/json");
  });

  test("proxies GitHub error responses verbatim", async () => {
    mockGitHub({ error: "access_denied" }, 400);
    const res = await post("repo");
    expect(res.status).toBe(400);
    expect((await res.json() as any).error).toBe("access_denied");
  });

  test("targets the correct GitHub endpoint", async () => {
    const spy = mockGitHub(DEVICE_CODE_BODY);
    await post("repo");
    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://github.com/login/device/code");
  });
});
