#!/usr/bin/env bun
// Run lfs-server alongside the lfs-admin mock in a single Miniflare instance,
// so the LFS_ADMIN service binding resolves directly without the dev registry.
// See: https://developers.cloudflare.com/workers/development-testing/multi-workers/
//
// `dev/entry.ts` wraps `src/index.ts` to mock api.github.com.
import { spawn } from "node:child_process";

const child = spawn(
  "bunx",
  [
    "wrangler",
    "dev",
    "dev/entry.ts",
    "-c", "wrangler.jsonc",
    "-c", "dev/mock-admin/wrangler.jsonc",
    // Share state with admin's vite dev so the R2 explorer at
    // localhost:5173/cdn-cgi/explorer/r2/lfs-objects sees the same objects.
    "--persist-to", "../admin/.wrangler/state",
  ],
  { stdio: "inherit" },
);

const forward = (sig: NodeJS.Signals) => () => child.kill(sig);
process.on("SIGINT", forward("SIGINT"));
process.on("SIGTERM", forward("SIGTERM"));
child.on("exit", (code) => process.exit(code ?? 0));
