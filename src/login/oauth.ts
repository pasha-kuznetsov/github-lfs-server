import { Hono } from "hono";
import type { AppEnv } from "../index";
import { signState, verifyState, encryptCode } from "./utils";

// ---------------------------------------------------------------------------
// OAuth (browser) login flow
// ---------------------------------------------------------------------------

export const oauthApi = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// GET /login/oauth/authorize
// ---------------------------------------------------------------------------
// The client's loopback redirect_uri can't be pre-registered on our app, so we
// intercept here, seal it into a signed state token, and redirect GitHub to our
// own /callback URL instead.
oauthApi.get("/authorize", async (c) => {
  const { redirect_uri, scope, state: clientState, login } = c.req.query();

  if (!redirect_uri) return c.json({ error: "missing_redirect_uri" }, 400);

  const callbackUrl = `${new URL(c.req.url).origin}/login/oauth/callback`;

  const signedState = await signState(
    { redirect_uri, client_state: clientState ?? "", scopes: scope ?? "" },
    c.env.LOGIN_SECRET,
  );

  const githubUrl = new URL("https://github.com/login/oauth/authorize");
  githubUrl.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  githubUrl.searchParams.set("redirect_uri", callbackUrl);
  if (scope) githubUrl.searchParams.set("scope", scope);
  githubUrl.searchParams.set("state", signedState);
  if (login) githubUrl.searchParams.set("login", login);

  return c.redirect(githubUrl.toString(), 302);
});

// ---------------------------------------------------------------------------
// GET /login/oauth/callback
// ---------------------------------------------------------------------------
// GitHub delivers the auth code here (our registered callback); we exchange it
// with our credentials, encrypt the real token as a short-lived ephemeral code,
// and redirect the client back to its original loopback URL.
oauthApi.get("/callback", async (c) => {
  const { code: ghCode, state: signedState } = c.req.query();

  if (!signedState) return c.json({ error: "invalid_state" }, 400);

  const payload = await verifyState(signedState, c.env.LOGIN_SECRET);
  if (!payload) return c.json({ error: "invalid_state" }, 400);

  const { redirect_uri, client_state } = payload;

  const upstream = new URLSearchParams({
    client_id: c.env.GITHUB_CLIENT_ID,
    client_secret: c.env.GITHUB_CLIENT_SECRET,
    code: ghCode ?? "",
    redirect_uri: `${new URL(c.req.url).origin}/login/oauth/callback`,
  });

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: upstream,
  });

  const data = (await res.json()) as Record<string, string>;

  if (data.error) {
    const errUrl = new URL(redirect_uri);
    errUrl.searchParams.set("error", data.error);
    if (client_state) errUrl.searchParams.set("state", client_state);
    return c.redirect(errUrl.toString(), 302);
  }

  const ephemeralCode = await encryptCode({ token: data.access_token }, c.env.LOGIN_SECRET);

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", ephemeralCode);
  if (client_state) redirectUrl.searchParams.set("state", client_state);

  return c.redirect(redirectUrl.toString(), 302);
});
