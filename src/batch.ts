import { sValidator } from "@hono/standard-validator";
import type { z } from "zod";
import { Context } from "hono";
import { batchRequestSchema } from "./api-schema";
import type { AppEnv, Ctx } from "./index";
import assert from "assert";

export const batchValidator = sValidator("json", batchRequestSchema, (r, c) => {
  if (!r.success) return c.json({ message: "Invalid request" }, 422);
});

export async function batchHandler(
  c: Ctx<z.infer<typeof batchRequestSchema>>,
): Promise<Response> {
  const body = c.req.valid("json");

  const owner = c.req.param("owner");
  const repo = c.req.param("repo").replace(/\.git$/, "");
  const origin = new URL(c.req.url).origin;
  const { operation, objects } = body;

  const bucket = c.get("s3bucket");
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

  return c.json({ transfer: "basic", hash_algo: "sha256", objects: results });
}
