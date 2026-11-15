/**
 * Bun/Node SQLite adapter for `BookStore`. Used by scripts and tests; never by
 * the app. This file may import Bun and node:* modules.
 */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { BookStore, type Sql, type SqlResult, type SqlValue } from "./db";

export function createNodeSql(filePath: string): Sql {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const db = new Database(filePath, { create: true });
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA busy_timeout = 5000");

  return {
    async execute(sql, params: SqlValue[] = []): Promise<SqlResult> {
      const result = db.run(sql, params);
      return {
        rowsAffected: Number(result.changes),
        lastInsertId:
          typeof result.lastInsertRowid === "bigint"
            ? Number(result.lastInsertRowid)
            : result.lastInsertRowid,
      };
    },

    async select<T = Record<string, unknown>>(
      sql: string,
      params: SqlValue[] = [],
    ): Promise<T[]> {
      return db.query(sql).all(...params) as T[];
    },

    async close() {
      db.close();
    },
  };
}

export async function openNodeStore(filePath: string): Promise<BookStore> {
  return BookStore.open(createNodeSql(filePath));
}
