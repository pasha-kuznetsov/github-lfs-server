import { describe, test, expect } from "vitest";
import { postForm } from "./fetch";

describe("POST /login/oauth/access_token", () => {
  test("returns 400 when no grant parameters are provided", async () => {
    const res = await postForm(
      "/login/oauth/access_token",
      new URLSearchParams({ unrelated: "param" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "unsupported_grant_type",
    });
  });

  test("returns 400 invalid_grant for malformed ephemeral code", async () => {
    const res = await postForm(
      "/login/oauth/access_token",
      new URLSearchParams({ code: "not-a-valid-code" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "invalid_grant",
    });
  });
});
