export function mockGitHub(req: Request): Response | null {
  const url = new URL(req.url);
  if (url.hostname !== "api.github.com") return null;
  if (url.pathname === "/user") return Response.json({ login: "dev", id: 1 });
  return Response.json({ permissions: { push: true, admin: false } });
}
