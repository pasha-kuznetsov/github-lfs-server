import { sqliteTable, text } from "drizzle-orm/sqlite-core";

export const settings = sqliteTable("settings", {
  key: text("key").notNull().primaryKey(),
  value: text("value").notNull(),
});
