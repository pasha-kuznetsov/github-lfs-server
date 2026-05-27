import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { describe, test, expect, afterEach } from "vitest";
import { AdminEntrypoint } from "../../src/admin/entrypoint";

afterEach(async () => {
  await reset();
});

function server() {
  return new AdminEntrypoint({} as ExecutionContext, env as unknown as CloudflareBindings);
}

describe("AdminEntrypoint.blockRepo", () => {
  test("sets blocked flag in Admin DO", async () => {
    await server().blockRepo("owner", "repo");
    expect(await env.ADMIN.getByName("owner/repo").isBlocked()).toBe(true);
  });
});

describe("AdminEntrypoint.unblockRepo", () => {
  test("clears blocked flag in Admin DO", async () => {
    await server().blockRepo("owner", "repo");
    await server().unblockRepo("owner", "repo");
    expect(await env.ADMIN.getByName("owner/repo").isBlocked()).toBe(false);
  });
});

describe("AdminEntrypoint.purgeRepo", () => {
  test("resolves without error", async () => {
    await server().blockRepo("owner", "repo");
    await env.LOCKS.getByName("owner/repo").create("alice", "file.bin");
    await expect(server().purgeRepo("owner", "repo")).resolves.toBeUndefined();
  });

  test("is idempotent", async () => {
    await server().purgeRepo("owner", "repo");
    await expect(server().purgeRepo("owner", "repo")).resolves.toBeUndefined();
  });
});
