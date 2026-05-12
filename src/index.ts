import { Hono } from "hono";

import { loginApi } from "./login";
import { lfsApi } from "./lfs";
import { ObjectsStorage } from "./storage/objects";

export type AppEnv = {
  Bindings: CloudflareBindings;
  Variables: {
    user: string;
    access: "read" | "write";
    objects: ObjectsStorage;
  };
};

const app = new Hono<AppEnv>();
app.route("/", loginApi);
app.route("/lfs", lfsApi);

export default app;

// required for Wrangler
export { RepoLocks } from "./db/locks";
