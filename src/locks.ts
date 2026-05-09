import type { Context } from "hono";
import {
  createLockRequestSchema,
  lockVerifyRequestSchema,
  unlockRequestSchema,
} from "./schema.zod";

type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: { user: string };
};

type LockRow = { id: string; owner: string; path: string; locked_at: string };

function generateLockId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(20)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function toApiLock(row: LockRow) {
  return { id: row.id, path: row.path, locked_at: row.locked_at, owner: { name: row.owner } };
}

function repoKey(c: Context<AppEnv>): string {
  return `${c.req.param("owner")}/${c.req.param("repo").replace(/\.git$/, "")}`;
}

const SELECT_LOCK = "SELECT id, owner, path, locked_at FROM locks";

// ---------------------------------------------------------------------------
// POST /:owner/:repo/locks — Create Lock
// ---------------------------------------------------------------------------

export async function createLockHandler(c: Context<AppEnv>): Promise<Response> {
  let body: ReturnType<typeof createLockRequestSchema.parse>;
  try {
    body = createLockRequestSchema.parse(await c.req.json());
  } catch {
    return c.json({ message: "Invalid request" }, 422);
  }

  const repo = repoKey(c);
  const user = c.get("user");
  const id = generateLockId();
  const locked_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");

  const result = await c.env.DB
    .prepare("INSERT OR IGNORE INTO locks (id, owner, path, repo, locked_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, user, body.path, repo, locked_at)
    .run();

  if (result.meta.changes === 0) {
    const existing = await c.env.DB
      .prepare(`${SELECT_LOCK} WHERE repo = ? AND path = ?`)
      .bind(repo, body.path)
      .first<LockRow>();
    if (!existing) return c.json({ message: "Internal error" }, 500);
    return c.json({ lock: toApiLock(existing), message: "already created lock" }, 409);
  }

  return c.json({ lock: { id, path: body.path, locked_at, owner: { name: user } } }, 201);
}

// ---------------------------------------------------------------------------
// GET /:owner/:repo/locks — List Locks
// ---------------------------------------------------------------------------

export async function listLocksHandler(c: Context<AppEnv>): Promise<Response> {
  const repo = repoKey(c);
  const pathFilter = c.req.query("path") ?? null;
  const idFilter = c.req.query("id") ?? null;
  const cursor = c.req.query("cursor") ?? null;
  const limitParam = parseInt(c.req.query("limit") ?? "0", 10);
  const limit = Math.min(limitParam > 0 ? limitParam : 100, 100);

  const { results } = await c.env.DB.prepare(`
    ${SELECT_LOCK}
    WHERE repo = ?
      AND (path = ? OR ? IS NULL)
      AND (id = ? OR ? IS NULL)
      AND locked_at >= COALESCE(
        (SELECT locked_at FROM locks WHERE id = ?),
        '0'
      )
    ORDER BY locked_at, id
    LIMIT ?
  `).bind(repo, pathFilter, pathFilter, idFilter, idFilter, cursor, limit + 1).all<LockRow>();

  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;
  const response: Record<string, unknown> = { locks: page.map(toApiLock) };
  if (hasMore) response.next_cursor = results[limit].id;
  return c.json(response);
}

// ---------------------------------------------------------------------------
// POST /:owner/:repo/locks/verify — Verify Locks (pre-push)
// ---------------------------------------------------------------------------

export async function verifyLocksHandler(c: Context<AppEnv>): Promise<Response> {
  let body: ReturnType<typeof lockVerifyRequestSchema.parse> = {};
  try {
    body = lockVerifyRequestSchema.parse(await c.req.json());
  } catch {
    // all fields optional; fall back to defaults
  }

  const repo = repoKey(c);
  const user = c.get("user");
  const cursor = body.cursor ?? null;
  const limitParam = body.limit ?? 0;
  const limit = Math.min(limitParam > 0 ? limitParam : 100, 100);

  const { results } = await c.env.DB.prepare(`
    ${SELECT_LOCK}
    WHERE repo = ?
      AND locked_at >= COALESCE(
        (SELECT locked_at FROM locks WHERE id = ?),
        '0'
      )
    ORDER BY locked_at, id
    LIMIT ?
  `).bind(repo, cursor, limit + 1).all<LockRow>();

  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;
  const response: Record<string, unknown> = {
    ours: page.filter((r) => r.owner === user).map(toApiLock),
    theirs: page.filter((r) => r.owner !== user).map(toApiLock),
  };
  if (hasMore) response.next_cursor = results[limit].id;
  return c.json(response);
}

// ---------------------------------------------------------------------------
// POST /:owner/:repo/locks/:id/unlock — Delete Lock
// ---------------------------------------------------------------------------

export async function unlockHandler(c: Context<AppEnv>): Promise<Response> {
  let body: ReturnType<typeof unlockRequestSchema.parse> = {};
  try {
    body = unlockRequestSchema.parse(await c.req.json());
  } catch {
    // body is optional
  }

  const repo = repoKey(c);
  const lockId = c.req.param("id");
  const user = c.get("user");

  const lock = await c.env.DB
    .prepare(`${SELECT_LOCK} WHERE id = ? AND repo = ?`)
    .bind(lockId, repo)
    .first<LockRow>();

  if (!lock) return c.json({ message: "Lock not found" }, 404);

  if (lock.owner !== user && !body.force) {
    return c.json({ message: "You must have push access to delete locks" }, 403);
  }

  await c.env.DB.prepare("DELETE FROM locks WHERE id = ?").bind(lockId).run();
  return c.json({ lock: toApiLock(lock) });
}
