/**
 * The book table: schema, queries, and row mapping.
 *
 * The pipeline owns the database. Two adapters implement `Sql`: `db.node.ts`
 * (bun:sqlite, used by scripts and tests) and `db.tauri.ts` (tauri-plugin-sql,
 * the app). This file imports no native modules, so both share the same SQL.
 *
 * Placeholders are written as `?`. The tauri-plugin-sql adapter rewrites them
 * to `$1`, `$2`, ... before calling sqlx; none of our SQL puts a `?` inside a
 * string literal, so the rewrite stays a plain count.
 */
import {
  type Book,
  CANDIDATE_FIELDS,
  type Candidates,
  emptyCandidates,
  type FlagReason,
  type IngestOutcome,
  type Metadata,
  READ_STATUSES,
  type ReadStatus,
  type Status,
} from "@/pipeline/types";

export type SqlValue = string | number | null;

export type SqlResult = {
  lastInsertId: number | null;
};

export interface Sql {
  execute(sql: string, params?: SqlValue[]): Promise<SqlResult>;
  select<T = Record<string, unknown>>(
    sql: string,
    params?: SqlValue[],
  ): Promise<T[]>;
  close(): Promise<void>;
}

export type SqlRow = Record<string, unknown>;

/**
 * Rewrite `?` placeholders for sqlx.
 */
export function toSqlxPlaceholders(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    book_uuid TEXT UNIQUE,
    sha256 TEXT UNIQUE,
    epub_sha256 TEXT,
    source_path TEXT,
    archived_path TEXT,
    library_path TEXT,
    title TEXT NOT NULL DEFAULT '',
    authors TEXT NOT NULL DEFAULT '',
    author_sort TEXT,
    title_sort TEXT,
    isbn TEXT,
    description TEXT,
    publisher TEXT,
    published TEXT,
    language TEXT,
    tags TEXT,
    status TEXT NOT NULL,
    flag_reason TEXT,
    candidates TEXT NOT NULL DEFAULT '{"fields":{},"covers":[]}',
    notes TEXT,
    error TEXT,
    pinned INTEGER NOT NULL DEFAULT 0,
    pinned_order INTEGER,
    added_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS books_status ON books(status)",
  "CREATE INDEX IF NOT EXISTS books_epub_sha256 ON books(epub_sha256)",
  "CREATE INDEX IF NOT EXISTS books_library_path ON books(library_path)",
  "CREATE INDEX IF NOT EXISTS books_sort ON books(author_sort, title_sort)",
];

/**
 * Cheap file stamps. Startup can skip hashing a library EPUB whose size and
 * mtime still match the row; a first run over an older database backfills them.
 */
const FILE_STAMPS: string[] = [
  "ALTER TABLE books ADD COLUMN file_size INTEGER",
  "ALTER TABLE books ADD COLUMN file_mtime_ms INTEGER",
];

/** Series metadata is additive: old rows simply have NULLs. */
const SERIES_COLUMNS: string[] = [
  "ALTER TABLE books ADD COLUMN series TEXT",
  "ALTER TABLE books ADD COLUMN series_index TEXT",
];

/** Whether the app has a cover image; startup backfills existing rows. */
const COVER_FLAG: string[] = [
  "ALTER TABLE books ADD COLUMN has_cover INTEGER NOT NULL DEFAULT 0",
];

/** Personal reading state. It is app-only and never written to the EPUB. */
const READING_COLUMNS: string[] = [
  "ALTER TABLE books ADD COLUMN read_status TEXT NOT NULL DEFAULT 'unread'",
  "ALTER TABLE books ADD COLUMN personal_notes TEXT",
];

/** The library file no longer exists at the recorded path. */
const MISSING_COLUMN: string[] = [
  "ALTER TABLE books ADD COLUMN missing INTEGER NOT NULL DEFAULT 0",
];

/**
 * Idempotent forward migrations. Append a new statement list and bump
 * `user_version`; never edit an entry once it has shipped.
 */
const MIGRATIONS: string[][] = [
  SCHEMA,
  FILE_STAMPS,
  SERIES_COLUMNS,
  COVER_FLAG,
  READING_COLUMNS,
  MISSING_COLUMN,
];

export async function migrate(sql: Sql): Promise<void> {
  const rows = await sql.select<{ user_version: number }>(
    "PRAGMA user_version",
  );
  const current = Number(rows[0]?.user_version ?? 0);
  for (let version = current; version < MIGRATIONS.length; version++) {
    for (const statement of MIGRATIONS[version]) {
      try {
        await sql.execute(statement);
      } catch (error) {
        // A crash between two ALTERs leaves user_version behind. The next
        // launch re-runs the list; the columns that already exist are fine.
        if (!/duplicate column name/iu.test(String(error))) throw error;
      }
    }
    // PRAGMA does not accept a bound parameter.
    await sql.execute(`PRAGMA user_version = ${version + 1}`);
  }
}

// ---------------------------------------------------------------------------
// row mapping
// ---------------------------------------------------------------------------

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asReadStatus(value: unknown): ReadStatus {
  return typeof value === "string" &&
    (READ_STATUSES as readonly string[]).includes(value)
    ? (value as ReadStatus)
    : "unread";
}

function parseCandidates(value: unknown): Candidates {
  if (typeof value !== "string" || !value.trim()) return emptyCandidates();
  try {
    const parsed = JSON.parse(value) as Partial<Candidates>;
    const candidates = emptyCandidates();
    for (const field of CANDIDATE_FIELDS) {
      const list = parsed.fields?.[field];
      if (Array.isArray(list)) {
        candidates.fields[field] = list.filter(
          (entry) =>
            entry &&
            typeof entry.value === "string" &&
            typeof entry.source === "string",
        );
      }
    }
    if (Array.isArray(parsed.covers)) {
      candidates.covers = parsed.covers.filter(
        (cover) =>
          cover &&
          typeof cover.path === "string" &&
          typeof cover.source === "string" &&
          typeof cover.width === "number" &&
          typeof cover.height === "number",
      );
    }
    return candidates;
  } catch {
    return emptyCandidates();
  }
}

export function toBook(row: SqlRow): Book {
  const status = text(row.status, "needs_review") as Status;
  return {
    id: Number(row.id),
    bookUuid: nullableText(row.book_uuid),
    sha256: text(row.sha256),
    epubSha256: nullableText(row.epub_sha256),
    fileSize: nullableNumber(row.file_size),
    fileMtimeMs: nullableNumber(row.file_mtime_ms),
    sourcePath: nullableText(row.source_path),
    archivedPath: nullableText(row.archived_path),
    libraryPath: nullableText(row.library_path),
    hasCover: Number(row.has_cover ?? 0) !== 0,
    title: text(row.title),
    authors: text(row.authors),
    authorSort: nullableText(row.author_sort),
    titleSort: nullableText(row.title_sort),
    isbn: nullableText(row.isbn),
    description: nullableText(row.description),
    publisher: nullableText(row.publisher),
    published: nullableText(row.published),
    language: nullableText(row.language),
    tags: nullableText(row.tags),
    series: nullableText(row.series),
    seriesIndex: nullableText(row.series_index),
    readStatus: asReadStatus(row.read_status),
    personalNotes: nullableText(row.personal_notes),
    /** True when the row is kept but its library file cannot be found. */
    missing: Number(row.missing ?? 0) !== 0,
    status,
    flagReason: nullableText(row.flag_reason) as FlagReason | null,
    candidates: parseCandidates(row.candidates),
    notes: nullableText(row.notes),
    error: nullableText(row.error),
    pinned: Number(row.pinned ?? 0) !== 0,
    pinnedOrder: nullableNumber(row.pinned_order),
    addedAt: text(row.added_at),
    updatedAt: text(row.updated_at),
  };
}

// ---------------------------------------------------------------------------
// queries
// ---------------------------------------------------------------------------

const COLUMNS = [
  "book_uuid",
  "sha256",
  "epub_sha256",
  "file_size",
  "file_mtime_ms",
  "source_path",
  "archived_path",
  "library_path",
  "title",
  "authors",
  "author_sort",
  "title_sort",
  "isbn",
  "description",
  "publisher",
  "published",
  "language",
  "tags",
  "series",
  "series_index",
  "status",
  "flag_reason",
  "candidates",
  "notes",
  "error",
  "pinned",
  "pinned_order",
  "added_at",
  "updated_at",
] as const;

const INSERT_SQL = `INSERT INTO books (${COLUMNS.join(", ")})
VALUES (${COLUMNS.map(() => "?").join(", ")})`;

const ORDER_SQL = `ORDER BY pinned DESC,
  COALESCE(pinned_order, 0) DESC,
  CASE WHEN author_sort IS NULL OR author_sort = '' THEN 1 ELSE 0 END,
  author_sort COLLATE NOCASE,
  title_sort COLLATE NOCASE,
  title COLLATE NOCASE`;

export type ReconciledInput = {
  sha256: string;
  epubSha256: string;
  libraryPath: string;
  bookUuid?: string | null;
  metadata: Metadata;
  fileSize?: number | null;
  fileMtimeMs?: number | null;
  now?: string;
};

export class BookStore {
  constructor(readonly sql: Sql) {}

  static async open(sql: Sql): Promise<BookStore> {
    await migrate(sql);
    return new BookStore(sql);
  }

  async close(): Promise<void> {
    await this.sql.close();
  }

  // -- reads ---------------------------------------------------------------

  async get(id: number): Promise<Book | null> {
    const rows = await this.sql.select("SELECT * FROM books WHERE id = ?", [
      id,
    ]);
    return rows[0] ? toBook(rows[0]) : null;
  }

  async list(): Promise<Book[]> {
    const rows = await this.sql.select(`SELECT * FROM books ${ORDER_SQL}`);
    return rows.map(toBook);
  }

  /** The row that owns this library file, matched without regard to case. */
  async findByLibraryPath(path: string): Promise<Book | null> {
    const rows = await this.sql.select(
      "SELECT * FROM books WHERE lower(library_path) = lower(?) LIMIT 1",
      [path],
    );
    return rows[0] ? toBook(rows[0]) : null;
  }

  async findByEpubHash(hash: string): Promise<Book | null> {
    if (!hash) return null;
    const rows = await this.sql.select(
      "SELECT * FROM books WHERE epub_sha256 = ? LIMIT 1",
      [hash],
    );
    return rows[0] ? toBook(rows[0]) : null;
  }

  /**
   * Any match on the dropped file's hash, the library file's hash, or the EPUB
   * UUID. A book filed before the source was dropped counts too: its stored
   * `epub_sha256` equals the file's own hash.
   */
  async findDuplicate(
    sha256: string,
    bookUuid?: string | null,
  ): Promise<Book | null> {
    const rows = await this.sql.select(
      `SELECT * FROM books
       WHERE (? <> '' AND (sha256 = ? OR epub_sha256 = ?))
          OR (? IS NOT NULL AND book_uuid = ?)
       ORDER BY CASE status WHEN 'ok' THEN 0 WHEN 'needs_review' THEN 1 ELSE 2 END
       LIMIT 1`,
      [sha256, sha256, sha256, bookUuid ?? null, bookUuid ?? null],
    );
    return rows[0] ? toBook(rows[0]) : null;
  }

  async counts(): Promise<{
    total: number;
    flagged: number;
    needsReview: number;
    pinned: number;
  }> {
    const rows = await this.sql.select<{
      total: number;
      flagged: number;
      needs_review: number;
      pinned: number;
    }>(
      `SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END) AS flagged,
        SUM(CASE WHEN status = 'needs_review' THEN 1 ELSE 0 END) AS needs_review,
        SUM(CASE WHEN pinned = 1 THEN 1 ELSE 0 END) AS pinned
       FROM books`,
    );
    const row = rows[0];
    return {
      total: Number(row?.total ?? 0),
      flagged: Number(row?.flagged ?? 0),
      needsReview: Number(row?.needs_review ?? 0),
      pinned: Number(row?.pinned ?? 0),
    };
  }

  // -- writes --------------------------------------------------------------

  /** Insert the row an ingest produced and return it. */
  async insert(outcome: IngestOutcome): Promise<Book> {
    const now = new Date().toISOString();
    const metadata = outcome.metadata ?? { title: "", authors: "" };
    const values: SqlValue[] = [
      outcome.bookUuid ?? null,
      outcome.sha256 || null,
      outcome.epubSha256 ?? null,
      outcome.fileSize ?? null,
      outcome.fileMtimeMs ?? null,
      outcome.sourcePath || null,
      outcome.archivedPath ?? null,
      outcome.libraryPath ?? null,
      metadata.title ?? "",
      metadata.authors ?? "",
      metadata.authorSort ?? null,
      metadata.titleSort ?? null,
      metadata.isbn ?? null,
      metadata.description ?? null,
      metadata.publisher ?? null,
      metadata.published ?? null,
      metadata.language ?? null,
      metadata.tags ?? null,
      metadata.series ?? null,
      metadata.seriesIndex ?? null,
      outcome.status,
      outcome.flagReason ?? null,
      JSON.stringify(outcome.candidates ?? emptyCandidates()),
      outcome.notes ?? null,
      outcome.error ?? null,
      0,
      null,
      now,
      now,
    ];

    const result = await this.sql.execute(INSERT_SQL, values);
    if (result.lastInsertId !== null) {
      const book = await this.get(result.lastInsertId);
      if (book) return book;
    }
    // Some drivers do not report a last id; the unique hash identifies it.
    const book =
      (outcome.sha256
        ? await this.findDuplicate(outcome.sha256, outcome.bookUuid)
        : null) ?? null;
    if (!book)
      throw new Error("insert succeeded but the row cannot be read back");
    return book;
  }

  /** A row discovered by `reconcile`, with no known drop source. */
  async insertReconciled(input: ReconciledInput): Promise<Book> {
    const missingMetadata =
      !(input.metadata.title ?? "").trim() ||
      !(input.metadata.authors ?? "").trim();
    return this.insert({
      sourcePath: "",
      sha256: input.sha256,
      epubSha256: input.epubSha256,
      fileSize: input.fileSize ?? undefined,
      fileMtimeMs: input.fileMtimeMs ?? undefined,
      libraryPath: input.libraryPath,
      bookUuid: input.bookUuid ?? undefined,
      status: missingMetadata ? "needs_review" : "ok",
      flagReason: missingMetadata ? "metadata_missing" : undefined,
      metadata: input.metadata,
      candidates: emptyCandidates(),
    });
  }

  /**
   * Refresh a row from the EPUB now sitting at `libraryPath`. Pins, added_at,
   * source/archive paths, and candidates are per-book data the EPUB does not
   * carry, so they stay as they are.
   */
  async refreshFromEpub(id: number, input: ReconciledInput): Promise<void> {
    const metadata = input.metadata;
    await this.sql.execute(
      `UPDATE books SET
        book_uuid = COALESCE(book_uuid, ?),
        epub_sha256 = ?,
        file_size = ?,
        file_mtime_ms = ?,
        has_cover = 0,
        missing = 0,
        library_path = ?,
        title = ?,
        authors = ?,
        author_sort = ?,
        title_sort = ?,
        isbn = ?,
        description = ?,
        publisher = ?,
        published = ?,
        language = ?,
        tags = ?,
        series = ?,
        series_index = ?,
        updated_at = ?
       WHERE id = ?`,
      [
        input.bookUuid ?? null,
        input.epubSha256,
        input.fileSize ?? null,
        input.fileMtimeMs ?? null,
        input.libraryPath,
        metadata.title ?? "",
        metadata.authors ?? "",
        metadata.authorSort ?? null,
        metadata.titleSort ?? null,
        metadata.isbn ?? null,
        metadata.description ?? null,
        metadata.publisher ?? null,
        metadata.published ?? null,
        metadata.language ?? null,
        metadata.tags ?? null,
        metadata.series ?? null,
        metadata.seriesIndex ?? null,
        input.now ?? new Date().toISOString(),
        id,
      ],
    );
  }

  /**
   * After a manual edit: the EPUB was written and verified first, so this only
   * refreshes the cached fields. A `needs_review` book is resolved by the edit.
   */
  async updateEdited(
    id: number,
    metadata: Metadata,
    epubSha256: string,
    resolveReview: boolean,
    reading: { status: ReadStatus; notes: string | null },
    candidates?: Candidates,
    file?: { size: number; mtimeMs: number },
  ): Promise<void> {
    await this.sql.execute(
      `UPDATE books SET
        title = ?,
        authors = ?,
        author_sort = ?,
        title_sort = ?,
        isbn = ?,
        description = ?,
        publisher = ?,
        published = ?,
        language = ?,
        tags = ?,
        series = ?,
        series_index = ?,
        read_status = ?,
        personal_notes = ?,
        candidates = COALESCE(?, candidates),
        epub_sha256 = ?,
        file_size = COALESCE(?, file_size),
        file_mtime_ms = COALESCE(?, file_mtime_ms),
        missing = 0,
        updated_at = ?,
        status = CASE WHEN ? = 1 THEN 'ok' ELSE status END,
        flag_reason = CASE WHEN ? = 1 THEN NULL ELSE flag_reason END,
        error = NULL
       WHERE id = ?`,
      [
        metadata.title ?? "",
        metadata.authors ?? "",
        metadata.authorSort ?? null,
        metadata.titleSort ?? null,
        metadata.isbn ?? null,
        metadata.description ?? null,
        metadata.publisher ?? null,
        metadata.published ?? null,
        metadata.language ?? null,
        metadata.tags ?? null,
        metadata.series ?? null,
        metadata.seriesIndex ?? null,
        reading.status,
        reading.notes,
        candidates ? JSON.stringify(candidates) : null,
        epubSha256,
        file?.size ?? null,
        file?.mtimeMs ?? null,
        new Date().toISOString(),
        resolveReview ? 1 : 0,
        resolveReview ? 1 : 0,
        id,
      ],
    );
  }

  /** App-only reading state; no EPUB rewrite is needed for this. */
  async setReading(
    id: number,
    status: ReadStatus,
    notes: string | null,
  ): Promise<void> {
    await this.sql.execute(
      "UPDATE books SET read_status = ?, personal_notes = ?, updated_at = ? WHERE id = ?",
      [status, notes, new Date().toISOString(), id],
    );
  }

  /** Remember the stat after a hash confirms the file did not change. */
  async updateLibraryStamp(
    id: number,
    size: number,
    mtimeMs: number,
  ): Promise<void> {
    await this.sql.execute(
      "UPDATE books SET file_size = ?, file_mtime_ms = ? WHERE id = ?",
      [size, mtimeMs, id],
    );
  }

  /** Point a row at a file that moved, with its fresh stat. */
  async updateLibraryLocation(
    id: number,
    path: string,
    size: number | null,
    mtimeMs: number | null,
  ): Promise<void> {
    await this.sql.execute(
      `UPDATE books
       SET library_path = ?, file_size = ?, file_mtime_ms = ?, missing = 0,
           updated_at = ?
       WHERE id = ?`,
      [path, size, mtimeMs, new Date().toISOString(), id],
    );
  }

  /** Whether a cover image exists, for the grid's missing-cover filter. */
  async setHasCover(id: number, hasCover: boolean): Promise<void> {
    await this.sql.execute("UPDATE books SET has_cover = ? WHERE id = ?", [
      hasCover ? 1 : 0,
      id,
    ]);
  }

  /** Remember whether the library file can still be found at its path. */
  async setMissing(id: number, missing: boolean): Promise<void> {
    await this.sql.execute(
      "UPDATE books SET missing = ?, updated_at = ? WHERE id = ?",
      [missing ? 1 : 0, new Date().toISOString(), id],
    );
  }

  async setPinned(id: number, pinned: boolean): Promise<void> {
    const now = new Date().toISOString();
    await this.sql.execute(
      "UPDATE books SET pinned = ?, pinned_order = ?, updated_at = ? WHERE id = ?",
      [pinned ? 1 : 0, pinned ? Date.now() : null, now, id],
    );
  }

  /** Save the pinned zone in top-to-bottom order. */
  async reorderPinned(ids: number[]): Promise<void> {
    const now = new Date().toISOString();
    for (let index = 0; index < ids.length; index++) {
      await this.sql.execute(
        "UPDATE books SET pinned_order = ?, updated_at = ? WHERE id = ? AND pinned = 1",
        [ids.length - index, now, ids[index]],
      );
    }
  }

  async remove(id: number): Promise<void> {
    await this.sql.execute("DELETE FROM books WHERE id = ?", [id]);
  }
}
