import { Hono } from "hono";
import type { AppEnv } from "../app";
import { pickHeaders } from "./utils";

// ---------------------------------------------------------------------------
// Github /api Proxy
// ---------------------------------------------------------------------------

export const githubProxy = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// GET /api/v3/meta
// ---------------------------------------------------------------------------
// GCM and gh detect GHES mode from this; installed_version >= 3.2 and
// verifiable_password_authentication: false enable OAuth and suppress basic-auth prompts.
githubProxy.get("/v3/meta", (c) =>
  c.json({
    verifiable_password_authentication: false,
    installed_version: "3.20.0",
  }),
);

const FORWARDED_RESPONSE_HEADERS = [
  "Content-Type",
  "X-OAuth-Scopes",
  "X-Accepted-OAuth-Scopes",
];

const GITHUB_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "git-lfs-hub/server",
  "X-GitHub-Api-Version": "2022-11-28",
};

// ---------------------------------------------------------------------------
// GET /api/v3/user
// ---------------------------------------------------------------------------
// GCM calls this after the OAuth flow to validate the token and resolve the GitHub username.
githubProxy.get("/v3/user", async (c) => {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      ...GITHUB_HEADERS,
      ...(c.req.header("Authorization")
        ? { Authorization: c.req.header("Authorization")! }
        : {}),
    },
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: pickHeaders(res.headers, FORWARDED_RESPONSE_HEADERS),
  });
});

// ---------------------------------------------------------------------------
// POST /api/graphql
// ---------------------------------------------------------------------------
// gh CLI uses this for username resolution (UserCurrent query) and to inspect X-OAuth-Scopes.
githubProxy.post("/graphql", async (c) => {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...GITHUB_HEADERS,
      "Content-Type": "application/json",
      ...(c.req.header("Authorization")
        ? { Authorization: c.req.header("Authorization")! }
        : {}),
    },
    body: await c.req.text(),
  });
  return new Response(await res.text(), {
    status: res.status,
    headers: pickHeaders(res.headers, FORWARDED_RESPONSE_HEADERS),
  });
});
