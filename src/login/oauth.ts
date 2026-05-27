import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { AppEnv } from "../app";
import { signState, buildAuthorizeUrl, encryptSession, processOAuthCallback, buildOAuthErrorRedirectUrl, SESSION_COOKIE, SESSION_COOKIE_OPTIONS } from "@git-lfs-hub/auth";

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

  const result = await processOAuthCallback({
    code: ghCode ?? "",
    state: signedState,
    secret: c.env.LOGIN_SECRET,
    clientId: c.env.GITHUB_CLIENT_ID,
    clientSecret: c.env.GITHUB_CLIENT_SECRET,
    callbackUrl: `${c.env.GITHUB_APP_HOME}/login/oauth/callback`,
  });

  if (!result.ok) {
    if (result.statePayload) {
      return c.redirect(buildOAuthErrorRedirectUrl(result.error, result.statePayload), 302);
    }
    return c.json({ error: result.error }, 400);
  }

  const { encrypted, tokenPayload, statePayload } = result;
  const { redirect_uri, client_state } = statePayload;

  setCookie(c, SESSION_COOKIE, encrypted, SESSION_COOKIE_OPTIONS);

  const redirectUrl = new URL(redirect_uri);
  const ephemeralCode = await encryptSession(tokenPayload, c.env.LOGIN_SECRET);
  redirectUrl.searchParams.set("code", ephemeralCode);
  if (client_state) redirectUrl.searchParams.set("state", client_state);

  return c.redirect(redirectUrl.toString(), 302);
});
