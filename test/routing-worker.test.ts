import { describe, test, expect } from "vitest";
import { exports } from "cloudflare:workers";

const LFS_CT = "application/vnd.git-lfs+json";
const PROBE = "http://w/lfs/alice/repo/locks";

describe("worker entry (test/main)", () => {
  test("routes LFS requests through the worker fetch handler", async () => {
    const res = await exports.default.fetch(
      new Request(PROBE, { headers: { Accept: LFS_CT } }),
    );
    expect(res.status).toBe(401);
  });
});
