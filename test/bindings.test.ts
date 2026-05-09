import {
  describe,
  test,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "bun:test";
import { Miniflare } from "miniflare";
import { readFileSync } from "fs";

const SCHEMA = readFileSync(
  new URL("../sql/locks.sql", import.meta.url),
  "utf8",
);

// Minimal worker that exposes each binding via simple HTTP routes.
// Routes: /r2/<op>?key=K, /d1/<op>, /env
const WORKER = /* js */ `
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const [, ns, op] = url.pathname.split("/");
    const key = url.searchParams.get("key") ?? "k";

    if (ns === "r2") {
      if (op === "put") {
        await env.LFS_BUCKET.put(key, url.searchParams.get("body") ?? "");
        return Response.json({ ok: true });
      }
      if (op === "head") {
        const obj = await env.LFS_BUCKET.head(key);
        return Response.json(obj ? { exists: true, size: obj.size } : null);
      }
      if (op === "get") {
        const obj = await env.LFS_BUCKET.get(key);
        return Response.json(obj ? { exists: true, text: await obj.text() } : null);
      }
      if (op === "list") {
        const r = await env.LFS_BUCKET.list();
        return Response.json({ keys: r.objects.map(o => o.key) });
      }
      if (op === "delete") {
        await env.LFS_BUCKET.delete(key);
        return Response.json({ ok: true });
      }
    }

    if (ns === "d1") {
      if (op === "tables") {
        const { results } = await env.DB
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all();
        return Response.json({ tables: results.map(r => r.name) });
      }
      if (op === "insert") {
        await env.DB
          .prepare("INSERT INTO locks (id, owner, path, repo, locked_at) VALUES (?, ?, ?, ?, ?)")
          .bind(key, "alice", url.searchParams.get("path") ?? "f.bin",
                "alice/repo", new Date().toISOString())
          .run();
        return Response.json({ ok: true });
      }
      if (op === "select") {
        const { results } = await env.DB.prepare("SELECT * FROM locks").all();
        return Response.json({ locks: results });
      }
      if (op === "conflict") {
        try {
          await env.DB
            .prepare("INSERT INTO locks (id, owner, path, repo, locked_at) VALUES (?, ?, ?, ?, ?)")
            .bind(key, "bob", url.searchParams.get("path") ?? "f.bin",
                  "alice/repo", new Date().toISOString())
            .run();
          return Response.json({ threw: false });
        } catch {
          return Response.json({ threw: true });
        }
      }
    }

    if (ns === "env") {
      return Response.json({
        S3_ENDPOINT:          env.S3_ENDPOINT,
        S3_BUCKET_NAME:       env.S3_BUCKET_NAME,
        S3_ACCESS_KEY_ID:     env.S3_ACCESS_KEY_ID,
        S3_SECRET_ACCESS_KEY: env.S3_SECRET_ACCESS_KEY,
      });
    }

    return new Response("not found", { status: 404 });
  }
};
`;

const BINDINGS = {
  S3_ENDPOINT: "https://test-account.r2.cloudflarestorage.com",
  S3_BUCKET_NAME: "lfs-objects",
  S3_ACCESS_KEY_ID: "test-key-id",
  S3_SECRET_ACCESS_KEY: "test-secret",
};

let mf: Miniflare;
let db: any;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: WORKER,
    r2Buckets: ["LFS_BUCKET"],
    d1Databases: ["DB"],
    bindings: BINDINGS,
  });
  await mf.ready;

  db = await mf.getD1Database("DB");
  for (const stmt of SCHEMA.split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)) {
    await db.prepare(stmt).run();
  }
});

afterAll(async () => {
  await mf.dispose();
});

beforeEach(async () => {
  await db.prepare("DELETE FROM locks").run();
  const bucket = await mf.getR2Bucket("LFS_BUCKET");
  const { objects } = await bucket.list();
  await Promise.all(objects.map((o: any) => bucket.delete(o.key)));
});

async function get(path: string) {
  return (
    await mf.dispatchFetch(`http://worker${path}`)
  ).json() as Promise<any>;
}

// ---------------------------------------------------------------------------

describe("R2 binding (LFS_BUCKET)", () => {
  test("put stores an object", async () => {
    const res = await get("/r2/put?key=alice/repo/abc&body=hello");
    expect(res.ok).toBe(true);
  });

  test("head returns size for existing key", async () => {
    await get("/r2/put?key=alice/repo/abc&body=hello");
    const res = await get("/r2/head?key=alice/repo/abc");
    expect(res).toMatchObject({ exists: true, size: 5 });
  });

  test("head returns null for missing key", async () => {
    const res = await get("/r2/head?key=missing");
    expect(res).toBeNull();
  });

  test("get returns correct body", async () => {
    await get("/r2/put?key=alice/repo/abc&body=hello");
    const res = await get("/r2/get?key=alice/repo/abc");
    expect(res).toMatchObject({ exists: true, text: "hello" });
  });

  test("get returns null for missing key", async () => {
    const res = await get("/r2/get?key=missing");
    expect(res).toBeNull();
  });

  test("list returns all stored keys", async () => {
    await get("/r2/put?key=alice/repo/aaa&body=1");
    await get("/r2/put?key=alice/repo/bbb&body=2");
    const res = await get("/r2/list");
    expect(res.keys.sort()).toEqual(["alice/repo/aaa", "alice/repo/bbb"]);
  });

  test("delete removes the object", async () => {
    await get("/r2/put?key=alice/repo/abc&body=hello");
    await get("/r2/delete?key=alice/repo/abc");
    const res = await get("/r2/head?key=alice/repo/abc");
    expect(res).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("D1 binding (DB)", () => {
  test("locks table is accessible from the worker", async () => {
    const res = await get("/d1/tables");
    expect(res.tables).toContain("locks");
  });

  test("worker can INSERT and SELECT locks", async () => {
    await get("/d1/insert?key=aabbcc&path=file.bin");
    const res = await get("/d1/select");
    expect(res.locks).toHaveLength(1);
    expect(res.locks[0]).toMatchObject({
      id: "aabbcc",
      owner: "alice",
      path: "file.bin",
    });
  });

  test("UNIQUE (repo, path) constraint is enforced inside worker", async () => {
    await get("/d1/insert?key=id1&path=file.bin");
    const res = await get("/d1/conflict?key=id2&path=file.bin");
    expect(res.threw).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("env bindings", () => {
  test("all configured vars are accessible in the worker", async () => {
    const res = await get("/env");
    expect(res).toMatchObject(BINDINGS);
  });
});
