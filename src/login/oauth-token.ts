import { Hono } from "hono";
import type { AppEnv } from "../index";
import { decryptCode } from "./utils";

export const tokenApi = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// GET /login/oauth/access_token, both for OAuth (Browser) and Device flows
// ---------------------------------------------------------------------------
// Browser grant: decrypt the ephemeral code and return the real token.
// Device grant: proxy the polling request to GitHub with our credentials.
tokenApi.post("/access_token", async (c) => {
  const form = await c.req.parseBody();
  const deviceCode = form["device_code"];
  const code = form["code"];

  if (typeof deviceCode === "string") {
    return handleDeviceGrant(
      c.env.GITHUB_CLIENT_ID,
      c.env.GITHUB_CLIENT_SECRET,
      deviceCode,
    );
  }

  if (typeof code === "string") {
    const payload = await decryptCode(code, c.env.LOGIN_SECRET);
    if (!payload) return c.json({ error: "invalid_grant" }, 400);
    return c.json({
      access_token: payload.token,
      token_type: "bearer",
      scope: "",
    });
  }

  return c.json({ error: "unsupported_grant_type" }, 400);
});

async function handleDeviceGrant(
  clientId: string,
  clientSecret: string,
  deviceCode: string,
): Promise<Response> {
  const upstream = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    client_id: clientId,
    client_secret: clientSecret,
    device_code: deviceCode,
  });

  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: upstream,
  });

  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: {
      "Content-Type": res.headers.get("Content-Type") ?? "application/json",
    },
  });
}
