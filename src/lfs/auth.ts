import type { MiddlewareHandler } from "hono";

import { Octokit } from "@octokit/rest";

import type { AppEnv } from "../app";

// Exported for unit testing — pure function, no I/O.
export function extractToken(
  header: string,
): { username: string; token: string } | null {
  const space = header.indexOf(" ");
  if (space === -1) return null;

  const scheme = header.slice(0, space).toLowerCase();
  const rest = header.slice(space + 1);

  if (scheme === "basic") {
    let decoded: string;
    try {
      decoded = atob(rest);
    } catch {
      return null;
    }
    const colon = decoded.indexOf(":");
    if (colon === -1) return null;
    return {
      username: decoded.slice(0, colon),
      token: decoded.slice(colon + 1),
    };
  }

  // RemoteAuth / Bearer / any other scheme: raw credential is the token.
  return { username: "", token: rest };
}

const DENY = { message: "Credentials needed" };
const DENY_HEADERS = { "LFS-Authenticate": 'Basic realm="Git LFS"' } as const;

export const authMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header("Authorization");
  if (!header) return c.json(DENY, 401, DENY_HEADERS);

  const extracted = extractToken(header);
  if (!extracted) return c.json(DENY, 401, DENY_HEADERS);

  const owner = c.req.param("owner");
  const repo = c.req.param("repo")?.replace(/\.git$/, "");
  if (!owner || !repo) return c.json(DENY, 401, DENY_HEADERS);

  try {
    const octokit = new Octokit({ auth: extracted.token });
    const [{ data: user }, { data: repoData }] = await Promise.all([
      octokit.rest.users.getAuthenticated(),
      octokit.rest.repos.get({ owner, repo }),
    ]);
    const { permissions } = repoData;
    c.set("user", user.login);
    c.set("access", permissions?.push || permissions?.admin ? "write" : "read");
  } catch {
    return c.json(DENY, 401, DENY_HEADERS);
  }

  await next();
};
