import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { describe, test, expect, afterEach } from "vitest";

afterEach(async () => {
  await reset();
});

function admin() {
  return env.ADMIN.getByName("owner/repo");
}

describe("isBlocked", () => {
  test("returns false when no block set", async () => {
    expect(await admin().isBlocked()).toBe(false);
  });
});

describe("block", () => {
  test("sets blocked to true", async () => {
    await admin().block();
    expect(await admin().isBlocked()).toBe(true);
  });

  test("is idempotent", async () => {
    await admin().block();
    await admin().block();
    expect(await admin().isBlocked()).toBe(true);
  });
});

describe("unblock", () => {
  test("clears blocked flag", async () => {
    await admin().block();
    await admin().unblock();
    expect(await admin().isBlocked()).toBe(false);
  });

  test("is idempotent when already unblocked", async () => {
    await admin().unblock();
    expect(await admin().isBlocked()).toBe(false);
  });
});

describe("purge", () => {
  test("resolves without error", async () => {
    await admin().block();
    await expect(admin().purge()).resolves.toBeUndefined();
  });

  test("is idempotent", async () => {
    await admin().purge();
    await expect(admin().purge()).resolves.toBeUndefined();
  });
});
