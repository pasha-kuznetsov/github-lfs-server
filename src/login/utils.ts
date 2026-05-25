export function orgsFromEnv(env: {
  GITHUB_ORGS?: string;
  GITHUB_ORG?: string;
}): string[] {
  return [
    ...parseGithubList(env.GITHUB_ORGS),
    ...(env.GITHUB_ORG?.trim() ? [env.GITHUB_ORG.trim()] : []),
  ];
}

export function ownersFromEnv(env: {
  GITHUB_ORGS?: string;
  GITHUB_ORG?: string;
  GITHUB_USER?: string;
}): Set<string> {
  const orgs = orgsFromEnv(env);
  if (orgs.length) return new Set(orgs);
  const user = env.GITHUB_USER?.trim() || null;
  if (user) return new Set([user]);
  throw new Error("Set GITHUB_ORG[S] or GITHUB_USER");
}

export function parseGithubList(s: string | undefined): string[] {
  if (!s) return [];
  return s.split(/[,;\s]+/).filter(Boolean);
}

export function pickHeaders(
  src: Headers,
  filter: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of filter) {
    const value = src.get(name);
    if (value !== null) out[name] = value;
  }
  return out;
}
