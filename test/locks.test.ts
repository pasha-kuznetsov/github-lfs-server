import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { Hono } from "hono";
import {
  createLockHandler,
  listLocksHandler,
  verifyLocksHandler,
  unlockHandler,
} from "../src/locks";

// ---------------------------------------------------------------------------
// D1 mock backed by bun:sqlite
// ---------------------------------------------------------------------------

const SCHEMA = readFileSync("sql/schema.d1.sql", "utf8");

type SeedLock = { id: string; owner: string; path: string; repo: string; locked_at: string };

function makeD1(seeds: SeedLock[] = []): D1Database {
  const db = new Database(":memory:");
  SCHEMA.split(";").filter((s) => s.trim()).forEach((s) => db.run(s));
  for (const l of seeds) {
    db.prepare("INSERT INTO locks VALUES (?, ?, ?, ?, ?)").run(
      l.id, l.owner, l.path, l.repo, l.locked_at,
    );
  }

  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      const self = {
        bind(...a: unknown[]) { args = a; return self; },
        async run() {
          const r = db.prepare(sql).run(...(args as any[]));
          return { success: true, meta: { changes: r.changes, last_row_id: r.lastInsertRowid } };
        },
        async first() { return db.prepare(sql).get(...(args as any[])) ?? null; },
        async all() { return { success: true, results: db.prepare(sql).all(...(args as any[])), meta: {} }; },
      };
      return self;
    },
  } as any;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALICE_LOCK: SeedLock = {
  id: "a".repeat(40),
  owner: "alice",
  path: "assets/file-a.bin",
  repo: "alice/repo",
  locked_at: "2024-01-01T00:00:00Z",
};

const BOB_LOCK: SeedLock = {
  id: "b".repeat(40),
  owner: "bob",
  path: "assets/file-b.bin",
  repo: "alice/repo",
  locked_at: "2024-01-02T00:00:00Z",
};

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

type AppEnv = { Bindings: CloudflareBindings; Variables: { user: string } };

function makeApp(user: string) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("user", user); await next(); });
  app.post("/:owner/:repo/locks", createLockHandler);
  app.get("/:owner/:repo/locks", listLocksHandler);
  app.post("/:owner/:repo/locks/verify", verifyLocksHandler);
  app.post("/:owner/:repo/locks/:id/unlock", unlockHandler);
  return app;
}

const alice = makeApp("alice");
const bob = makeApp("bob");

const LFS = {
  "Accept": "application/vnd.git-lfs+json",
  "Content-Type": "application/vnd.git-lfs+json",
};

function env(seeds: SeedLock[] = []) {
  return { DB: makeD1(seeds) } as any;
}

// ---------------------------------------------------------------------------
// Create Lock
// ---------------------------------------------------------------------------

describe("createLockHandler", () => {
  test("201 and returns lock with owner.name on success", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks",
      { method: "POST", headers: LFS, body: JSON.stringify({ path: "file.bin" }) },
      env(),
    );
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.lock.path).toBe("file.bin");
    expect(body.lock.owner.name).toBe("alice");
    expect(typeof body.lock.id).toBe("string");
    expect(body.lock.id).toHaveLength(40);
    expect(body.lock.locked_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  });

  test("409 when path already locked in same repo", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks",
      { method: "POST", headers: LFS, body: JSON.stringify({ path: "assets/file-a.bin" }) },
      env([ALICE_LOCK]),
    );
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.lock.id).toBe(ALICE_LOCK.id);
    expect(typeof body.message).toBe("string");
  });

  test("different repos can lock the same path independently", async () => {
    const e = env([ALICE_LOCK]); // lock exists in alice/repo
    const res = await alice.request(
      "http://w/alice/other-repo/locks",
      { method: "POST", headers: LFS, body: JSON.stringify({ path: "assets/file-a.bin" }) },
      e,
    );
    expect(res.status).toBe(201);
  });

  test("strips .git from repo name", async () => {
    const e = env([ALICE_LOCK]); // seeded as alice/repo
    const res = await alice.request(
      "http://w/alice/repo.git/locks",
      { method: "POST", headers: LFS, body: JSON.stringify({ path: "assets/file-a.bin" }) },
      e,
    );
    // Should see the existing lock in alice/repo → 409
    expect(res.status).toBe(409);
  });

  test("422 for invalid body", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks",
      { method: "POST", headers: LFS, body: "bad" },
      env(),
    );
    expect(res.status).toBe(422);
  });

  test("422 when path is missing", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks",
      { method: "POST", headers: LFS, body: JSON.stringify({}) },
      env(),
    );
    expect(res.status).toBe(422);
  });
});

// ---------------------------------------------------------------------------
// List Locks
// ---------------------------------------------------------------------------

describe("listLocksHandler", () => {
  test("returns empty array when no locks exist", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks",
      { headers: LFS },
      env(),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.locks).toHaveLength(0);
  });

  test("returns all locks in repo", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks",
      { headers: LFS },
      env([ALICE_LOCK, BOB_LOCK]),
    );
    const body = await res.json() as any;
    expect(body.locks).toHaveLength(2);
  });

  test("filters by path", async () => {
    const res = await alice.request(
      `http://w/alice/repo/locks?path=${encodeURIComponent(ALICE_LOCK.path)}`,
      { headers: LFS },
      env([ALICE_LOCK, BOB_LOCK]),
    );
    const body = await res.json() as any;
    expect(body.locks).toHaveLength(1);
    expect(body.locks[0].path).toBe(ALICE_LOCK.path);
  });

  test("filters by id", async () => {
    const res = await alice.request(
      `http://w/alice/repo/locks?id=${ALICE_LOCK.id}`,
      { headers: LFS },
      env([ALICE_LOCK, BOB_LOCK]),
    );
    const body = await res.json() as any;
    expect(body.locks).toHaveLength(1);
    expect(body.locks[0].id).toBe(ALICE_LOCK.id);
  });

  test("lock shape includes id, path, locked_at, owner.name", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks",
      { headers: LFS },
      env([ALICE_LOCK]),
    );
    const body = await res.json() as any;
    const lock = body.locks[0];
    expect(lock.id).toBe(ALICE_LOCK.id);
    expect(lock.path).toBe(ALICE_LOCK.path);
    expect(lock.locked_at).toBe(ALICE_LOCK.locked_at);
    expect(lock.owner.name).toBe(ALICE_LOCK.owner);
  });

  test("does not return locks from other repos", async () => {
    const otherRepo: SeedLock = { ...ALICE_LOCK, id: "c".repeat(40), repo: "alice/other" };
    const res = await alice.request(
      "http://w/alice/repo/locks",
      { headers: LFS },
      env([ALICE_LOCK, otherRepo]),
    );
    const body = await res.json() as any;
    expect(body.locks).toHaveLength(1);
  });

  test("pagination: sets next_cursor when results overflow limit", async () => {
    const lock1: SeedLock = { ...ALICE_LOCK, id: "1".repeat(40), locked_at: "2024-01-01T00:00:00Z" };
    const lock2: SeedLock = { ...ALICE_LOCK, id: "2".repeat(40), path: "b.bin", locked_at: "2024-01-02T00:00:00Z" };
    const lock3: SeedLock = { ...ALICE_LOCK, id: "3".repeat(40), path: "c.bin", locked_at: "2024-01-03T00:00:00Z" };

    const res = await alice.request(
      "http://w/alice/repo/locks?limit=2",
      { headers: LFS },
      env([lock1, lock2, lock3]),
    );
    const body = await res.json() as any;
    expect(body.locks).toHaveLength(2);
    expect(body.next_cursor).toBe(lock3.id);
  });

  test("pagination: no next_cursor when results fit within limit", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks?limit=10",
      { headers: LFS },
      env([ALICE_LOCK]),
    );
    const body = await res.json() as any;
    expect(body).not.toHaveProperty("next_cursor");
  });

  test("cursor: returns locks starting at cursor position", async () => {
    const lock1: SeedLock = { ...ALICE_LOCK, id: "1".repeat(40), locked_at: "2024-01-01T00:00:00Z" };
    const lock2: SeedLock = { ...ALICE_LOCK, id: "2".repeat(40), path: "b.bin", locked_at: "2024-01-02T00:00:00Z" };
    const lock3: SeedLock = { ...ALICE_LOCK, id: "3".repeat(40), path: "c.bin", locked_at: "2024-01-03T00:00:00Z" };

    const res = await alice.request(
      `http://w/alice/repo/locks?cursor=${lock2.id}`,
      { headers: LFS },
      env([lock1, lock2, lock3]),
    );
    const body = await res.json() as any;
    expect(body.locks).toHaveLength(2);
    expect(body.locks[0].id).toBe(lock2.id);
    expect(body.locks[1].id).toBe(lock3.id);
  });
});

// ---------------------------------------------------------------------------
// Verify Locks
// ---------------------------------------------------------------------------

describe("verifyLocksHandler", () => {
  test("partitions locks into ours and theirs", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks/verify",
      { method: "POST", headers: LFS, body: JSON.stringify({}) },
      env([ALICE_LOCK, BOB_LOCK]),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ours).toHaveLength(1);
    expect(body.ours[0].id).toBe(ALICE_LOCK.id);
    expect(body.theirs).toHaveLength(1);
    expect(body.theirs[0].id).toBe(BOB_LOCK.id);
  });

  test("ours and theirs are empty when no locks exist", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks/verify",
      { method: "POST", headers: LFS, body: JSON.stringify({}) },
      env(),
    );
    const body = await res.json() as any;
    expect(body.ours).toHaveLength(0);
    expect(body.theirs).toHaveLength(0);
  });

  test("sets next_cursor on overflow", async () => {
    const lock1: SeedLock = { ...ALICE_LOCK, id: "1".repeat(40), locked_at: "2024-01-01T00:00:00Z" };
    const lock2: SeedLock = { ...BOB_LOCK, id: "2".repeat(40), locked_at: "2024-01-02T00:00:00Z" };
    const lock3: SeedLock = { ...ALICE_LOCK, id: "3".repeat(40), path: "c.bin", locked_at: "2024-01-03T00:00:00Z" };

    const res = await alice.request(
      "http://w/alice/repo/locks/verify",
      { method: "POST", headers: LFS, body: JSON.stringify({ limit: 2 }) },
      env([lock1, lock2, lock3]),
    );
    const body = await res.json() as any;
    expect(body.ours.length + body.theirs.length).toBe(2);
    expect(body.next_cursor).toBe(lock3.id);
  });

  test("accepts empty JSON body", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks/verify",
      { method: "POST", headers: LFS, body: "{}" },
      env([ALICE_LOCK]),
    );
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Unlock
// ---------------------------------------------------------------------------

describe("unlockHandler", () => {
  test("200 and returns deleted lock when owner deletes own lock", async () => {
    const res = await alice.request(
      `http://w/alice/repo/locks/${ALICE_LOCK.id}/unlock`,
      { method: "POST", headers: LFS, body: "{}" },
      env([ALICE_LOCK]),
    );
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.lock.id).toBe(ALICE_LOCK.id);
  });

  test("404 when lock does not exist", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks/nonexistent/unlock",
      { method: "POST", headers: LFS, body: "{}" },
      env(),
    );
    expect(res.status).toBe(404);
  });

  test("403 when non-owner tries to unlock without force", async () => {
    const res = await bob.request(
      `http://w/alice/repo/locks/${ALICE_LOCK.id}/unlock`,
      { method: "POST", headers: LFS, body: "{}" },
      env([ALICE_LOCK]),
    );
    expect(res.status).toBe(403);
  });

  test("200 when non-owner unlocks with force: true", async () => {
    const res = await bob.request(
      `http://w/alice/repo/locks/${ALICE_LOCK.id}/unlock`,
      { method: "POST", headers: LFS, body: JSON.stringify({ force: true }) },
      env([ALICE_LOCK]),
    );
    expect(res.status).toBe(200);
  });

  test("404 when lock exists in different repo", async () => {
    const res = await alice.request(
      `http://w/alice/other-repo/locks/${ALICE_LOCK.id}/unlock`,
      { method: "POST", headers: LFS, body: "{}" },
      env([ALICE_LOCK]),
    );
    expect(res.status).toBe(404);
  });

  test("lock is actually deleted after unlock", async () => {
    const db = makeD1([ALICE_LOCK]);
    const e = { DB: db } as any;

    // unlock
    await alice.request(
      `http://w/alice/repo/locks/${ALICE_LOCK.id}/unlock`,
      { method: "POST", headers: LFS, body: "{}" },
      e,
    );

    // list — should be empty now
    const listRes = await alice.request(
      "http://w/alice/repo/locks",
      { headers: LFS },
      e,
    );
    const body = await listRes.json() as any;
    expect(body.locks).toHaveLength(0);
  });
});
