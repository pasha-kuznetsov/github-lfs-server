import { describe, test, expect } from "vitest";
import { get } from "./fetch";

describe("GET /login/oauth/authorize", () => {
  test("returns 400 when redirect_uri is missing", async () => {
    const res = await get("/login/oauth/authorize?state=s");
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "missing_redirect_uri",
    });
  });

  test("redirects to GitHub with client_id from worker env", async () => {
    const res = await get(
      "/login/oauth/authorize?redirect_uri=http://127.0.0.1:8080/&state=s",
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("Location")!);
    expect(location.origin + location.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(location.searchParams.get("client_id")).toBe("test-client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://test.example.com/login/oauth/callback",
    );
  });
});

describe("GET /login/oauth/callback", () => {
  test("returns 400 when state is missing", async () => {
    const res = await get("/login/oauth/callback?code=x");
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "invalid_state",
    });
  });

  test("returns 400 when state is not a valid signed token", async () => {
    const res = await get("/login/oauth/callback?code=x&state=not-a-jwt");
    expect(res.status).toBe(400);
    expect((await res.json()) as { error: string }).toEqual({
      error: "invalid_state",
    });
  });
});
