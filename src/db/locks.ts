import { DurableObject } from "cloudflare:workers";
import { asc, eq, and, gte } from "drizzle-orm";
import { drizzle, DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";

import { locks } from "./_schema";

export type LockRow = typeof locks.$inferSelect;

export class Locks extends DurableObject {
  private db: DrizzleSqliteDODatabase;

  constructor(ctx: DurableObjectState, env: CloudflareBindings) {
    super(ctx, env);
    this.db = drizzle(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS locks (
          id        INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          uuid      TEXT NOT NULL UNIQUE,
          path      TEXT NOT NULL UNIQUE,
          locked_at TEXT NOT NULL,
          owner     TEXT NOT NULL,
          UNIQUE (path)
        )
      `);
    });
  }

  async getByPath(path: string): Promise<LockRow | null> {
    const result = await this.db
      .select()
      .from(locks)
      .where(eq(locks.path, path));
    return result[0];
  }

  async create(owner: string, path: string): Promise<LockRow> {
    const uuid = crypto.randomUUID();
    const locked_at = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    const [row] = await this.db
      .insert(locks)
      .values({ uuid, path, locked_at, owner })
      .returning();
    return row;
  }

  async list(opts: {
    uuidFilter: string | null;
    pathFilter: string | null;
    cursor: number | null;
    limit: number;
  }): Promise<LockRow[]> {
    const { pathFilter, uuidFilter, cursor, limit } = opts;

    return await this.db
      .select()
      .from(locks)
      .where(
        and(
          uuidFilter ? eq(locks.uuid, uuidFilter) : undefined,
          pathFilter ? eq(locks.path, pathFilter) : undefined,
          cursor ? gte(locks.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(locks.id))
      .limit(limit);
  }

  async getById(uuid: string): Promise<LockRow | null> {
    const rows = await this.db.select().from(locks).where(eq(locks.uuid, uuid));
    return rows[0] ?? null;
  }

  async delete(uuid: string): Promise<void> {
    await this.db.delete(locks).where(eq(locks.uuid, uuid));
  }

  async purge(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
