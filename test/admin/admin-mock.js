import { WorkerEntrypoint } from "cloudflare:workers";

export class AdminEntrypoint extends WorkerEntrypoint {
  async ingest(p) {
    // no-op — proves RPC is callable
  }
}

export default { fetch: () => new Response("gc-mock") };
