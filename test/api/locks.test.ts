import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { describe, test, expect, afterEach } from "vitest";

afterEach(async () => {
  await reset();
});

import { Hono } from "hono";
import { initLocksApi } from "../../src/api/locks";
import type { AppEnv } from "../../src/index";

function makeApp(user: string, access: "read" | "write" = "write") {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("user", user);
    c.set("access", access);
    await next();
  });
  initLocksApi(app);
  return app;
}

const alice = makeApp("alice");
const bob = makeApp("bob");
const readAlice = makeApp("alice", "read");

const LFS = {
  Accept: "application/vnd.git-lfs+json",
  "Content-Type": "application/vnd.git-lfs+json",
};

function locksStub(repo: string) {
  return env.LOCKS.getByName(repo);
}

// ---------------------------------------------------------------------------
// Create Lock
// ---------------------------------------------------------------------------

describe("createLockHandler", () => {
  test("201 and returns lock with owner.name on success", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks",
      {
        method: "POST",
        headers: LFS,
        body: JSON.stringify({ path: "file.bin" }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.lock.path).toBe("file.bin");
    expect(body.lock.owner.name).toBe("alice");
    expect(typeof body.lock.id).toBe("string");
    expect(body.lock.locked_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );
  });

  test("409 when path already locked in same repo", async () => {
    const existing = await locksStub("alice/repo").create(
      "alice",
      "assets/file-a.bin",
    );
    const res = await alice.request(
      "http://w/alice/repo/locks",
      {
        method: "POST",
        headers: LFS,
        body: JSON.stringify({ path: "assets/file-a.bin" }),
      },
      env,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as any;
    expect(body.lock.id).toBe(existing.uuid);
    expect(typeof body.message).toBe("string");
  });

  test("different repos can lock the same path independently", async () => {
    await locksStub("alice/repo").create("alice", "assets/file-a.bin");
    const res = await alice.request(
      "http://w/alice/other-repo/locks",
      {
        method: "POST",
        headers: LFS,
        body: JSON.stringify({ path: "assets/file-a.bin" }),
      },
      env,
    );
    expect(res.status).toBe(201);
  });

  test("strips .git from repo name", async () => {
    await locksStub("alice/repo").create("alice", "assets/file-a.bin");
    const res = await alice.request(
      "http://w/alice/repo.git/locks",
      {
        method: "POST",
        headers: LFS,
        body: JSON.stringify({ path: "assets/file-a.bin" }),
      },
      env,
    );
    expect(res.status).toBe(409);
  });

  test("400 for invalid body", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks",
      { method: "POST", headers: LFS, body: "bad" },
      env,
    );
    expect(res.status).toBe(400);
  });

  test("422 when path is missing", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks",
      { method: "POST", headers: LFS, body: JSON.stringify({}) },
      env,
    );
    expect(res.status).toBe(422);
  });

  test("403 when read-only user attempts to create a lock", async () => {
    const res = await readAlice.request(
      "http://w/alice/repo/locks",
      { method: "POST", headers: LFS, body: JSON.stringify({ path: "file.bin" }) },
      env,
    );
    expect(res.status).toBe(403);
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
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.locks).toHaveLength(0);
  });

  test("returns all locks in repo", async () => {
    const stub = locksStub("alice/repo");
    await stub.create("alice", "assets/file-a.bin");
    await stub.create("bob", "assets/file-b.bin");
    const res = await alice.request(
      "http://w/alice/repo/locks",
      { headers: LFS },
      env,
    );
    const body = (await res.json()) as any;
    expect(body.locks).toHaveLength(2);
  });

  test("filters by path", async () => {
    const stub = locksStub("alice/repo");
    const aliceLock = await stub.create("alice", "assets/file-a.bin");
    await stub.create("bob", "assets/file-b.bin");
    const res = await alice.request(
      `http://w/alice/repo/locks?path=${encodeURIComponent(aliceLock.path)}`,
      { headers: LFS },
      env,
    );
    const body = (await res.json()) as any;
    expect(body.locks).toHaveLength(1);
    expect(body.locks[0].path).toBe(aliceLock.path);
  });

  test("filters by id", async () => {
    const stub = locksStub("alice/repo");
    const aliceLock = await stub.create("alice", "assets/file-a.bin");
    await stub.create("bob", "assets/file-b.bin");
    const res = await alice.request(
      `http://w/alice/repo/locks?id=${aliceLock.uuid}`,
      { headers: LFS },
      env,
    );
    const body = (await res.json()) as any;
    expect(body.locks).toHaveLength(1);
    expect(body.locks[0].id).toBe(aliceLock.uuid);
  });

  test("lock shape includes id, path, locked_at, owner.name", async () => {
    const lock = await locksStub("alice/repo").create(
      "alice",
      "assets/file-a.bin",
    );
    const res = await alice.request(
      "http://w/alice/repo/locks",
      { headers: LFS },
      env,
    );
    const body = (await res.json()) as any;
    const item = body.locks[0];
    expect(item.id).toBe(lock.uuid);
    expect(item.path).toBe(lock.path);
    expect(item.locked_at).toBe(lock.locked_at);
    expect(item.owner.name).toBe(lock.owner);
  });

  test("does not return locks from other repos", async () => {
    await locksStub("alice/repo").create("alice", "assets/file-a.bin");
    await locksStub("alice/other").create("alice", "assets/file-a.bin");
    const res = await alice.request(
      "http://w/alice/repo/locks",
      { headers: LFS },
      env,
    );
    const body = (await res.json()) as any;
    expect(body.locks).toHaveLength(1);
  });

  test("pagination: next_cursor enables fetching the remaining locks", async () => {
    const stub = locksStub("alice/repo");
    await stub.create("alice", "a.bin");
    await stub.create("alice", "b.bin");
    await stub.create("alice", "c.bin");

    const page1 = await alice.request(
      "http://w/alice/repo/locks?limit=2",
      { headers: LFS },
      env,
    );
    const body1 = (await page1.json()) as any;
    expect(body1.locks).toHaveLength(2);
    expect(body1.next_cursor).toBeDefined();

    const page2 = await alice.request(
      `http://w/alice/repo/locks?cursor=${body1.next_cursor}`,
      { headers: LFS },
      env,
    );
    const body2 = (await page2.json()) as any;
    expect(body2.locks).toHaveLength(1);
    expect(body2).not.toHaveProperty("next_cursor");

    const allIds = [...body1.locks, ...body2.locks].map((l: any) => l.id);
    expect(new Set(allIds).size).toBe(3);
  });

  test("pagination: no next_cursor when results fit within limit", async () => {
    await locksStub("alice/repo").create("alice", "a.bin");
    const res = await alice.request(
      "http://w/alice/repo/locks?limit=10",
      { headers: LFS },
      env,
    );
    const body = (await res.json()) as any;
    expect(body).not.toHaveProperty("next_cursor");
  });

  test("cursor: deleted cursor lock - second page still returns remaining locks", async () => {
    const stub = locksStub("alice/repo");
    await stub.create("alice", "a.bin");
    await stub.create("alice", "b.bin");
    await stub.create("alice", "c.bin");

    // Determine actual sort order by fetching all locks upfront
    const allRes = await alice.request(
      "http://w/alice/repo/locks",
      { headers: LFS },
      env,
    );
    const {
      locks: [first, second, third],
    } = (await allRes.json()) as any;

    // Alice fetches page 1; next_cursor points to the second lock
    const page1Res = await alice.request(
      "http://w/alice/repo/locks?limit=1",
      { headers: LFS },
      env,
    );
    const page1 = (await page1Res.json()) as any;
    expect(page1.next_cursor).toBeDefined();

    // Bob deletes the lock that alice's cursor points to
    await bob.request(
      `http://w/alice/repo/locks/${second.id}/unlock`,
      { method: "POST", headers: LFS, body: JSON.stringify({ force: true }) },
      env,
    );

    // Alice uses the cursor; page 2 should return the third lock without crashing
    const page2Res = await alice.request(
      `http://w/alice/repo/locks?cursor=${page1.next_cursor}`,
      { headers: LFS },
      env,
    );
    expect(page2Res.status).toBe(200);
    const page2 = (await page2Res.json()) as any;
    expect(page2.locks).toHaveLength(1);
    expect(page2.locks[0].id).toBe(third.id);
  });

  test("200 when read-only user lists locks", async () => {
    const res = await readAlice.request(
      "http://w/alice/repo/locks",
      { headers: LFS },
      env,
    );
    expect(res.status).toBe(200);
  });

  test("cursor: returns locks from cursor position inclusive", async () => {
    const stub = locksStub("alice/repo");
    await stub.create("alice", "a.bin");
    await stub.create("alice", "b.bin");
    await stub.create("alice", "c.bin");

    const page1 = await alice.request(
      "http://w/alice/repo/locks?limit=1",
      { headers: LFS },
      env,
    );
    const {
      locks: [firstLock],
      next_cursor,
    } = (await page1.json()) as any;

    const page2 = await alice.request(
      `http://w/alice/repo/locks?cursor=${next_cursor}`,
      { headers: LFS },
      env,
    );
    const body2 = (await page2.json()) as any;
    expect(body2.locks).toHaveLength(2);
    expect(body2.locks[0].id).not.toBe(firstLock.id);
  });
});

// ---------------------------------------------------------------------------
// Verify Locks
// ---------------------------------------------------------------------------

describe("verifyLocksHandler", () => {
  test("partitions locks into ours and theirs", async () => {
    const stub = locksStub("alice/repo");
    const aliceLock = await stub.create("alice", "assets/file-a.bin");
    const bobLock = await stub.create("bob", "assets/file-b.bin");

    const res = await alice.request(
      "http://w/alice/repo/locks/verify",
      { method: "POST", headers: LFS, body: JSON.stringify({}) },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ours).toHaveLength(1);
    expect(body.ours[0].id).toBe(aliceLock.uuid);
    expect(body.theirs).toHaveLength(1);
    expect(body.theirs[0].id).toBe(bobLock.uuid);
  });

  test("ours and theirs are empty when no locks exist", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks/verify",
      { method: "POST", headers: LFS, body: JSON.stringify({}) },
      env,
    );
    const body = (await res.json()) as any;
    expect(body.ours).toHaveLength(0);
    expect(body.theirs).toHaveLength(0);
  });

  test("sets next_cursor on overflow", async () => {
    const stub = locksStub("alice/repo");
    await stub.create("alice", "a.bin");
    await stub.create("bob", "b.bin");
    await stub.create("alice", "c.bin");

    const res = await alice.request(
      "http://w/alice/repo/locks/verify",
      { method: "POST", headers: LFS, body: JSON.stringify({ limit: 2 }) },
      env,
    );
    const body = (await res.json()) as any;
    expect(body.ours.length + body.theirs.length).toBe(2);
    expect(body.next_cursor).toBeDefined();
  });

  test("accepts empty JSON body", async () => {
    await locksStub("alice/repo").create("alice", "assets/file-a.bin");
    const res = await alice.request(
      "http://w/alice/repo/locks/verify",
      { method: "POST", headers: LFS, body: "{}" },
      env,
    );
    expect(res.status).toBe(200);
  });

  test("403 when read-only user attempts to verify locks", async () => {
    const res = await readAlice.request(
      "http://w/alice/repo/locks/verify",
      { method: "POST", headers: LFS, body: "{}" },
      env,
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Unlock
// ---------------------------------------------------------------------------

describe("unlockHandler", () => {
  test("200 and returns deleted lock when owner deletes own lock", async () => {
    const lock = await locksStub("alice/repo").create(
      "alice",
      "assets/file-a.bin",
    );
    const res = await alice.request(
      `http://w/alice/repo/locks/${lock.uuid}/unlock`,
      { method: "POST", headers: LFS, body: "{}" },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.lock.id).toBe(lock.uuid);
  });

  test("404 when lock does not exist", async () => {
    const res = await alice.request(
      "http://w/alice/repo/locks/nonexistent/unlock",
      { method: "POST", headers: LFS, body: "{}" },
      env,
    );
    expect(res.status).toBe(404);
  });

  test("403 when non-owner tries to unlock without force", async () => {
    const lock = await locksStub("alice/repo").create(
      "alice",
      "assets/file-a.bin",
    );
    const res = await bob.request(
      `http://w/alice/repo/locks/${lock.uuid}/unlock`,
      { method: "POST", headers: LFS, body: "{}" },
      env,
    );
    expect(res.status).toBe(403);
  });

  test("200 when non-owner unlocks with force: true", async () => {
    const lock = await locksStub("alice/repo").create(
      "alice",
      "assets/file-a.bin",
    );
    const res = await bob.request(
      `http://w/alice/repo/locks/${lock.uuid}/unlock`,
      { method: "POST", headers: LFS, body: JSON.stringify({ force: true }) },
      env,
    );
    expect(res.status).toBe(200);
  });

  test("404 when lock exists in different repo", async () => {
    const lock = await locksStub("alice/repo").create(
      "alice",
      "assets/file-a.bin",
    );
    const res = await alice.request(
      `http://w/alice/other-repo/locks/${lock.uuid}/unlock`,
      { method: "POST", headers: LFS, body: "{}" },
      env,
    );
    expect(res.status).toBe(404);
  });

  test("403 when read-only user attempts to unlock", async () => {
    const lock = await locksStub("alice/repo").create("alice", "assets/file-a.bin");
    const res = await readAlice.request(
      `http://w/alice/repo/locks/${lock.uuid}/unlock`,
      { method: "POST", headers: LFS, body: "{}" },
      env,
    );
    expect(res.status).toBe(403);
  });

  test("lock is actually deleted after unlock", async () => {
    const lock = await locksStub("alice/repo").create(
      "alice",
      "assets/file-a.bin",
    );

    await alice.request(
      `http://w/alice/repo/locks/${lock.uuid}/unlock`,
      { method: "POST", headers: LFS, body: "{}" },
      env,
    );

    const listRes = await alice.request(
      "http://w/alice/repo/locks",
      { headers: LFS },
      env,
    );
    const body = (await listRes.json()) as any;
    expect(body.locks).toHaveLength(0);
  });
});
