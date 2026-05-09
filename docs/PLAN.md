# LFS Server Implementation Plan

## Overview

This is a Git LFS server implemented as a **Cloudflare Worker** using the **Hono** framework.
Object storage is offloaded to **Cloudflare R2** via presigned S3-compatible URLs.
File locks are stored in **Cloudflare D1** (SQLite).

Two reference implementations inform this plan:
- `../gitlfs-server-cloudflare` — Cloudflare-native prototype (Durable Objects, KV, S3 presign)
- `../lfs-test-server` — canonical Go test server used by the git-lfs project itself

The Go test server (`server_test.go`) is the authoritative source of truth for correct
HTTP behaviour: status codes, header names, cursor semantics, and edge cases.

---

## API Surface

Git LFS clients discover the server by appending `.git/info/lfs` to the git remote URL:

```
Git remote:  https://host/foo/bar
LFS server:  https://host/foo/bar.git/info/lfs
Batch URL:   https://host/foo/bar.git/info/lfs/objects/batch
```

Since this Worker _is_ the LFS server, routes are relative to the Worker root.
All requests carry `Accept: application/vnd.git-lfs+json`; all responses must
return `Content-Type: application/vnd.git-lfs+json`.

Route prefix: `/:owner/:repo` (`:repo` may end in `.git` — strip it when
computing the R2 key prefix).

### Endpoints

| Method | Path                                       | Description              |
|--------|--------------------------------------------|--------------------------|
| POST   | `/:owner/:repo/objects/batch`              | Batch API                |
| POST   | `/:owner/:repo/objects/verify`             | Verify upload            |
| POST   | `/:owner/:repo/locks`                      | Create lock              |
| GET    | `/:owner/:repo/locks`                      | List locks               |
| POST   | `/:owner/:repo/locks/verify`              | Verify locks (pre-push)  |
| POST   | `/:owner/:repo/locks/:id/unlock`           | Delete lock              |

---

## Cloudflare Bindings

Add to `wrangler.jsonc`:

```jsonc
{
  "r2_buckets": [
    { "binding": "LFS_BUCKET", "bucket_name": "lfs-objects" }
  ],
  "d1_databases": [
    { "binding": "DB", "database_name": "lfs-locks", "database_id": "<id>" }
  ],
  "vars": {
    "S3_ENDPOINT": "",       // e.g. https://<account>.r2.cloudflarestorage.com
    "S3_BUCKET_NAME": "lfs-objects",
    "S3_ACCESS_KEY_ID": "",
    "S3_SECRET_ACCESS_KEY": ""
  }
}
```

Secrets (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`) should be
set with `wrangler secret put` rather than committed to vars.

Run `bun run cf-typegen` after each binding change.

---

## Packages

```bash
bun add zod @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

`zod` — request/response validation  
`@aws-sdk/client-s3` + `s3-request-presigner` — presigned R2 URLs (R2 native
binding cannot generate presigned URLs)

---

## Data Model

### D1 Schema (`sql/locks.sql`)

```sql
CREATE TABLE IF NOT EXISTS locks (
  id         TEXT PRIMARY KEY,  -- 20-byte random hex (40 chars), matches lfs-test-server
  owner      TEXT NOT NULL,
  path       TEXT NOT NULL,
  repo       TEXT NOT NULL,     -- "owner/repo" (repo component with .git stripped)
  locked_at  TEXT NOT NULL,     -- RFC 3339, used for sort order
  UNIQUE (repo, path)
);
```

`UNIQUE (repo, path)` enforces one lock per path per repo at the DB level,
turning a race condition into a DB constraint violation rather than a TOCTOU bug.

**Lock ID generation** (matches `randomLockId()` in test server):
```typescript
const id = Array.from(crypto.getRandomValues(new Uint8Array(20)))
  .map(b => b.toString(16).padStart(2, '0')).join('');
```

---

## File Structure

```
src/
  index.ts        -- Hono app, route wiring
  auth.ts         -- GitHub auth middleware (Octokit)
  batch.ts        -- POST /objects/batch handler
  verify.ts       -- POST /objects/verify handler
  locks.ts        -- all /locks handlers
  api-schema.ts   -- Zod schemas
  s3.ts           -- S3Client factory + presign helpers
sql/
  locks.sql       -- D1 schema
```

---

## Implementation Plan

### Phase 1 — Infrastructure

1. **`wrangler.jsonc`** — add R2 and D1 bindings; run `cf-typegen`.
2. **`sql/locks.sql`** — create and apply with `wrangler d1 execute lfs-locks --file sql/locks.sql`.
3. **`src/s3.ts`** — S3Client factory (keyed from env).
4. **`src/api-schema.ts`** — Zod schemas for all request/response shapes (see below).
5. **`src/auth.ts`** — Hono middleware for GitHub auth (Octokit).

### Phase 2 — Batch API

**`src/batch.ts`** — `POST /:owner/:repo/objects/batch`

```
Request:
  operation  "upload" | "download"
  transfers  string[]  (optional; assume ["basic"] if absent)
  objects    { oid: string, size: number }[]
  ref        { name: string }  (optional)
  hash_algo  string  (optional, default "sha256")

Response 200:
  transfer   "basic"
  objects    BatchObject[]
  hash_algo  "sha256"
```

**Upload flow:**
- For each object: check existence via R2 native binding (`LFS_BUCKET.head(key)`).
- If object **already exists** → omit `actions` entirely. Per spec: "the client
  will then assume the server already has it." (`BatchHandler` in test server
  returns download-only for existing objects during upload; the spec is stricter —
  omit actions completely.)
- If not present → generate a presigned `PUT` URL (`PutObjectCommand`, 1 h TTL)
  and a `verify` action pointing to `/:owner/:repo/objects/verify`.
  Pass an HMAC token in the verify action's `header.Authorization` so the verify
  endpoint can confirm the OID/size without re-authenticating with the full token.
- Return `actions.upload` + `actions.verify`.

**Download flow:**
- Check existence via R2 native binding (`LFS_BUCKET.head(key)`).
- If missing → per-object `error: { code: 404, message: "Object not found" }`.
- If present: generate presigned `GET` URL (`GetObjectCommand`, 1 h TTL) → `actions.download`.

**R2 key scheme:** `{owner}/{repo}/{oid}` (strip `.git` suffix from repo).

**Error responses:**
- `401` (missing/wrong auth) with `LFS-Authenticate: Basic realm="Git LFS"`
- `403` (upload but read-only user)
- `422` (invalid JSON / validation failure)

### Phase 3 — Verify

**`src/verify.ts`** — `POST /:owner/:repo/objects/verify`

Client posts `{ oid, size }` after a successful PUT. Server:
1. Validates the HMAC token passed in `Authorization` (prevents arbitrary verify calls).
2. `HeadObjectCommand` the R2 key; checks `ContentLength === size`.
3. Returns `200` if matches, `422` otherwise.

If verify is not required by the deployment, this endpoint can return `200` unconditionally
and the `verify` action can be omitted from batch upload responses.

### Phase 4 — File Locking API

**`src/locks.ts`**

#### `POST /:owner/:repo/locks` — Create Lock

1. Parse `{ path, ref? }`.
2. Try `INSERT INTO locks ... ON CONFLICT DO NOTHING`.
3. If 0 rows inserted: query existing lock, return `409 Conflict` with `{ lock, message }`.
4. Return **`201 Created`** with `{ lock: { id, path, locked_at, owner: { name } } }`.

`owner.name` comes from the authenticated user extracted by the auth middleware.

#### `GET /:owner/:repo/locks` — List Locks

Query params: `path`, `id`, `cursor`, `limit`, `refspec`.

Cursor semantics (from `FilteredLocks` in test server): the cursor is the **ID
of the first lock to include** in the result set (inclusive). `next_cursor` is
set to the ID of the first lock that didn't fit — i.e. `locks[limit]` when
there are more results.

`refspec` is accepted but not filtered on (test server also ignores it).

```sql
-- Resolve cursor to a locked_at value for stable ordering
SELECT * FROM locks
WHERE repo = ?
  AND (path = ? OR ? IS NULL)
  AND (id   = ? OR ? IS NULL)
  AND locked_at >= COALESCE(
        (SELECT locked_at FROM locks WHERE id = ?),  -- cursor (inclusive)
        '0'
      )
ORDER BY locked_at, id
LIMIT ? + 1     -- fetch one extra to detect whether a next page exists
```

Return first `limit` rows; if `limit+1` rows were returned set
`next_cursor` to the `id` of the `(limit+1)`th row.

Server-side max limit: 100. If `limit` is absent or 0, default to 100
(matches `LocksVerifyHandler` default in test server).

Return `{ locks: [...], next_cursor? }`.

#### `POST /:owner/:repo/locks/verify` — Verify (Pre-push)

Body: `{ ref?, cursor?, limit? }` — same cursor semantics as list above.

```sql
SELECT * FROM locks
WHERE repo = ?
  AND locked_at >= COALESCE(
        (SELECT locked_at FROM locks WHERE id = ?),
        '0'
      )
ORDER BY locked_at, id
LIMIT ? + 1
```

Partition by `owner = currentUser` → `ours` / `theirs`.
If limit+1 rows returned, set `next_cursor` to the (limit+1)th row's `id`.

Return `{ ours: [...], theirs: [...], next_cursor? }`.

#### `POST /:owner/:repo/locks/:id/unlock` — Delete Lock

Body: `{ force?, ref? }`.

1. Fetch lock by `id` and `repo`.
2. If not found → `404`.
3. If `owner ≠ currentUser` and `force` is not `true` → `403`.
4. `DELETE FROM locks WHERE id = ?`.
5. Return `200` with `{ lock: <deleted lock> }`.

---

## Authentication

The Git LFS spec (see `git-lfs/docs/api/authentication.md`) defines three ways
clients supply credentials. All three arrive at the server as an `Authorization`
header on the Batch API request — the server does not need to distinguish their
origin.

### How clients obtain credentials

**1. SSH (`git-lfs-authenticate`)**

When the git remote is SSH-based, the LFS client runs:

```bash
$ ssh git@host git-lfs-authenticate owner/repo.git download
```

The SSH server returns JSON:

```json
{
  "header": { "Authorization": "RemoteAuth <token>" },
  "expires_in": 86400
}
```

The client forwards those headers verbatim to every Batch API request.
Our Worker must therefore accept any `Authorization` scheme the SSH server
issues — not just `Basic`. The middleware should treat any credential that
validates against GitHub as authorised, regardless of the scheme prefix (`Basic`, `RemoteAuth`, `Bearer`, etc.).

**2. Git Credentials (HTTP Basic)**

When the remote is HTTPS, git invokes its credential helper and sends the
result as `Authorization: Basic <base64(user:password)>`.

This is the primary flow for HTTPS remotes and the one the Worker is optimised
for.

**3. URL-embedded credentials**

```
https://user:password@host/foo/bar.git
```

Treated identically to Git Credentials by the time the request reaches the
Worker.

### Server-side middleware (`src/auth.ts`)

```
1. Read the Authorization header.
2. If missing → 401 with LFS-Authenticate: Basic realm="Git LFS"
                         and { message: "Credentials needed" }.
3. Strip the scheme prefix; extract the credential token.
   - "Basic <b64>" → base64-decode → split on first ":" → take password field.
   - Any other scheme → treat the raw token as the credential.
4. Validate via GitHub API (Octokit): call getAuthenticated() + repos.get().
5. On failure → 401 (same response as step 2).
6. On success → stash GitHub username in c.set("user", login) for lock owner tracking.
```

On a 401, the `LFS-Authenticate` response header is used instead of the
standard `WWW-Authenticate` so browsers do not pop a password prompt.

### Scope

Authentication delegates to GitHub — any token with read access to the
repo is authorised. No server-side secret required.

---

## Zod Schemas (`src/api-schema.ts`)

```typescript
// Reuse from reference implementation with corrections:
// - transfers optional in batchRequestSchema (z.array(...).optional())
// - lockListResponseSchema locks entries include all fields (not partial)
// - add verifyRequestSchema: z.object({ oid: z.string(), size: z.number() })
// - add lockVerifyRequestSchema: z.object({ ref, cursor, limit })
// - add lockVerifyResponseSchema: z.object({ ours, theirs, next_cursor })
// - add deleteUnlockRequestSchema: z.object({ force, ref })
```

---

## Accept Header Middleware

All LFS API endpoints require `Accept: application/vnd.git-lfs+json`.

**Parsing rule** (from `server_test.go` `MetaMatcher` and `TestMediaTypesParsed`):
strip everything from the first `;` before comparing, so
`application/vnd.git-lfs+json; charset=utf-8` is accepted.

**Wrong Accept → 404**, not 406. The test server registers routes with a
`MatcherFunc` that checks the Accept header; non-matching routes simply aren't
found. Hono achieves the same effect: register a catch-all 404 handler rather
than a 406 middleware, so unrecognised media types fall through naturally.
(The spec lists 406 as *optional*; 404 is what real clients encounter.)

Set `Content-Type: application/vnd.git-lfs+json` on all responses in a global
`app.use` middleware, so handlers don't have to set it individually.

---

## Decisions Derived from `lfs-test-server`

| Observation | Decision |
|-------------|----------|
| Wrong Accept → 404 (route not matched, not 406) | Use route-level Accept matching; 404 on miss |
| `charset=utf-8` stripped before Accept comparison | Strip at first `;` in middleware |
| Lock ID = 20-byte random hex (not UUID) | Use `crypto.getRandomValues(20 bytes)` as hex |
| Locks sorted by `locked_at` (creation time) | `ORDER BY locked_at, id` in all lock queries |
| Cursor = first ID to include (inclusive) | `locked_at >= cursor_locked_at` with `LIMIT n+1` |
| `next_cursor` = ID of first item on next page | Set to `locks[limit].id` when overflow detected |
| Limit 0 / absent → default 100 | Clamp: `Math.min(limit || 100, 100)` |
| `refspec` not filtered (test server ignores it) | Accept param, do not filter on it |
| Batch upload: existing objects → download action only (test server) vs omit actions (spec) | Follow spec: omit `actions` entirely |
| Auth uses `WWW-Authenticate` in test server | Use `LFS-Authenticate` (spec-correct, avoids browser prompt) |
| `/:user/:repo` vs `/:org/:repo` inconsistency in CF prototype | Unified `/:owner/:repo` |
| Lock list returns only `id` in CF prototype | Full lock row from D1 |
| Verify endpoints are stubs in CF prototype | Implemented with R2 head check |
| Create lock returns `200` in CF prototype | `201 Created` (matches test server) |
| `transfers` required in CF prototype | Optional per spec |
| Durable Objects for locks in CF prototype | Replaced with D1 (queryable, paginatable) |
| AWS SDK used for existence check in CF prototype | R2 native `head()` for existence; S3 only for presign |

---

## Implementation Steps

```
1. wrangler.jsonc      -- add bindings
2. sql/locks.sql       -- create D1 table
3. src/s3.ts           -- S3 client factory
4. src/api-schema.ts   -- Zod types
5. src/auth.ts         -- GitHub auth middleware
6. src/batch.ts        -- Batch API (upload + download)
7. src/verify.ts       -- Verify endpoint
8. src/locks.ts        -- All four lock endpoints
9. src/index.ts        -- Wire everything together
```

Each step is independently testable with `bun run dev` + `bun test`.

---

## Integration Testing

Automated integration tests run locally against a
[Miniflare](https://miniflare.dev/) instance — no real Cloudflare account,
R2 bucket, or D1 database required.

### Stack

| Layer | Tool |
|-------|------|
| Test runner | `bun test` |
| Worker runtime | Miniflare (`../workers-sdk/packages/miniflare`) |
| R2 simulation | Miniflare in-memory R2 |
| D1 simulation | Miniflare in-memory D1 |

### Installation

```bash
bun add -D miniflare
```

Add scripts to `package.json`:

```jsonc
"build": "wrangler deploy --dry-run --outdir dist",
"test":  "bun run build && bun test"
```

Miniflare needs a compiled bundle, not raw TypeScript — the build step runs
wrangler's bundler (esbuild) and writes the output to `dist/`. The `--dry-run`
flag skips the actual upload.

### File Structure

```
test/
  helpers.ts      -- Miniflare factory + shared fixtures
  auth.test.ts    -- auth middleware (401, 403 paths)
  batch.test.ts   -- POST /objects/batch (upload + download flows)
  verify.test.ts  -- POST /objects/verify
  locks.test.ts   -- all four /locks endpoints + pagination
```

### Miniflare Configuration (`test/helpers.ts`)

```typescript
import { readFileSync } from "fs";
import { Miniflare } from "miniflare";

export const TEST_TOKEN = "test-auth-token";
export const ALICE = `Basic ${btoa(`alice:${TEST_TOKEN}`)}`;
export const BOB   = `Basic ${btoa(`bob:${TEST_TOKEN}`)}`;
export const LFS   = {
  "Accept":       "application/vnd.git-lfs+json",
  "Content-Type": "application/vnd.git-lfs+json",
};

const SCHEMA = readFileSync("sql/locks.sql", "utf8");

export async function createMiniflare() {
  const mf = new Miniflare({
    scriptPath: "dist/index.js",
    modules: true,
    compatibilityDate: "2026-05-08",
    compatibilityFlags: ["nodejs_compat"],
    r2Buckets:    ["LFS_BUCKET"],
    d1Databases:  ["DB"],
    bindings: {
      S3_ENDPOINT:          "https://test-account.r2.cloudflarestorage.com",
      S3_ACCESS_KEY_ID:     "test-key-id",
      S3_SECRET_ACCESS_KEY: "test-secret",
      S3_BUCKET_NAME:       "lfs-objects",
    },
  });

  await mf.ready;

  const db = await mf.getD1Database("DB");
  await db.exec(SCHEMA);

  return mf;
}

// Call in beforeEach to prevent test cross-contamination.
export async function resetStorage(mf: Miniflare) {
  const db = await mf.getD1Database("DB");
  await db.prepare("DELETE FROM locks").run();

  const bucket = await mf.getR2Bucket("LFS_BUCKET");
  const listed = await bucket.list();
  await Promise.all(listed.objects.map((o) => bucket.delete(o.key)));
}
```

### Test Patterns

**Auth — missing credentials → 401**

```typescript
const res = await mf.dispatchFetch("http://worker/alice/repo/objects/batch", {
  method: "POST",
  headers: LFS,
  body: JSON.stringify({ operation: "download", objects: [] }),
});
expect(res.status).toBe(401);
expect(res.headers.get("LFS-Authenticate")).toBe('Basic realm="Git LFS"');
```

**Wrong Accept → 404**

```typescript
const res = await mf.dispatchFetch("http://worker/alice/repo/objects/batch", {
  method: "POST",
  headers: { Authorization: ALICE, Accept: "application/json" },
  body: JSON.stringify({ operation: "download", objects: [] }),
});
expect(res.status).toBe(404);
```

**Batch download — object exists** (seed R2 via Node-side binding)

```typescript
const bucket = await mf.getR2Bucket("LFS_BUCKET");
await bucket.put("alice/repo/abc123", new Uint8Array([1, 2, 3]));

const res = await mf.dispatchFetch("http://worker/alice/repo/objects/batch", {
  method: "POST",
  headers: { ...LFS, Authorization: ALICE },
  body: JSON.stringify({ operation: "download", objects: [{ oid: "abc123", size: 3 }] }),
});
const body = await res.json() as any;
expect(res.status).toBe(200);
expect(body.objects[0].actions.download.href).toMatch(/^https:\/\//);
expect(body.objects[0]).not.toHaveProperty("error");
```

**Batch download — object missing → per-object error**

```typescript
const res = await mf.dispatchFetch("http://worker/alice/repo/objects/batch", {
  method: "POST",
  headers: { ...LFS, Authorization: ALICE },
  body: JSON.stringify({ operation: "download", objects: [{ oid: "deadbeef", size: 0 }] }),
});
const body = await res.json() as any;
expect(body.objects[0].error.code).toBe(404);
```

**Batch upload — new object → upload + verify actions**

```typescript
const res = await mf.dispatchFetch("http://worker/alice/repo/objects/batch", {
  method: "POST",
  headers: { ...LFS, Authorization: ALICE },
  body: JSON.stringify({ operation: "upload", objects: [{ oid: "deadbeef", size: 1024 }] }),
});
const body = await res.json() as any;
expect(body.objects[0].actions.upload.href).toMatch(/^https:\/\//);
expect(body.objects[0].actions.verify.href).toMatch(/^https?:\/\//);
```

**Batch upload — object already in R2 → no actions**

```typescript
const bucket = await mf.getR2Bucket("LFS_BUCKET");
await bucket.put("alice/repo/abc123", new Uint8Array([1, 2, 3]));

const res = await mf.dispatchFetch("http://worker/alice/repo/objects/batch", {
  method: "POST",
  headers: { ...LFS, Authorization: ALICE },
  body: JSON.stringify({ operation: "upload", objects: [{ oid: "abc123", size: 3 }] }),
});
const body = await res.json() as any;
expect(body.objects[0]).not.toHaveProperty("actions");
```

**Lock lifecycle — create, list, verify, delete**

```typescript
// Create
const create = await mf.dispatchFetch("http://worker/alice/repo/locks", {
  method: "POST",
  headers: { ...LFS, Authorization: ALICE },
  body: JSON.stringify({ path: "assets/large.bin" }),
});
expect(create.status).toBe(201);
const { lock } = await create.json() as any;
expect(lock.owner.name).toBe("alice");

// Duplicate → 409
const dup = await mf.dispatchFetch("http://worker/alice/repo/locks", {
  method: "POST",
  headers: { ...LFS, Authorization: ALICE },
  body: JSON.stringify({ path: "assets/large.bin" }),
});
expect(dup.status).toBe(409);

// List
const list = await mf.dispatchFetch("http://worker/alice/repo/locks", {
  headers: { ...LFS, Authorization: ALICE },
});
const listBody = await list.json() as any;
expect(listBody.locks).toHaveLength(1);

// Unlock by non-owner without force → 403
const badUnlock = await mf.dispatchFetch(
  `http://worker/alice/repo/locks/${lock.id}/unlock`,
  { method: "POST", headers: { ...LFS, Authorization: BOB }, body: "{}" }
);
expect(badUnlock.status).toBe(403);

// Unlock by non-owner with force → 200
const forceUnlock = await mf.dispatchFetch(
  `http://worker/alice/repo/locks/${lock.id}/unlock`,
  { method: "POST", headers: { ...LFS, Authorization: BOB },
    body: JSON.stringify({ force: true }) }
);
expect(forceUnlock.status).toBe(200);
```

### Presigned URL Limitation

The batch endpoint generates presigned S3 URLs via `@aws-sdk/client-s3`.
In tests, fake credentials produce structurally valid but non-functional URLs.
Tests assert URL format (`/^https:\/\//`) rather than exercising them.

To seed objects into R2 for download tests or verify-endpoint tests, use the
Node-side binding (`mf.getR2Bucket("LFS_BUCKET").put(...)`) to bypass the
presign path entirely. This covers all server logic without needing a real
S3-compatible endpoint.

End-to-end upload/download through presigned URLs is out of scope for local
integration testing and is verified during staging deployment against real R2.

### Test Coverage Map

| Scenario | Endpoint | Assertion |
|----------|----------|-----------|
| TestGetUnAuthed | POST /objects/batch | 401 + `LFS-Authenticate` header |
| TestGetBadAuth | POST /objects/batch | 401 on wrong password |
| TestMediaTypesRequired | POST /objects/batch | 404 on wrong Accept |
| TestMediaTypesParsed | POST /objects/batch | 200 on `charset=utf-8` suffix |
| Batch upload — new object | POST /objects/batch | response has `upload` + `verify` actions |
| Batch upload — existing | POST /objects/batch | no `actions` key |
| Batch download — exists | POST /objects/batch | `download` action URL present |
| Batch download — missing | POST /objects/batch | per-object `error.code = 404` |
| Verify — object present + size match | POST /objects/verify | 200 |
| Verify — size mismatch | POST /objects/verify | 422 |
| TestLock | POST /locks | 201, `lock.owner.name = "alice"` |
| TestLockExists | POST /locks | 409 on duplicate path |
| TestLockUnAuthed | POST /locks | 401 |
| TestLocksList | GET /locks | 200, full lock rows |
| TestLocksListUnAuthed | GET /locks | 401 |
| Cursor pagination | GET /locks?cursor= | `next_cursor` set when page overflows |
| TestLocksVerify | POST /locks/verify | `ours`/`theirs` partition correct |
| TestUnlock | POST /locks/:id/unlock | 200, deleted lock in body |
| TestUnLockUnAuthed | POST /locks/:id/unlock | 401 |
| TestUnlockNotOwner | POST /locks/:id/unlock | 403 without `force` |
| TestUnlockNotOwnerForce | POST /locks/:id/unlock | 200 with `force: true` |

---

## Smoke Tests (Manual with `curl`)

Quick ad-hoc verification against `bun run dev` (real wrangler local server).
Set `TOKEN` to whatever `AUTH_TOKEN` is configured in `.dev.vars`.

```bash
BASE=http://localhost:8787/alice/repo
LFS="-H 'Accept: application/vnd.git-lfs+json' -H 'Content-Type: application/vnd.git-lfs+json'"

# TestGetUnAuthed / TestLocksListUnAuthed — missing auth → 401 + LFS-Authenticate header
curl -si -X POST $BASE/objects/batch $LFS \
  -d '{"operation":"download","objects":[]}'
# Expect: 401, header LFS-Authenticate: Basic realm="Git LFS"

# TestGetBadAuth — wrong password → 401
curl -si -u alice:wrongpass -X POST $BASE/objects/batch $LFS \
  -d '{"operation":"download","objects":[]}'
# Expect: 401

# TestMediaTypesRequired — wrong Accept → 404
curl -si -u alice:$TOKEN -X POST $BASE/objects/batch \
  -H "Accept: application/json" \
  -d '{"operation":"download","objects":[]}'
# Expect: 404

# TestMediaTypesParsed — charset suffix is tolerated
curl -si -u alice:$TOKEN -X POST $BASE/objects/batch \
  -H "Accept: application/vnd.git-lfs+json; charset=utf-8" \
  -d '{"operation":"download","objects":[]}'
# Expect: 200

# Batch upload — new object → presigned PUT URL + verify action
curl -s -u alice:$TOKEN -X POST $BASE/objects/batch $LFS \
  -d '{"operation":"upload","objects":[{"oid":"<sha256>","size":1024}]}'
# Expect: 200, actions.upload.href set, actions.verify.href set

# Batch upload — existing object → no actions (server already has it)
curl -s -u alice:$TOKEN -X POST $BASE/objects/batch $LFS \
  -d '{"operation":"upload","objects":[{"oid":"<existing-sha256>","size":1024}]}'
# Expect: 200, object present but no "actions" key

# Batch download — missing object → per-object 404 error
curl -s -u alice:$TOKEN -X POST $BASE/objects/batch $LFS \
  -d '{"operation":"download","objects":[{"oid":"<missing-sha256>","size":1024}]}'
# Expect: 200, object has error.code=404

# TestLock — create lock → 201 + lock with owner.name = username
curl -si -u alice:$TOKEN -X POST $BASE/locks $LFS \
  -d '{"path":"assets/large.bin"}'
# Expect: 201, body has lock.id, lock.owner.name="alice"

# TestLockExists — duplicate path → 409
curl -si -u alice:$TOKEN -X POST $BASE/locks $LFS \
  -d '{"path":"assets/large.bin"}'
# Expect: 409

# TestLockUnAuthed — no auth → 401
curl -si -X POST $BASE/locks $LFS -d '{"path":"foo"}'
# Expect: 401

# TestLocksList — list locks
curl -s -u alice:$TOKEN $BASE/locks \
  -H "Accept: application/vnd.git-lfs+json"
# Expect: 200, locks array with id/path/locked_at/owner

# TestLocksListUnAuthed → 401
curl -si $BASE/locks -H "Accept: application/vnd.git-lfs+json"
# Expect: 401

# TestLocksVerify — verify pre-push
curl -s -u alice:$TOKEN -X POST $BASE/locks/verify $LFS \
  -d '{"cursor":"","limit":0}'
# Expect: 200, ours/theirs arrays

# TestUnlock — unlock own lock → 200 + deleted lock in body
curl -si -u alice:$TOKEN -X POST $BASE/locks/$LOCK_ID/unlock $LFS -d '{}'
# Expect: 200, body has lock

# TestUnLockUnAuthed → 401
curl -si -X POST $BASE/locks/$LOCK_ID/unlock $LFS -d '{}'
# Expect: 401

# TestUnlockNotOwner — different user, no force → 403
curl -si -u bob:$BOB_TOKEN -X POST $BASE/locks/$LOCK_ID/unlock $LFS -d '{"force":false}'
# Expect: 403

# TestUnlockNotOwnerForce — different user + force → 200
curl -si -u bob:$BOB_TOKEN -X POST $BASE/locks/$LOCK_ID/unlock $LFS -d '{"force":true}'
# Expect: 200
```
