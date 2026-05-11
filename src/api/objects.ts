import { sValidator } from "@hono/standard-validator";
import { Hono } from "hono";
import assert from "assert";

import type { AppEnv } from "../index";
import { batchRequestSchema, verifyRequestSchema } from "./_schema";

// -----------------------------------------------------------------------------
// https://github.com/git-lfs/git-lfs/blob/main/docs/api/batch.md
// -----------------------------------------------------------------------------

export function initObjectsApi(app: Hono<AppEnv>) {
  // ---------------------------------------------------------------------------
  // POST /:owner/:repo/objects/batch — Batch Objects API
  // ---------------------------------------------------------------------------
  app.post(
    "/:owner/:repo/objects/batch",
    sValidator("json", batchRequestSchema, (r, c) => {
      if (!r.success) return c.json({ message: "Invalid request" }, 422);
    }),
    async (c) => {
      const body = c.req.valid("json");
      const owner = c.req.param("owner");
      const repo = c.req.param("repo").replace(/\.git$/, "");
      const origin = new URL(c.req.url).origin;
      const { operation, objects } = body;

      if (operation === "upload" && c.get("access") !== "write") {
        return c.json(
          { message: "You must have push access to upload this object" },
          403,
        );
      }

      const bucket = c.get("objects");
      const results = await Promise.all(
        objects.map(async (obj) => {
          const key = `${owner}/${repo}/${obj.oid}`;
          if (operation === "upload") {
            const verifyHref = `${origin}/${owner}/${repo}/objects/verify`;
            return {
              oid: obj.oid,
              size: obj.size,
              ...(await bucket.presignUpload(key, verifyHref)),
            };
          } else {
            assert(operation === "download");
            return {
              oid: obj.oid,
              size: obj.size,
              ...(await bucket.presignDownload(key)),
            };
          }
        }),
      );

      return c.json({
        transfer: "basic",
        hash_algo: "sha256",
        objects: results,
      });
    },
  );

  // ---------------------------------------------------------------------------
  // POST /:owner/:repo/objects/verify — Objects Upload Verification
  // ---------------------------------------------------------------------------
  app.post(
    "/:owner/:repo/objects/verify",
    sValidator("json", verifyRequestSchema, (r, c) => {
      if (!r.success) return c.json({ message: "Invalid request" }, 422);
    }),
    async (c) => {
      const body = c.req.valid("json");
      const owner = c.req.param("owner");
      const repo = c.req.param("repo").replace(/\.git$/, "");
      const key = `${owner}/${repo}/${body.oid}`;

      const info = await c.get("objects").verifyObject(key, body.size);
      if ("message" in info) return c.json({ message: info.message }, 422);

      return c.json({});
    },
  );
}
