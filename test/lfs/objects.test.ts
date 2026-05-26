import { env } from "cloudflare:workers";
import { reset } from "cloudflare:test";
import { describe, test, expect, vi, afterEach } from "vitest";
import { lfsApi } from "../../src/lfs/index";
import { Hono } from "hono";
import type { AppEnv } from "../../src/app";

const LFS = {
  Accept: "application/vnd.git-lfs+json",
  "Content-Type": "application/vnd.git-lfs+json",
  Authorization: "Basic " + btoa("alice:ghu_test"),
};

const mockState = vi.hoisted(() => ({
  login: "alice",
  push: true,
}));

vi.mock("@octokit/rest", () => ({
  Octokit: class {
    rest = {
      users: {
        getAuthenticated: async () => ({
          data: { login: mockState.login },
        }),
      },
      repos: {
        get: async () => ({
          data: { permissions: { push: mockState.push, admin: false } },
        }),
      },
    };
  },
}));

afterEach(async () => {
  mockState.login = "alice";
  mockState.push = true;
  await reset();
});

async function batch(operation: "download" | "upload", owner = "alice", repo = "repo") {
  return lfsApi.request(
    `http://w/${owner}/${repo}/objects/batch`,
    {
      method: "POST",
      headers: LFS,
      body: JSON.stringify({
        operation,
        objects: [{ oid: "deadbeef", size: 10 }],
      }),
    },
    env,
  );
}

describe("lfsApi objects middleware (ObjectsStorage init)", () => {
  test("ObjectsStorage is initialized for objects routes", async () => {
    const res = await batch("download");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.objects).toHaveLength(1);
  });
});

describe("block check", () => {
  test("blocked repo returns 404 on download batch", async () => {
    await env.ADMIN.getByName("alice/repo").block();
    const res = await batch("download");
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.message).toBe("Repository not found");
  });

  test("blocked repo returns 404 on upload batch", async () => {
    await env.ADMIN.getByName("alice/repo").block();
    const res = await batch("upload");
    expect(res.status).toBe(404);
  });

  test("unblocked repo resumes normal batch handling", async () => {
    await env.ADMIN.getByName("alice/repo").block();
    await env.ADMIN.getByName("alice/repo").unblock();
    const res = await batch("download");
    expect(res.status).toBe(200);
  });
});
