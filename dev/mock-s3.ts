// Mock S3 endpoint backed by the local R2 binding. Lets presigned upload/
// download URLs that point at the worker origin in dev resolve to actual R2
// reads/writes without needing a real S3-compatible HTTP service.
//
// URL shape mirrors S3/R2: `${origin}/${bucket}/${key}`. Signature is ignored.

export async function mockS3(
  req: Request,
  env: CloudflareBindings,
): Promise<Response | null> {
  const url = new URL(req.url);
  const prefix = `/${env.S3_BUCKET_NAME}/`;
  if (!url.pathname.startsWith(prefix)) return null;
  const key = decodeURIComponent(url.pathname.slice(prefix.length));

  if (req.method === "PUT") {
    await env.LFS_BUCKET.put(key, await req.arrayBuffer());
    return new Response(null, { status: 200 });
  }

  if (req.method === "GET" || req.method === "HEAD") {
    const obj = await env.LFS_BUCKET.get(key);
    if (!obj) return new Response(null, { status: 404 });
    return new Response(req.method === "HEAD" ? null : obj.body, {
      status: 200,
      headers: { "Content-Length": String(obj.size) },
    });
  }

  return new Response("Method not allowed", { status: 405 });
}
