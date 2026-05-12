import { Hono } from "hono";
import type { AppEnv } from "../index";

// ---------------------------------------------------------------------------
// Device (cmd line) login flow
// ---------------------------------------------------------------------------

export const deviceApi = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// GET /login/device/code
// ---------------------------------------------------------------------------
// Device flow needs no server-side callback, so we proxy directly to GitHub
// substituting our client_id for whatever the client sends.
deviceApi.post("/code", async (c) => {
  const form = await c.req.parseBody();

  const upstream = new URLSearchParams();
  upstream.set("client_id", c.env.GITHUB_CLIENT_ID);
  for (const [key, value] of Object.entries(form)) {
    if (key !== "client_id" && typeof value === "string") {
      upstream.set(key, value);
    }
  }

  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: c.req.header("Accept") ?? "application/json",
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
});
