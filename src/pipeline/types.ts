/**
 * Shared types. Imported by the pipeline and the UI; keep them free of runtime
 * dependencies.
 */

export type Status = "ok" | "needs_review" | "flagged";

/** App-only reading state; never written into the EPUB. */
export const READ_STATUSES = ["unread", "reading", "finished"] as const;

export type ReadStatus = (typeof READ_STATUSES)[number];

export type FlagReason =
  | "drm"
  | "no_text"
  | "convert_failed"
  | "clean_failed"
  | "unreadable"
  | "metadata_missing";

/** The metadata written into the EPUB, all fields as calibre stores them. */
export type Metadata = {
  title: string;
  /** Calibre's "First Last & First Last" form, empty when unknown. */
  authors: string;
  authorSort?: string;
  titleSort?: string;
  isbn?: string;
  description?: string;
  publisher?: string;
  /** YYYY-MM-DD; anything implausible is dropped before the write. */
  published?: string;
  language?: string;
  /** Comma-separated, as passed to `ebook-meta --tags`. */
  tags?: string;
  /** Calibre's `calibre:series` metadata. Free text, entered by hand. */
  series?: string;
  /** `calibre:series_index`; a decimal string, e.g. `2` or `1.5`. */
  seriesIndex?: string;
};

/** Fields a candidate value can belong to. Author/title sort are derived. */
export const CANDIDATE_FIELDS = [
  "title",
  "authors",
  "isbn",
  "description",
  "publisher",
  "published",
  "language",
  "tags",
  "series",
  "seriesIndex",
] as const;

export type CandidateField = (typeof CANDIDATE_FIELDS)[number];

/** A provider id. Ids are stored in `candidates`, so unknown ones must survive. */
export type SourceId = string;

/** The source that supplied a value. Known ids live in `sources/labels.ts`. */
export type CandidateSource = SourceId;

/** One value seen for a field, with the place it came from. */
export type FieldCandidate = {
  value: string;
  source: CandidateSource;
};

/** A downloaded cover candidate. `path` is relative to the config home dir. */
export type CoverCandidate = {
  path: string;
  source: SourceId;
  width: number;
  height: number;
};

/**
 * Every value the pipeline saw, kept so the edit sheet can offer alternatives.
 * The book's own fields hold the chosen default.
 */
export type Candidates = {
  fields: Record<CandidateField, FieldCandidate[]>;
  covers: CoverCandidate[];
};

export function emptyCandidates(): Candidates {
  return {
    fields: {
      title: [],
      authors: [],
      isbn: [],
      description: [],
      publisher: [],
      published: [],
      language: [],
      tags: [],
      series: [],
      seriesIndex: [],
    },
    covers: [],
  };
}

/** One row of `books`, mapped to camelCase. */
export type Book = {
  id: number;
  /** The EPUB's package UUID, when it has one. */
  bookUuid: string | null;
  /** Hash of the dropped file, or the library file's hash for reconciled rows. */
  sha256: string;
  /** Hash of the file in the library. */
  epubSha256: string | null;
  /** Cheap stamp used to skip re-hashing unchanged library files at startup. */
  fileSize: number | null;
  fileMtimeMs: number | null;
  sourcePath: string | null;
  archivedPath: string | null;
  /** Null for flagged rows. */
  libraryPath: string | null;
  /** True when the app has a cover image for this book. */
  hasCover: boolean;
  title: string;
  authors: string;
  authorSort: string | null;
  titleSort: string | null;
  isbn: string | null;
  description: string | null;
  publisher: string | null;
  published: string | null;
  language: string | null;
  tags: string | null;
  series: string | null;
  seriesIndex: string | null;
  /** App-only; not stored in the EPUB. Existing rows migrate as `unread`. */
  readStatus: ReadStatus;
  /** Private notes, kept in the database only. */
  personalNotes: string | null;
  /** The library file could not be found; the row and its notes are kept. */
  missing: boolean;
  status: Status;
  flagReason: FlagReason | null;
  candidates: Candidates;
  notes: string | null;
  error: string | null;
  pinned: boolean;
  pinnedOrder: number | null;
  addedAt: string;
  updatedAt: string;
};

/** What one dropped file turned into. The database row is built from this. */
export type IngestOutcome = {
  sourcePath: string;
  /** Empty when the file could not be read at all. */
  sha256: string;
  status: Status;
  flagReason?: FlagReason;
  /** Last useful stderr or exception text. */
  error?: string;
  /** Soft signals such as `edition_mismatch: ...`. */
  notes?: string;
  /** Cleaning was skipped but the converted EPUB was filed anyway. */
  cleanWarning?: string;
  libraryPath?: string;
  archivedPath?: string;
  metadata?: Metadata;
  /** Hash of the EPUB we wrote, once there is one. */
  epubSha256?: string;
  /** Size and mtime of the library file, for startup change detection. */
  fileSize?: number;
  fileMtimeMs?: number;
  /** The EPUB's own dc:identifier, when it has one. */
  bookUuid?: string;
  /** Every value seen, for the edit sheet. */
  candidates?: Candidates;
  /** The stored row. Set unless the insert itself failed. */
  book?: Book;
  /**
   * True when the file was already in the library. `book` is the existing row
   * and nothing was written.
   */
  duplicate?: boolean;
};
