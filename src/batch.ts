import type { Context } from "hono";
import { batchRequestSchema } from "./api-schema";
import { presignUpload, presignDownload } from "./s3";

type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: { user: string };
};

export async function batchHandler(c: Context<AppEnv>): Promise<Response> {
  let body: ReturnType<typeof batchRequestSchema.parse>;
  try {
    body = batchRequestSchema.parse(await c.req.json());
  } catch {
    return c.json({ message: "Invalid request" }, 422);
  }

  const owner = c.req.param("owner");
  const repo = c.req.param("repo").replace(/\.git$/, "");
  const origin = new URL(c.req.url).origin;
  const { operation, objects } = body;

  const results = await Promise.all(
    objects.map(async (obj) => {
      const key = `${owner}/${repo}/${obj.oid}`;

      if (operation === "upload") {
        const exists = await c.env.LFS_BUCKET.head(key);
        if (exists) return { oid: obj.oid, size: obj.size };
        const [uploadHref, verifyHref] = await Promise.all([
          presignUpload(c.env, key),
          Promise.resolve(`${origin}/${owner}/${repo}/objects/verify`),
        ]);
        return {
          oid: obj.oid,
          size: obj.size,
          actions: {
            upload: { href: uploadHref },
            verify: { href: verifyHref },
          },
        };
      } else {
        // assert(operation === "download");
        const exists = await c.env.LFS_BUCKET.head(key);
        if (!exists) {
          return {
            oid: obj.oid,
            size: obj.size,
            error: { code: 404, message: "Object not found" },
          };
        }
        const downloadHref = await presignDownload(c.env, key);
        return {
          oid: obj.oid,
          size: obj.size,
          actions: { download: { href: downloadHref } },
        };
      }
    }),
  );

  return c.json({ transfer: "basic", objects: results, hash_algo: "sha256" });
}
