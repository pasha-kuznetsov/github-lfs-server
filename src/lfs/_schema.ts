import { z } from "zod";

// --- Shared primitives -------------------------------------------------------

const refSchema = z.object({ name: z.string() });

const actionSchema = z.object({
  href: z.string(),
  // Spec uses additionalProperties:true (any value type); we narrow to string
  // because HTTP header values are always strings in practice.
  header: z.record(z.string(), z.string()).optional(),
  // Spec: "type":"number", minimum:-2147483647, maximum:2147483647.
  // We add .int() (seconds are integers) while honouring the spec bounds.
  // Negative values are valid per spec (signal an already-expired action).
  expires_in: z.number().int().gte(-2147483647).lte(2147483647).optional(),
  expires_at: z.string().optional(),
});

// Spec marks only id+path+locked_at as required and owner as optional.
// We require owner.name because our server always sets it from the auth user.
export const lockSchema = z.object({
  id: z.string(),
  path: z.string(),
  locked_at: z.string(),
  owner: z.object({ name: z.string() }),
});

// --- Batch API ---------------------------------------------------------------

export const batchRequestSchema = z.object({
  operation: z.enum(["upload", "download"]),
  transfers: z.array(z.string()).optional(), // optional per spec; reference incorrectly required it
  objects: z.array(
    z.object({
      oid: z.string(),
      size: z.number().gte(0),
      authenticated: z.boolean().optional(),
    }),
  ),
  ref: refSchema.optional(),
  hash_algo: z.string().default("sha256"),
});

export const batchObjectSchema = z.object({
  oid: z.string(),
  size: z.number().gte(0),
  actions: z
    .object({
      upload: actionSchema.optional(),
      download: actionSchema.optional(),
      verify: actionSchema.optional(),
    })
    .optional(),
  error: z.object({ code: z.number().int(), message: z.string() }).optional(),
});

// Spec requires only "objects"; transfer is an optional plain string and
// hash_algo is absent from the spec entirely. We use literals here because
// this schema validates what OUR server constructs, not what clients send.
export const batchResponseSchema = z.object({
  transfer: z.literal("basic"),
  objects: z.array(batchObjectSchema),
  hash_algo: z.literal("sha256"),
});

// --- Verify upload -----------------------------------------------------------

export const verifyRequestSchema = z.object({
  oid: z.string(),
  size: z.number().gte(0),
});

// --- File locking ------------------------------------------------------------

export const createLockRequestSchema = z.object({
  path: z.string(),
  ref: refSchema.optional(),
});

export const createLockResponseSchema = z.object({
  lock: lockSchema,
});

export const lockConflictResponseSchema = z.object({
  lock: lockSchema,
  message: z.string(),
});

// Spec has no required fields on list/verify lock items. We use the full
// lockSchema (all fields required) because our server always emits them.
export const lockListResponseSchema = z.object({
  locks: z.array(lockSchema),
  next_cursor: z.string().optional(),
});

export const lockVerifyRequestSchema = z.object({
  ref: refSchema.optional(),
  cursor: z.string().optional(),
  limit: z.number().int().gte(0).optional(),
});

export const lockVerifyResponseSchema = z.object({
  ours: z.array(lockSchema),
  theirs: z.array(lockSchema),
  next_cursor: z.string().optional(),
});

export const unlockRequestSchema = z.object({
  force: z.boolean().optional(),
  ref: refSchema.optional(),
});

export const unlockResponseSchema = z.object({
  lock: lockSchema,
});
