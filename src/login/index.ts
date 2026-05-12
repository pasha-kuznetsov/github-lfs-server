import { Hono } from "hono";
import type { AppEnv } from "../index";

import { githubProxy } from "./github-proxy";
import { deviceApi } from "./device";
import { oauthApi } from "./oauth";
import { tokenApi } from "./oauth-token";

export const loginApi = new Hono<AppEnv>();

loginApi.route("/api", githubProxy);
loginApi.route("/login/device", deviceApi);
loginApi.route("/login/oauth", oauthApi);
loginApi.route("/login/oauth", tokenApi);
