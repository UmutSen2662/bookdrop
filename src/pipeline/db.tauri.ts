/**
 * The app's SQLite adapter: tauri-plugin-sql (sqlx) over the `sql:` commands.
 *
 * `db.ts` writes placeholders as `?`, which the plugin does not accept; sqlx
 * uses `$1`, `$2`, ... for SQLite. None of our SQL contains a `?` inside a
 * string literal, so counting them is enough.
 */
import Database from "@tauri-apps/plugin-sql";
import {
  BookStore,
  type Sql,
  type SqlResult,
  type SqlValue,
  toSqlxPlaceholders,
} from "./db";
import { toForwardSlashes } from "./paths";

export async function openTauriStore(dbPath: string): Promise<BookStore> {
  // tauri-plugin-sql resolves a sqlite path against the app config dir, but a
  // PathBuf::push with an absolute path replaces the base. An absolute path
  // therefore keeps the documented %LOCALAPPDATA%\bookdrop\db.sqlite.
  const database = await Database.load(`sqlite:${toForwardSlashes(dbPath)}`);

  const sql: Sql = {
    async execute(query, params: SqlValue[] = []): Promise<SqlResult> {
      const result = await database.execute(toSqlxPlaceholders(query), params);
      return {
        rowsAffected: Number(result.rowsAffected ?? 0),
        lastInsertId:
          result.lastInsertId === undefined || result.lastInsertId === null
            ? null
            : Number(result.lastInsertId),
      };
    },

    async select<T = Record<string, unknown>>(
      query: string,
      params: SqlValue[] = [],
    ): Promise<T[]> {
      return database.select<T[]>(toSqlxPlaceholders(query), params);
    },

    async close() {
      await database.close();
    },
  };

  try {
    await sql.execute("PRAGMA journal_mode = WAL");
    await sql.execute("PRAGMA busy_timeout = 5000");
  } catch {
    // The plugin may reject a PRAGMA that returns a row; the database still
    // works in rollback-journal mode.
  }

  return BookStore.open(sql);
}
