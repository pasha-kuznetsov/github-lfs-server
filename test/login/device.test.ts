import { afterEach, describe, test, expect, vi } from "vitest";
import { postForm } from "./fetch";

const DEVICE_CODE_BODY = {
  device_code: "abc123",
  user_code: "ABCD-1234",
  verification_uri: "https://github.com/login/device",
  expires_in: 900,
  interval: 5,
};

function mockGitHub(body: unknown, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockImplementationOnce(async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("POST /login/device/code", () => {
  afterEach(() => vi.restoreAllMocks());

  test("proxies to GitHub with worker client_id", async () => {
    const spy = mockGitHub(DEVICE_CODE_BODY);
    const res = await postForm(
      "/login/device/code",
      new URLSearchParams({ client_id: "caller-id", scope: "repo" }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(DEVICE_CODE_BODY);

    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    const params = init.body as URLSearchParams;
    expect(params.get("client_id")).toBe("test-client-id");
    expect(params.get("scope")).toBe("repo");
  });
});
