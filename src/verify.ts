import { sValidator } from "@hono/standard-validator";
import type { z } from "zod";
import { Context } from "hono";
import { verifyRequestSchema } from "./api-schema";
import type { AppEnv, Ctx } from "./index";

export const verifyValidator = sValidator(
  "json",
  verifyRequestSchema,
  (r, c) => {
    if (!r.success) return c.json({ message: "Invalid request" }, 422);
  },
);

export async function verifyHandler(
  c: Ctx<z.infer<typeof verifyRequestSchema>>,
): Promise<Response> {
  const body = c.req.valid("json");

  const owner = c.req.param("owner");
  const repo = c.req.param("repo").replace(/\.git$/, "");
  const key = `${owner}/${repo}/${body.oid}`;

  const info = await c.get("s3bucket").verifyObject(key, body.size);
  if ("message" in info) return c.json({ message: info.message }, 422);

  return c.json({});
}
