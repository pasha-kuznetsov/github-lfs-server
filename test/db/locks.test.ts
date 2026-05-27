import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { describe, test, expect, afterEach } from "vitest";

afterEach(async () => {
  await reset();
});

function repo() {
  return env.LOCKS.getByName("owner/repo");
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("create", () => {
  test("returns row with all fields populated", async () => {
    const row = await repo().create("alice", "file.bin");
    expect(typeof row.id).toBe("number");
    expect(row.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(row.owner).toBe("alice");
    expect(row.path).toBe("file.bin");
    expect(row.locked_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  test("auto-increments id across multiple creates", async () => {
    const a = await repo().create("alice", "a.bin");
    const b = await repo().create("alice", "b.bin");
    expect(b.id).toBeGreaterThan(a.id);
  });

  test("throws on duplicate path", async () => {
    await repo().create("alice", "file.bin");
    await expect(() => repo().create("bob", "file.bin")).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getByPath
// ---------------------------------------------------------------------------

describe("getByPath", () => {
  test("returns the lock when path exists", async () => {
    const created = await repo().create("alice", "file.bin");
    const found = await repo().getByPath("file.bin");
    expect(found?.uuid).toBe(created.uuid);
  });

  test("returns undefined when path does not exist", async () => {
    expect(await repo().getByPath("missing.bin")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getById
// ---------------------------------------------------------------------------

describe("getById", () => {
  test("returns the lock when uuid exists", async () => {
    const created = await repo().create("alice", "file.bin");
    const found = await repo().getById(created.uuid);
    expect(found?.id).toBe(created.id);
    expect(found?.path).toBe("file.bin");
  });

  test("returns null when uuid does not exist", async () => {
    expect(
      await repo().getById("00000000-0000-0000-0000-000000000000"),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("list", () => {
  test("returns all locks ordered by id", async () => {
    const a = await repo().create("alice", "a.bin");
    const b = await repo().create("bob", "b.bin");
    const rows = await repo().list({
      uuidFilter: null,
      pathFilter: null,
      cursor: null,
      limit: 100,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].uuid).toBe(a.uuid);
    expect(rows[1].uuid).toBe(b.uuid);
  });

  test("respects limit", async () => {
    await repo().create("alice", "a.bin");
    await repo().create("alice", "b.bin");
    await repo().create("alice", "c.bin");
    const rows = await repo().list({
      uuidFilter: null,
      pathFilter: null,
      cursor: null,
      limit: 2,
    });
    expect(rows).toHaveLength(2);
  });

  test("filters by uuid", async () => {
    const a = await repo().create("alice", "a.bin");
    await repo().create("alice", "b.bin");
    const rows = await repo().list({
      uuidFilter: a.uuid,
      pathFilter: null,
      cursor: null,
      limit: 100,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].uuid).toBe(a.uuid);
  });

  test("filters by path", async () => {
    await repo().create("alice", "a.bin");
    await repo().create("alice", "b.bin");
    const rows = await repo().list({
      uuidFilter: null,
      pathFilter: "a.bin",
      cursor: null,
      limit: 100,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("a.bin");
  });

  test("cursor returns locks with id >= cursor", async () => {
    const a = await repo().create("alice", "a.bin");
    const b = await repo().create("alice", "b.bin");
    const c = await repo().create("alice", "c.bin");
    const rows = await repo().list({
      uuidFilter: null,
      pathFilter: null,
      cursor: b.id,
      limit: 100,
    });
    expect(rows.map((r) => r.uuid)).toEqual([b.uuid, c.uuid]);
  });

  test("cursor works correctly when cursor lock is deleted", async () => {
    const a = await repo().create("alice", "a.bin");
    const b = await repo().create("alice", "b.bin");
    const c = await repo().create("alice", "c.bin");
    await repo().delete(b.uuid);
    const rows = await repo().list({
      uuidFilter: null,
      pathFilter: null,
      cursor: b.id,
      limit: 100,
    });
    expect(rows.map((r) => r.uuid)).toEqual([c.uuid]);
  });

  test("returns empty array when no locks exist", async () => {
    const rows = await repo().list({
      uuidFilter: null,
      pathFilter: null,
      cursor: null,
      limit: 100,
    });
    expect(rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("delete", () => {
  test("removes the lock", async () => {
    const lock = await repo().create("alice", "file.bin");
    await repo().delete(lock.uuid);
    expect(await repo().getById(lock.uuid)).toBeNull();
  });

  test("is a no-op for unknown uuid", async () => {
    await expect(
      repo().delete("00000000-0000-0000-0000-000000000000"),
    ).resolves.toBeUndefined();
  });

  test("does not remove other locks", async () => {
    const a = await repo().create("alice", "a.bin");
    const b = await repo().create("alice", "b.bin");
    await repo().delete(a.uuid);
    expect(await repo().getById(b.uuid)).not.toBeNull();
  });
});

describe("purge", () => {
  test("resolves without error", async () => {
    await repo().create("alice", "a.bin");
    await repo().create("alice", "b.bin");
    await expect(repo().purge()).resolves.toBeUndefined();
  });

  test("is idempotent", async () => {
    await repo().purge();
    await expect(repo().purge()).resolves.toBeUndefined();
  });
});
