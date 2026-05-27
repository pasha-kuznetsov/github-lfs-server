import { DurableObject } from "cloudflare:workers";
import { drizzle, DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { eq } from "drizzle-orm";
import { settings } from "./_admin-schema";

export class Admin extends DurableObject<CloudflareBindings> {
  private db: DrizzleSqliteDODatabase;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.db = drizzle(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key   TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        )
      `);
    });
  }

  async block(): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key: "blocked", value: "true" })
      .onConflictDoUpdate({ target: settings.key, set: { value: "true" } });
  }

  async unblock(): Promise<void> {
    await this.db
      .insert(settings)
      .values({ key: "blocked", value: "false" })
      .onConflictDoUpdate({ target: settings.key, set: { value: "false" } });
  }

  async isBlocked(): Promise<boolean> {
    const [row] = await this.db
      .select()
      .from(settings)
      .where(eq(settings.key, "blocked"));
    return row?.value === "true";
  }

  async purge(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
