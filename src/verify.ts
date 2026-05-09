import type { Context } from "hono";
import { verifyRequestSchema } from "./schema.zod";

type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: { user: string };
};

export async function verifyHandler(c: Context<AppEnv>): Promise<Response> {
  let body: ReturnType<typeof verifyRequestSchema.parse>;
  try {
    body = verifyRequestSchema.parse(await c.req.json());
  } catch {
    return c.json({ message: "Invalid request" }, 422);
  }

  const owner = c.req.param("owner");
  const repo = c.req.param("repo").replace(/\.git$/, "");
  const key = `${owner}/${repo}/${body.oid}`;

  const obj = await c.env.LFS_BUCKET.head(key);
  if (!obj || obj.size !== body.size) {
    return c.json({ message: "Object not found or size mismatch" }, 422);
  }

  return c.json({});
}
