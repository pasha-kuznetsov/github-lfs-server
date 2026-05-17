import { describe, test, expect } from "vitest";
import { get } from "./fetch";

describe("GET /api/v3/meta", () => {
  test("returns 200", async () => {
    const res = await get("/api/v3/meta");
    expect(res.status).toBe(200);
  });

  test("returns JSON with GCM OAuth fields", async () => {
    const body = (await (await get("/api/v3/meta")).json()) as {
      verifiable_password_authentication: boolean;
      installed_version: string;
    };
    expect(body.verifiable_password_authentication).toBe(false);
    expect(body.installed_version).toMatch(/^3\./);
  });
});
