/**
 * Test-only SQLite adapter. vitest runs on Node, where `bun:sqlite` is not
 * available; `node:sqlite` is. The SQL and BookStore under test are the same
 * ones the Bun and Tauri adapters use.
 */
import { DatabaseSync } from "node:sqlite";
import type { Sql, SqlResult, SqlValue } from "@/pipeline/db";

export function openTestSql(): Sql {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA journal_mode = WAL");
  return {
    async execute(sql, params: SqlValue[] = []): Promise<SqlResult> {
      const result = db.prepare(sql).run(...params);
      return {
        lastInsertId:
          result.lastInsertRowid === undefined
            ? null
            : Number(result.lastInsertRowid),
      };
    },
    async select<T = Record<string, unknown>>(
      sql: string,
      params: SqlValue[] = [],
    ): Promise<T[]> {
      return db.prepare(sql).all(...params) as T[];
    },
    async close() {
      db.close();
    },
  };
}
