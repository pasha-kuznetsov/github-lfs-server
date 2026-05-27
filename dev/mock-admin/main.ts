import { WorkerEntrypoint } from "cloudflare:workers";

export class AdminEntrypoint extends WorkerEntrypoint {
  async ingest() {}
  async reconcileRepos() {
    return { added: [], removed: [], deleted: [] };
  }
}

export default {
  fetch: () => new Response("mock lfs-admin"),
};
