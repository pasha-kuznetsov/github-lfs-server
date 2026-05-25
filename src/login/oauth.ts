import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { AppEnv } from "../app";
import type { SessionPayload } from "@git-lfs-hub/auth";
import { signState, verifyState, buildAuthorizeUrl, exchangeCode, encryptSession } from "@git-lfs-hub/auth";
import { SESSION_COOKIE, SESSION_TTL } from "./web-auth";

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

  const callbackUrl = `${c.env.GITHUB_APP_HOME}/login/oauth/callback`;

  const signedState = await signState(
    { redirect_uri, client_state: clientState ?? "", scopes: scope ?? "" },
    c.env.LOGIN_SECRET,
  );

  return c.redirect(
    buildAuthorizeUrl(c.env.GITHUB_CLIENT_ID, callbackUrl, signedState, { scope, login }),
    302,
  );
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

  const statePayload = await verifyState(signedState, c.env.LOGIN_SECRET);
  if (!statePayload) return c.json({ error: "invalid_state" }, 400);

  const { redirect_uri, client_state } = statePayload;
  const callbackUrl = `${c.env.GITHUB_APP_HOME}/login/oauth/callback`;

  const data = await exchangeCode(
    c.env.GITHUB_CLIENT_ID,
    c.env.GITHUB_CLIENT_SECRET,
    ghCode ?? "",
    callbackUrl,
  );

  if (data.error) {
    const errUrl = new URL(redirect_uri);
    errUrl.searchParams.set("error", data.error);
    if (client_state) errUrl.searchParams.set("state", client_state);
    return c.redirect(errUrl.toString(), 302);
  }

  const tokenPayload: SessionPayload = { token: data.access_token };
  if (typeof data.refresh_token === "string") tokenPayload.refresh_token = data.refresh_token;

  const ephemeralCode = await encryptSession(tokenPayload, c.env.LOGIN_SECRET);

  setCookie(c, SESSION_COOKIE, await encryptSession(tokenPayload, c.env.LOGIN_SECRET, SESSION_TTL), {
    httpOnly: true,
    sameSite: "Lax",
    secure: true,
    path: "/",
    maxAge: SESSION_TTL,
  });

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", ephemeralCode);
  if (client_state) redirectUrl.searchParams.set("state", client_state);

  return c.redirect(redirectUrl.toString(), 302);
});
