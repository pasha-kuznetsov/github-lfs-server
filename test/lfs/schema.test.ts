import { describe, test, expect } from "vitest";
import {
  batchObjectSchema,
  batchRequestSchema,
  batchResponseSchema,
  createLockRequestSchema,
  createLockResponseSchema,
  lockConflictResponseSchema,
  lockListResponseSchema,
  lockSchema,
  lockVerifyRequestSchema,
  lockVerifyResponseSchema,
  unlockRequestSchema,
  unlockResponseSchema,
  verifyRequestSchema,
} from "../../src/lfs/_schema";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LOCK = {
  id: "aabbccddeeff00112233445566778899aabbccdd",
  path: "assets/large.bin",
  locked_at: "2024-01-01T00:00:00Z",
  owner: { name: "alice" },
};

const ACTION = { href: "https://r2.example.com/bucket/key?sig=abc" };

// ---------------------------------------------------------------------------
// lockSchema
// ---------------------------------------------------------------------------

describe("lockSchema", () => {
  test("accepts a valid lock", () => {
    expect(lockSchema.safeParse(LOCK).success).toBe(true);
  });

  test("requires id", () => {
    const { id: _, ...rest } = LOCK;
    expect(lockSchema.safeParse(rest).success).toBe(false);
  });

  test("requires path", () => {
    const { path: _, ...rest } = LOCK;
    expect(lockSchema.safeParse(rest).success).toBe(false);
  });

  test("requires locked_at", () => {
    const { locked_at: _, ...rest } = LOCK;
    expect(lockSchema.safeParse(rest).success).toBe(false);
  });

  test("requires owner.name", () => {
    expect(lockSchema.safeParse({ ...LOCK, owner: {} }).success).toBe(false);
  });

  test("owner.name must be a string", () => {
    expect(lockSchema.safeParse({ ...LOCK, owner: { name: 42 } }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// batchRequestSchema
// ---------------------------------------------------------------------------

describe("batchRequestSchema", () => {
  test("accepts a minimal upload request (no transfers, no ref)", () => {
    const result = batchRequestSchema.safeParse({
      operation: "upload",
      objects: [{ oid: "abc123", size: 1024 }],
    });
    expect(result.success).toBe(true);
  });

  test("accepts a minimal download request", () => {
    const result = batchRequestSchema.safeParse({
      operation: "download",
      objects: [],
    });
    expect(result.success).toBe(true);
  });

  test("transfers is optional", () => {
    const withoutTransfers = batchRequestSchema.safeParse({
      operation: "upload",
      objects: [],
    });
    const withTransfers = batchRequestSchema.safeParse({
      operation: "upload",
      transfers: ["basic"],
      objects: [],
    });
    expect(withoutTransfers.success).toBe(true);
    expect(withTransfers.success).toBe(true);
  });

  test("hash_algo defaults to 'sha256' when omitted", () => {
    const result = batchRequestSchema.safeParse({
      operation: "upload",
      objects: [],
    });
    expect(result.success && result.data.hash_algo).toBe("sha256");
  });

  test("accepts a custom hash_algo", () => {
    const result = batchRequestSchema.safeParse({
      operation: "upload",
      objects: [],
      hash_algo: "sha512",
    });
    expect(result.success && result.data.hash_algo).toBe("sha512");
  });

  test("accepts an optional ref", () => {
    const result = batchRequestSchema.safeParse({
      operation: "upload",
      objects: [],
      ref: { name: "refs/heads/main" },
    });
    expect(result.success).toBe(true);
  });

  test("rejects an unknown operation", () => {
    expect(batchRequestSchema.safeParse({ operation: "delete", objects: [] }).success).toBe(false);
  });

  test("requires operation", () => {
    expect(batchRequestSchema.safeParse({ objects: [] }).success).toBe(false);
  });

  test("requires objects", () => {
    expect(batchRequestSchema.safeParse({ operation: "upload" }).success).toBe(false);
  });

  test("rejects negative object size", () => {
    expect(
      batchRequestSchema.safeParse({
        operation: "upload",
        objects: [{ oid: "abc", size: -1 }],
      }).success,
    ).toBe(false);
  });

  test("accepts size = 0", () => {
    expect(
      batchRequestSchema.safeParse({
        operation: "upload",
        objects: [{ oid: "abc", size: 0 }],
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// batchObjectSchema
// ---------------------------------------------------------------------------

describe("batchObjectSchema", () => {
  test("accepts object with no actions (server already has it)", () => {
    expect(batchObjectSchema.safeParse({ oid: "abc", size: 10 }).success).toBe(true);
  });

  test("accepts object with download action", () => {
    expect(
      batchObjectSchema.safeParse({
        oid: "abc",
        size: 10,
        actions: { download: ACTION },
      }).success,
    ).toBe(true);
  });

  test("accepts object with upload + verify actions", () => {
    expect(
      batchObjectSchema.safeParse({
        oid: "abc",
        size: 10,
        actions: {
          upload: ACTION,
          verify: { href: "https://worker/verify", header: { Authorization: "tok" } },
        },
      }).success,
    ).toBe(true);
  });

  test("accepts object with a per-object error", () => {
    expect(
      batchObjectSchema.safeParse({
        oid: "abc",
        size: 10,
        error: { code: 404, message: "Object not found" },
      }).success,
    ).toBe(true);
  });

  // Spec uses additionalProperties:true; we intentionally narrow to strings.
  test("action header values must be strings (intentional constraint)", () => {
    expect(
      batchObjectSchema.safeParse({
        oid: "abc",
        size: 10,
        actions: { download: { href: "https://r2.example.com", header: { "X-Count": 42 } } },
      }).success,
    ).toBe(false);
  });

  test("action accepts negative expires_in (already-expired signal)", () => {
    expect(
      batchObjectSchema.safeParse({
        oid: "abc",
        size: 10,
        actions: { download: { href: "https://r2.example.com", expires_in: -1 } },
      }).success,
    ).toBe(true);
  });

  test("action expires_in respects spec minimum (-2147483647)", () => {
    expect(
      batchObjectSchema.safeParse({
        oid: "abc",
        size: 10,
        actions: { download: { href: "https://r2.example.com", expires_in: -2147483647 } },
      }).success,
    ).toBe(true);
    expect(
      batchObjectSchema.safeParse({
        oid: "abc",
        size: 10,
        actions: { download: { href: "https://r2.example.com", expires_in: -2147483648 } },
      }).success,
    ).toBe(false);
  });

  test("action expires_in respects spec maximum (2147483647)", () => {
    expect(
      batchObjectSchema.safeParse({
        oid: "abc",
        size: 10,
        actions: { download: { href: "https://r2.example.com", expires_in: 2147483647 } },
      }).success,
    ).toBe(true);
    expect(
      batchObjectSchema.safeParse({
        oid: "abc",
        size: 10,
        actions: { download: { href: "https://r2.example.com", expires_in: 2147483648 } },
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// batchResponseSchema
// ---------------------------------------------------------------------------

describe("batchResponseSchema", () => {
  test("accepts a valid batch response", () => {
    expect(
      batchResponseSchema.safeParse({
        transfer: "basic",
        objects: [{ oid: "abc", size: 10, actions: { download: ACTION } }],
        hash_algo: "sha256",
      }).success,
    ).toBe(true);
  });

  test("transfer must be the literal 'basic'", () => {
    expect(
      batchResponseSchema.safeParse({
        transfer: "multipart",
        objects: [],
        hash_algo: "sha256",
      }).success,
    ).toBe(false);
  });

  test("hash_algo must be the literal 'sha256'", () => {
    expect(
      batchResponseSchema.safeParse({
        transfer: "basic",
        objects: [],
        hash_algo: "sha512",
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verifyRequestSchema
// ---------------------------------------------------------------------------

describe("verifyRequestSchema", () => {
  test("accepts { oid, size }", () => {
    expect(verifyRequestSchema.safeParse({ oid: "abc123", size: 1024 }).success).toBe(true);
  });

  test("accepts size = 0", () => {
    expect(verifyRequestSchema.safeParse({ oid: "abc", size: 0 }).success).toBe(true);
  });

  test("requires oid", () => {
    expect(verifyRequestSchema.safeParse({ size: 1024 }).success).toBe(false);
  });

  test("requires size", () => {
    expect(verifyRequestSchema.safeParse({ oid: "abc" }).success).toBe(false);
  });

  test("rejects negative size", () => {
    expect(verifyRequestSchema.safeParse({ oid: "abc", size: -1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createLockRequestSchema
// ---------------------------------------------------------------------------

describe("createLockRequestSchema", () => {
  test("accepts { path }", () => {
    expect(createLockRequestSchema.safeParse({ path: "assets/large.bin" }).success).toBe(true);
  });

  test("accepts { path, ref }", () => {
    expect(
      createLockRequestSchema.safeParse({
        path: "assets/large.bin",
        ref: { name: "refs/heads/main" },
      }).success,
    ).toBe(true);
  });

  test("requires path", () => {
    expect(createLockRequestSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// createLockResponseSchema / lockConflictResponseSchema
// ---------------------------------------------------------------------------

describe("createLockResponseSchema", () => {
  test("accepts { lock }", () => {
    expect(createLockResponseSchema.safeParse({ lock: LOCK }).success).toBe(true);
  });

  test("requires a full lock object", () => {
    expect(createLockResponseSchema.safeParse({ lock: { id: "abc" } }).success).toBe(false);
  });
});

describe("lockConflictResponseSchema", () => {
  test("accepts { lock, message }", () => {
    expect(
      lockConflictResponseSchema.safeParse({
        lock: LOCK,
        message: "already locked",
      }).success,
    ).toBe(true);
  });

  test("requires message", () => {
    expect(lockConflictResponseSchema.safeParse({ lock: LOCK }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lockListResponseSchema
// ---------------------------------------------------------------------------

describe("lockListResponseSchema", () => {
  test("accepts an empty lock list", () => {
    expect(lockListResponseSchema.safeParse({ locks: [] }).success).toBe(true);
  });

  test("accepts locks with next_cursor", () => {
    expect(
      lockListResponseSchema.safeParse({
        locks: [LOCK],
        next_cursor: LOCK.id,
      }).success,
    ).toBe(true);
  });

  test("next_cursor is optional", () => {
    expect(lockListResponseSchema.safeParse({ locks: [LOCK] }).success).toBe(true);
  });

  test("lock entries must have all required fields (not partial)", () => {
    expect(
      lockListResponseSchema.safeParse({
        locks: [{ id: "abc", path: "f.bin" }], // missing locked_at and owner
      }).success,
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lockVerifyRequestSchema
// ---------------------------------------------------------------------------

describe("lockVerifyRequestSchema", () => {
  test("all fields are optional — empty object is valid", () => {
    expect(lockVerifyRequestSchema.safeParse({}).success).toBe(true);
  });

  test("accepts cursor and limit", () => {
    expect(
      lockVerifyRequestSchema.safeParse({ cursor: "abc123", limit: 25 }).success,
    ).toBe(true);
  });

  test("accepts ref", () => {
    expect(
      lockVerifyRequestSchema.safeParse({ ref: { name: "refs/heads/main" } }).success,
    ).toBe(true);
  });

  test("limit must be non-negative", () => {
    expect(lockVerifyRequestSchema.safeParse({ limit: -1 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// lockVerifyResponseSchema
// ---------------------------------------------------------------------------

describe("lockVerifyResponseSchema", () => {
  test("accepts { ours, theirs } with no next_cursor", () => {
    expect(
      lockVerifyResponseSchema.safeParse({ ours: [LOCK], theirs: [] }).success,
    ).toBe(true);
  });

  test("accepts next_cursor", () => {
    expect(
      lockVerifyResponseSchema.safeParse({
        ours: [],
        theirs: [LOCK],
        next_cursor: LOCK.id,
      }).success,
    ).toBe(true);
  });

  test("requires ours", () => {
    expect(lockVerifyResponseSchema.safeParse({ theirs: [] }).success).toBe(false);
  });

  test("requires theirs", () => {
    expect(lockVerifyResponseSchema.safeParse({ ours: [] }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// unlockRequestSchema
// ---------------------------------------------------------------------------

describe("unlockRequestSchema", () => {
  test("empty body is valid", () => {
    expect(unlockRequestSchema.safeParse({}).success).toBe(true);
  });

  test("accepts force: true", () => {
    expect(unlockRequestSchema.safeParse({ force: true }).success).toBe(true);
  });

  test("accepts force: false", () => {
    expect(unlockRequestSchema.safeParse({ force: false }).success).toBe(true);
  });

  test("force must be boolean", () => {
    expect(unlockRequestSchema.safeParse({ force: "yes" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// unlockResponseSchema
// ---------------------------------------------------------------------------

describe("unlockResponseSchema", () => {
  test("accepts { lock }", () => {
    expect(unlockResponseSchema.safeParse({ lock: LOCK }).success).toBe(true);
  });

  test("requires a full lock", () => {
    expect(unlockResponseSchema.safeParse({ lock: {} }).success).toBe(false);
  });
});
