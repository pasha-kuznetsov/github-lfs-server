// Dev-only lfs-server entry point in context of lfs-admin dev.
// - Mocks the GitHub API (auth + repo permissions).
// - Mocks S3 by routing presigned URLs against the worker origin to the local
//   R2 binding (miniflare has no S3-compatible HTTP endpoint).
// - Injects DEV=1 so prod-only env checks relax.
// - Overrides AdminEntrypoint.fetch so admin's `/lfs/*` proxy can reach the
//   Hono app over the LFS_SERVER service binding while keeping the same dev
//   env wrapping.

import { mockGitHub } from "./mock-github";
import { mockS3 } from "./mock-s3";
import app from "../src/index";
import { AdminEntrypoint as ProdAdminEntrypoint } from "../src/admin/entrypoint";

const _fetch = globalThis.fetch;

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  return mockGitHub(req) ?? _fetch(input, init);
}) as typeof fetch;

// Defaults filled in only if the real env doesn't set them. S3_ENDPOINT is
// forced to the worker origin at request time so presigned URLs target mockS3.
const DEV_DEFAULTS = {
  DEV: "1",
  S3_ACCESS_KEY_ID: "dev",
  S3_SECRET_ACCESS_KEY: "dev",
};

function wrapEnv(req: Request, env: CloudflareBindings): CloudflareBindings {
  const origin = new URL(req.url).origin;
  return { ...DEV_DEFAULTS, ...env, S3_ENDPOINT: origin } as CloudflareBindings;
}

async function devFetch(
  req: Request,
  env: CloudflareBindings,
  ctx: ExecutionContext,
): Promise<Response> {
  const merged = wrapEnv(req, env);
  return (await mockS3(req, merged)) ?? app.fetch(req, merged, ctx);
}

export { Locks, Admin } from "../src/index";

export class AdminEntrypoint extends ProdAdminEntrypoint {
  override fetch(request: Request): Promise<Response> {
    return devFetch(request, this.env, this.ctx);
  }
}

export default {
  fetch: (req: Request, env: CloudflareBindings, ctx: ExecutionContext) =>
    devFetch(req, env, ctx),
} satisfies ExportedHandler<CloudflareBindings>;
