import { WorkerEntrypoint } from "cloudflare:workers";

export class AdminEntrypoint extends WorkerEntrypoint<CloudflareBindings> {
  async blockRepo(owner: string, repo: string): Promise<void> {
    await this.env.ADMIN.getByName(`${owner}/${repo}`).block();
  }

  async unblockRepo(owner: string, repo: string): Promise<void> {
    await this.env.ADMIN.getByName(`${owner}/${repo}`).unblock();
  }

  async purgeRepo(owner: string, repo: string): Promise<void> {
    const key = `${owner}/${repo}`;
    await this.env.LOCKS.getByName(key).purge();
    await this.env.ADMIN.getByName(key).purge();
  }
}
