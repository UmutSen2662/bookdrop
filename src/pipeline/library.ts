/**
 * Library rows and library files: pin, remove, reconcile, and the startup
 * cleanup. These are the operations the app calls outside the drop pipeline.
 */
import type { CalibreInstall } from "./calibre";
import {
  extractCover,
  failureText,
  readMetadataOpf,
  writeMetadata,
} from "./calibre";
import type { Config } from "./config";
import {
  type DownloadedCover,
  downloadCover,
  storeCoverCandidates,
} from "./covers";
import type { BookStore } from "./db";
import { errorMessage } from "./errors";
import type { Host } from "./host";
import { lookupBookMetadata } from "./lookup";
import { parseOpf } from "./metadata";
import { formatLibraryFileName, withCollisionSuffix } from "./names";
import { basename, dirname, joinPath, normalizedFolder } from "./paths";
import type { Book, Candidates, Metadata, ReadStatus } from "./types";

/**
 * Update a row's `missing` flag from what is actually on disk. Returns the
 * refreshed row when the file is present, or null when it is not. Reading
 * state and metadata are never touched: a missing file must not cost notes.
 */
export async function checkBookFile(
  host: Host,
  store: BookStore,
  book: Book,
): Promise<Book | null> {
  if (!book.libraryPath) return null;
  const info = await host.stat(book.libraryPath).catch(() => null);
  const exists = Boolean(info && !info.isDirectory);
  if (exists !== !book.missing) {
    await store.setMissing(book.id, !exists);
  }
  return exists ? store.get(book.id) : null;
}

export type EditBookInput = {
  /** Every field the sheet chose. The EPUB is written with these values. */
  metadata: Metadata;
  /** Absolute path to a new cover, or undefined to keep the file's cover. */
  coverPath?: string;
  /** The form's candidate list after any alternatives were removed. */
  candidates?: Candidates;
  /** App-only reading state; omitted means "keep what the row has". */
  reading?: { status: ReadStatus; notes: string | null };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Windows refuses to replace a file held open by a reader, Defender, Dropbox,
 * or the calibre viewer. Retry briefly, then say so instead of a cryptic error.
 */
async function replaceWithRetry(
  host: Host,
  target: string,
  bytes: Uint8Array,
): Promise<void> {
  let last: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await host.writeFileAtomic(target, bytes);
      return;
    } catch (error) {
      last = error;
      if (attempt < 4) await sleep(150 * 2 ** attempt);
    }
  }
  throw new Error(
    `The library file is in use and could not be replaced. Close any reader or the calibre viewer, then try again. ${errorMessage(last)}`,
  );
}

/**
 * Edit a book: write a `.tmp-*` copy in the library folder, verify it, replace
 * the live file atomically, then update the row. The filename is never changed.
 *
 * The EPUB is the source of truth. If the write fails, the row is untouched.
 */
export async function editBook(
  host: Host,
  config: Config,
  store: BookStore,
  install: CalibreInstall,
  book: Book,
  input: EditBookInput,
): Promise<Book> {
  if (!book.libraryPath) {
    throw new Error("This book has no library file to edit.");
  }
  const info = await host.stat(book.libraryPath);
  if (!info || info.isDirectory) {
    throw new Error(
      `The library file is missing: ${book.libraryPath}. Restore it and use Recheck in the book panel.`,
    );
  }

  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const libraryDir = dirname(book.libraryPath);
  const tempEpub = joinPath(libraryDir, `.tmp-edit-${stamp}.epub`);
  const workDir = joinPath(config.homeDir, "tmp", `edit-${stamp}`);

  try {
    await host.copyFile(book.libraryPath, tempEpub);
    await host.ensureDir(workDir);

    const written = await writeMetadata(
      host,
      install,
      tempEpub,
      input.metadata,
      input.coverPath,
    );
    if (written.code !== 0) {
      throw new Error(`Metadata write failed: ${failureText(written)}`);
    }

    const verified = parseOpf(
      await readMetadataOpf(
        host,
        install,
        tempEpub,
        joinPath(workDir, "verify.opf"),
      ),
    );
    if (!verified.title || !verified.authors) {
      throw new Error(
        "The EPUB came back without a title or author; the library file was not replaced.",
      );
    }

    if (input.coverPath) {
      const extracted = await extractCover(
        host,
        install,
        tempEpub,
        joinPath(workDir, "verify-cover.jpg"),
      );
      if (!extracted) {
        throw new Error(
          "The new cover did not survive the write; the library file was not replaced.",
        );
      }
    }

    const epubSha256 = await host.hashFile(tempEpub);
    await replaceWithRetry(
      host,
      book.libraryPath,
      await host.readFile(tempEpub),
    );
    const replaced = await host.stat(book.libraryPath);

    // Omitting `reading` means "keep the row's state", not "clear the notes".
    const reading = input.reading
      ? {
          status: input.reading.status,
          notes: input.reading.notes?.trim() || null,
        }
      : { status: book.readStatus, notes: book.personalNotes };
    await store.updateEdited(
      book.id,
      verified,
      epubSha256,
      book.status === "needs_review",
      reading,
      input.candidates,
      replaced ? { size: replaced.size, mtimeMs: replaced.mtimeMs } : undefined,
    );

    // A candidate removed in the sheet disappears from the JSON on save; drop
    // its image too. This is after the EPUB write, so a failed save keeps it.
    if (input.candidates) {
      const kept = new Set(input.candidates.covers.map((cover) => cover.path));
      for (const cover of book.candidates.covers) {
        if (!kept.has(cover.path)) {
          await host
            .removeFile(joinPath(config.homeDir, cover.path))
            .catch(() => undefined);
        }
      }
    }

    let hasCover = false;
    if (host.makeThumbnail) {
      try {
        const cover = joinPath(workDir, "cover.jpg");
        const coverDir = joinPath(config.homeDir, "covers");
        const thumbnail = joinPath(coverDir, `${book.id}.jpg`);
        const full = joinPath(coverDir, `${book.id}-full.jpg`);
        // If a new cover was chosen, stale images are worse than none:
        // startup regenerates missing ones.
        if (input.coverPath) {
          await host.removeFile(thumbnail).catch(() => undefined);
          await host.removeFile(full).catch(() => undefined);
        }
        if (await extractCover(host, install, tempEpub, cover)) {
          await host.ensureDir(coverDir);
          await host.makeThumbnail(cover, thumbnail, 400);
          await host.makeThumbnail(cover, full, 1600);
          hasCover = true;
        } else {
          await host.removeFile(thumbnail);
          await host.removeFile(full);
        }
      } catch {
        // Missing images are regenerated on the next startup or on demand.
      }
    }
    await store.setHasCover(book.id, hasCover).catch(() => undefined);

    const updated = await store.get(book.id);
    if (!updated) throw new Error("The edited row disappeared.");
    return updated;
  } finally {
    await host.removeFile(tempEpub).catch(() => undefined);
    await host.removeDir(workDir).catch(() => undefined);
  }
}

/**
 * Save the app-only reading state. Unlike a metadata edit this touches no
 * files: marking a book finished must never rewrite its EPUB.
 */
export async function saveReading(
  store: BookStore,
  id: number,
  reading: { status: ReadStatus; notes: string | null },
): Promise<Book> {
  await store.setReading(id, reading.status, reading.notes?.trim() || null);
  const updated = await store.get(id);
  if (!updated) throw new Error("The book row disappeared.");
  return updated;
}

/**
 * The full cover the lightbox shows. Cached at `covers/<id>-full.jpg`; if it is
 * missing, extract it from the EPUB once and keep it. Display-only, so every
 * failure degrades to the thumbnail rather than an error.
 */
export async function ensureFullCover(
  host: Host,
  config: Config,
  install: CalibreInstall | null,
  book: Book,
): Promise<string | null> {
  if (!book.libraryPath || !host.makeThumbnail) return null;

  const coverDir = joinPath(config.homeDir, "covers");
  const full = joinPath(coverDir, `${book.id}-full.jpg`);
  const existing = await host.stat(full).catch(() => null);
  if (existing?.size) return full;
  if (!install) return null;

  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const work = joinPath(config.homeDir, "tmp", `full-${book.id}-${stamp}.jpg`);
  try {
    await host.ensureDir(joinPath(config.homeDir, "tmp"));
    if (!(await extractCover(host, install, book.libraryPath, work))) {
      return null;
    }
    await host.ensureDir(coverDir);
    await host.makeThumbnail(work, full, 1600);
    return full;
  } catch {
    return null;
  } finally {
    await host.removeFile(work).catch(() => undefined);
  }
}

export type RefreshMetadataResult = {
  /** An additive merge; the sheet only fills its empty fields with it. */
  metadata: Metadata;
  candidates: Candidates;
  /** False when neither provider returned a usable match. */
  found: boolean;
  notes: string[];
};

/**
 * Ask the providers again for an existing book. This never writes: the edit
 * sheet receives the result, fills only empty fields, and adds every value as
 * an alternative. Nothing reaches the EPUB until the user saves.
 */
export async function refreshBookMetadata(
  host: Host,
  config: Config,
  install: CalibreInstall,
  book: Book,
): Promise<RefreshMetadataResult> {
  if (!book.libraryPath) {
    throw new Error("This book has no library file to refresh.");
  }
  if (!config.fetchMetadata && !config.fetchCovers) {
    throw new Error("Turn on metadata or cover fetching in Settings first.");
  }

  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const workDir = joinPath(
    config.homeDir,
    "tmp",
    `refresh-${book.id}-${stamp}`,
  );
  try {
    const lookup = await lookupBookMetadata(host, install, book.libraryPath, {
      fetchMetadata: config.fetchMetadata,
      fetchCovers: config.fetchCovers,
      workDir,
      sourcePath: book.sourcePath ?? "",
    });
    const notes = [...lookup.notes];
    if (lookup.merged.notes) notes.push(lookup.merged.notes);

    let candidates = lookup.candidates;
    // Fetched covers are always alternatives; the file's current cover stays.
    // A needs_review match may be the wrong edition, so its links are skipped.
    if (
      config.fetchCovers &&
      lookup.merged.status === "ok" &&
      lookup.coverLinks.length > 0 &&
      book.sha256
    ) {
      const coverDir = joinPath(workDir, "covers");
      await host.ensureDir(coverDir);
      const downloaded: DownloadedCover[] = [];
      for (const link of lookup.coverLinks) {
        const cover = await downloadCover(host, link, coverDir);
        if (cover) downloaded.push(cover);
      }
      if (downloaded.length > 0) {
        try {
          candidates = {
            ...candidates,
            covers: await storeCoverCandidates(
              host,
              config.homeDir,
              book.sha256.slice(0, 8),
              downloaded,
            ),
          };
        } catch (error) {
          notes.push(`cover candidates not saved: ${errorMessage(error)}`);
        }
      }
    }

    return {
      metadata: lookup.merged.metadata,
      candidates,
      found: lookup.found || candidates.covers.length > 0,
      notes,
    };
  } finally {
    await host.removeDir(workDir).catch(() => undefined);
  }
}

export type CoverSize = { width: number; height: number };

/**
 * The file cover's real dimensions, for the edit sheet's size badge. This
 * extracts the original cover at its full size; the thumbnail and full-cover
 * caches are resized, so they cannot answer this. Display-only: every failure
 * degrades to no badge.
 */
export async function readCoverSize(
  host: Host,
  config: Config,
  install: CalibreInstall | null,
  book: Book,
): Promise<CoverSize | null> {
  if (!book.libraryPath || !install || !host.imageSize) return null;

  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  const work = joinPath(
    config.homeDir,
    "tmp",
    `coversize-${book.id}-${stamp}.jpg`,
  );
  try {
    await host.ensureDir(joinPath(config.homeDir, "tmp"));
    if (!(await extractCover(host, install, book.libraryPath, work))) {
      return null;
    }
    return await host.imageSize(work);
  } catch {
    return null;
  } finally {
    await host.removeFile(work).catch(() => undefined);
  }
}

export type RemoveOptions = {
  /** The confirmation dialog's optional checkbox. The source is never touched. */
  deleteArchive?: boolean;
};

/**
 * Delete the library EPUB, the row, the thumbnail, its candidate covers, and
 * optionally the archived copy. The source file is never touched.
 */
export async function removeBook(
  host: Host,
  config: Config,
  store: BookStore,
  book: Book,
  options: RemoveOptions = {},
): Promise<void> {
  if (book.libraryPath) await host.removeFile(book.libraryPath);
  if (options.deleteArchive && book.archivedPath) {
    await host.removeFile(book.archivedPath);
  }
  await host.removeFile(joinPath(config.homeDir, "covers", `${book.id}.jpg`));
  await host.removeFile(
    joinPath(config.homeDir, "covers", `${book.id}-full.jpg`),
  );
  if (book.sha256) {
    await host.removeDir(
      joinPath(config.homeDir, "candidates", book.sha256.slice(0, 8)),
    );
  }
  await store.remove(book.id);
}

// ---------------------------------------------------------------------------
// renaming the library
// ---------------------------------------------------------------------------

export type RenameMove = {
  id: number;
  title: string;
  from: string;
  to: string;
};

export type RenamePlan = {
  moves: RenameMove[];
  /** Books whose filename already matches the template. */
  unchanged: number;
  /** Books that will not move, with the reason. */
  problems: string[];
};

export type RenameReport = {
  renamed: number;
  problems: string[];
};

type JournalEntry = { id: number; from: string; to: string; tmp: string };

function journalPath(config: Config): string {
  return joinPath(config.homeDir, "rename-journal.json");
}

/**
 * Work out the names the template would produce without touching anything.
 * The plan is what the confirm dialog shows and what `applyLibraryRenames`
 * executes, so a preview and a rename never disagree about collisions.
 */
export async function planLibraryRenames(
  host: Host,
  config: Config,
  store: BookStore,
  template: string = config.fileNameTemplate,
): Promise<RenamePlan> {
  const plan: RenamePlan = { moves: [], unchanged: 0, problems: [] };
  if (!config.libraryDir) {
    plan.problems.push("Choose a library folder first.");
    return plan;
  }
  const library = await host.stat(config.libraryDir);
  if (!library?.isDirectory) {
    plan.problems.push(`library folder is missing: ${config.libraryDir}`);
    return plan;
  }

  let entries: string[];
  try {
    entries = await host.listDir(config.libraryDir);
  } catch (error) {
    plan.problems.push(`cannot list the library: ${errorMessage(error)}`);
    return plan;
  }

  const home = normalizedFolder(config.libraryDir);
  const changing: { book: Book; desired: string }[] = [];
  let elsewhere = 0;

  for (const book of await store.list()) {
    if (!book.libraryPath) continue;
    if (normalizedFolder(dirname(book.libraryPath)) !== home) {
      elsewhere++;
      continue;
    }
    if (book.missing) {
      plan.problems.push(
        `${book.title || "Untitled"}: the file is missing; not renamed`,
      );
      continue;
    }
    const desired = formatLibraryFileName(template, {
      title: book.title,
      authors: book.authors,
      series: book.series,
      seriesIndex: book.seriesIndex,
      published: book.published,
    });
    // A case-only difference would be a rename on a case-insensitive disk.
    if (basename(book.libraryPath).toLowerCase() === desired.toLowerCase()) {
      plan.unchanged++;
      continue;
    }
    changing.push({ book, desired });
  }

  if (elsewhere > 0) {
    plan.problems.push(
      `${elsewhere} book(s) live in another folder and were not renamed.`,
    );
  }

  // A name is available unless a file that stays put owns it.
  const reserved = new Set(entries.map((name) => name.toLowerCase()));
  for (const { book } of changing) {
    if (book.libraryPath) {
      reserved.delete(basename(book.libraryPath).toLowerCase());
    }
  }

  changing.sort((left, right) => left.book.id - right.book.id);
  for (const { book, desired } of changing) {
    const hash = book.epubSha256 || book.sha256 || `id-${book.id}`;
    let name = desired;
    for (let attempt = 1; reserved.has(name.toLowerCase()); attempt++) {
      if (attempt > 20) break;
      name = withCollisionSuffix(desired, hash, attempt);
    }
    if (reserved.has(name.toLowerCase())) {
      plan.problems.push(`${book.title}: no free filename; not renamed`);
      continue;
    }
    const from = book.libraryPath;
    if (!from) continue;
    reserved.add(name.toLowerCase());
    plan.moves.push({
      id: book.id,
      title: book.title,
      from,
      to: joinPath(config.libraryDir, name),
    });
  }

  return plan;
}

function tmpNameFor(move: RenameMove, stamp: string): string {
  return joinPath(dirname(move.from), `.tmp-rename-${move.id}-${stamp}.epub`);
}

/**
 * Execute a plan. Every source moves to a temporary name first, so two books
 * can swap names without one overwriting the other.
 *
 * A journal is written before anything moves. If the app dies mid-way, the
 * next start finishes the moves instead of leaving books at `.tmp-` names that
 * reconcile would ignore.
 */
export async function applyLibraryRenames(
  host: Host,
  config: Config,
  store: BookStore,
  plan: RenamePlan,
): Promise<RenameReport> {
  const report: RenameReport = { renamed: 0, problems: [] };
  if (plan.moves.length === 0) return report;

  const stamp = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const journal = {
    moves: plan.moves.map<JournalEntry>((move) => ({
      id: move.id,
      from: move.from,
      to: move.to,
      tmp: tmpNameFor(move, stamp),
    })),
  };
  const path = journalPath(config);
  try {
    await host.writeFileAtomic(
      path,
      new TextEncoder().encode(`${JSON.stringify(journal, null, 2)}\n`),
    );
  } catch (error) {
    report.problems.push(
      `could not write the rename journal: ${errorMessage(error)}`,
    );
    return report;
  }

  const staged: JournalEntry[] = [];
  for (const entry of journal.moves) {
    const info = await host.stat(entry.from);
    if (!info) {
      report.problems.push(`${basename(entry.from)}: file is missing`);
      continue;
    }
    try {
      await host.renameFile(entry.from, entry.tmp);
      staged.push(entry);
    } catch (error) {
      report.problems.push(`${basename(entry.from)}: ${errorMessage(error)}`);
    }
  }

  let unresolved = false;
  for (const entry of staged) {
    try {
      await host.renameFile(entry.tmp, entry.to);
      const info = await host.stat(entry.to);
      await store.updateLibraryLocation(
        entry.id,
        entry.to,
        info?.size ?? null,
        info?.mtimeMs ?? null,
      );
      report.renamed++;
    } catch (error) {
      unresolved = true;
      report.problems.push(`${basename(entry.from)}: ${errorMessage(error)}`);
      // Put the book back where it was; the next start can still recover from
      // the journal if even that fails.
      await host.renameFile(entry.tmp, entry.from).catch(() => undefined);
    }
  }

  if (!unresolved) await host.removeFile(path).catch(() => undefined);
  return report;
}

/**
 * Finish a rename a crash interrupted. Called before reconcile: the temporary
 * names are invisible to it, but the journal is not.
 */
async function resumeRenameJournal(
  host: Host,
  config: Config,
  store: BookStore,
): Promise<{ resumed: number; problems: string[] }> {
  const path = journalPath(config);
  const result = { resumed: 0, problems: [] as string[] };
  if (!(await host.stat(path))) return result;

  let moves: JournalEntry[] = [];
  try {
    const text = new TextDecoder("utf-8").decode(await host.readFile(path));
    const parsed = JSON.parse(text) as { moves?: JournalEntry[] };
    moves = Array.isArray(parsed.moves) ? parsed.moves : [];
  } catch (error) {
    result.problems.push(
      `rename journal is unreadable: ${errorMessage(error)}`,
    );
    await host.removeFile(path).catch(() => undefined);
    return result;
  }

  let unresolved = false;
  for (const entry of moves) {
    if (!entry || typeof entry.id !== "number" || !entry.to || !entry.tmp) {
      unresolved = true;
      continue;
    }
    const atTarget = await host.stat(entry.to);
    const atTemp = await host.stat(entry.tmp);

    if (atTarget) {
      // The file reached its name; the row may not have been updated yet.
      await store
        .updateLibraryLocation(
          entry.id,
          entry.to,
          atTarget.size,
          atTarget.mtimeMs,
        )
        .catch(() => undefined);
      result.resumed++;
      continue;
    }
    if (atTemp) {
      try {
        await host.renameFile(entry.tmp, entry.to);
        const moved = await host.stat(entry.to);
        await store.updateLibraryLocation(
          entry.id,
          entry.to,
          moved?.size ?? null,
          moved?.mtimeMs ?? null,
        );
        result.resumed++;
      } catch (error) {
        unresolved = true;
        result.problems.push(`${basename(entry.tmp)}: ${errorMessage(error)}`);
      }
      continue;
    }
    // Neither new name exists. If the source is back in place, a failed rename
    // already rolled itself back; otherwise the file is really gone.
    if (await host.stat(entry.from)) continue;
    result.problems.push(
      `${basename(entry.from)}: the file disappeared during the rename`,
    );
  }

  if (!unresolved) await host.removeFile(path).catch(() => undefined);
  return result;
}

export type ReconcileReport = {
  added: number;
  refreshed: number;
  /** Files reconcile could not read; they are skipped, never deleted. */
  problems: string[];
  removedCandidateDirs: number;
  /** Unreferenced images left behind by a cancelled refresh. */
  removedCandidateFiles: number;
  /** A file that moved outside the app was re-attached to its row by hash. */
  adopted: number;
};

function isEpubFile(name: string): boolean {
  return (
    name.toLowerCase().endsWith(".epub") &&
    !name.toLowerCase().startsWith(".tmp-")
  );
}

/**
 * Scan the library folder and make the rows match it. A file with no row is
 * inserted; a row whose file changed is refreshed from the EPUB. Pins,
 * `added_at`, source paths, and candidates survive because the EPUB does not
 * carry them.
 */
export async function reconcile(
  host: Host,
  config: Config,
  store: BookStore,
  install: CalibreInstall | null,
): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    added: 0,
    refreshed: 0,
    problems: [],
    removedCandidateDirs: 0,
    removedCandidateFiles: 0,
    adopted: 0,
  };

  if (!config.libraryDir) return report;

  const library = await host.stat(config.libraryDir);
  if (!library?.isDirectory) {
    report.problems.push(`library folder is missing: ${config.libraryDir}`);
    return report;
  }

  let names: string[];
  try {
    names = await host.listDir(config.libraryDir);
  } catch (error) {
    report.problems.push(`cannot list the library: ${errorMessage(error)}`);
    return report;
  }

  if (names.some(isEpubFile)) {
    if (!install) {
      report.problems.push(
        "calibre is not available, so library files cannot be read back",
      );
    } else {
      const tmpDir = joinPath(config.homeDir, "tmp", "reconcile");
      await host.ensureDir(tmpDir);
      try {
        for (const name of names.filter(isEpubFile)) {
          const path = joinPath(config.libraryDir, name);
          try {
            const info = await host.stat(path);
            if (!info || info.isDirectory) {
              report.problems.push(`${name}: not readable`);
              continue;
            }

            const existing = await store.findByLibraryPath(path);
            const stampUnchanged =
              existing &&
              existing.fileSize === info.size &&
              existing.fileMtimeMs === info.mtimeMs &&
              existing.epubSha256;
            // Unchanged size and mtime: skip the expensive full-file hash.
            if (stampUnchanged) continue;

            const hash = await host.hashFile(path);
            if (existing?.epubSha256 === hash) {
              // The bytes are the same; remember the new stamp and stop.
              await store.updateLibraryStamp(
                existing.id,
                info.size,
                info.mtimeMs,
              );
              continue;
            }

            // A file renamed outside the app (or by an interrupted rename) has
            // no row at its new path. If its bytes belong to a row whose file
            // is gone, re-attach that row instead of losing pins and covers.
            if (!existing) {
              const owner = await store.findByEpubHash(hash);
              const ownerPresent = owner?.libraryPath
                ? await host.stat(owner.libraryPath)
                : null;
              if (owner?.libraryPath && !ownerPresent) {
                await store.updateLibraryLocation(
                  owner.id,
                  path,
                  info.size,
                  info.mtimeMs,
                );
                report.adopted++;
                continue;
              }
            }

            const metadata = parseOpf(
              await readMetadataOpf(
                host,
                install,
                path,
                joinPath(tmpDir, "book.opf"),
              ),
            );
            const input = {
              sha256: hash,
              epubSha256: hash,
              libraryPath: path,
              bookUuid: metadata.bookUuid,
              metadata,
              fileSize: info.size,
              fileMtimeMs: info.mtimeMs,
            };

            if (existing) {
              await store.refreshFromEpub(existing.id, input);
              // The file changed, so its cached cover may belong to the old
              // bytes. Drop both images; startup regenerates the thumbnail and
              // the lightbox regenerates the full cover when next opened.
              const coverDir = joinPath(config.homeDir, "covers");
              await host
                .removeFile(joinPath(coverDir, `${existing.id}.jpg`))
                .catch(() => undefined);
              await host
                .removeFile(joinPath(coverDir, `${existing.id}-full.jpg`))
                .catch(() => undefined);
              report.refreshed++;
            } else {
              // No row for this path. Never steal a row that points at another
              // file, even when the bytes match: that would make two files
              // take turns owning one row on every start.
              try {
                await store.insertReconciled(input);
                report.added++;
              } catch (error) {
                if (/UNIQUE constraint failed/iu.test(String(error))) {
                  report.problems.push(
                    `${basename(path)}: duplicate copy of an existing book; left in place`,
                  );
                } else {
                  throw error;
                }
              }
            }
          } catch (error) {
            report.problems.push(`${basename(path)}: ${errorMessage(error)}`);
          }
        }
      } finally {
        await host.removeDir(tmpDir).catch(() => undefined);
      }
    }
  }

  // Candidate covers: drop directories for rows that no longer exist, then
  // remove images no surviving row references (a cancelled refresh, or a
  // deletion that failed).
  const candidateRoot = joinPath(config.homeDir, "candidates");
  const candidateDir = await host.stat(candidateRoot);
  if (candidateDir?.isDirectory) {
    const books = await store.list();
    const active = new Set(
      books
        .map((book) => book.sha256)
        .filter(Boolean)
        .map((sha256) => sha256.slice(0, 8)),
    );
    const referenced = new Map<string, Set<string>>();
    for (const book of books) {
      for (const cover of book.candidates.covers) {
        const parts = cover.path.split(/[\\/]/u);
        if (parts.length < 3 || parts[0].toLowerCase() !== "candidates") {
          continue;
        }
        const key = parts[1].toLowerCase();
        const name = parts.slice(2).join("/").toLowerCase();
        const keep = referenced.get(key) ?? new Set<string>();
        keep.add(name);
        referenced.set(key, keep);
      }
    }

    let entries: string[] = [];
    try {
      entries = await host.listDir(candidateRoot);
    } catch (error) {
      report.problems.push(
        `cannot list candidate covers: ${errorMessage(error)}`,
      );
    }

    for (const entry of entries) {
      const dirPath = joinPath(candidateRoot, entry);
      if (!active.has(entry)) {
        try {
          await host.removeDir(dirPath);
          report.removedCandidateDirs++;
        } catch (error) {
          report.problems.push(`candidate ${entry}: ${errorMessage(error)}`);
        }
        continue;
      }

      let files: string[] = [];
      try {
        files = await host.listDir(dirPath);
      } catch (error) {
        report.problems.push(`candidate ${entry}: ${errorMessage(error)}`);
        continue;
      }
      const keep = referenced.get(entry) ?? new Set<string>();
      for (const name of files) {
        const path = joinPath(dirPath, name);
        const info = await host.stat(path).catch(() => null);
        if (!info || info.isDirectory) continue;
        if (keep.has(name.toLowerCase())) continue;
        try {
          await host.removeFile(path);
          report.removedCandidateFiles++;
        } catch (error) {
          report.problems.push(
            `candidate ${entry}/${name}: ${errorMessage(error)}`,
          );
        }
      }

      // An active row can legitimately have no candidates left.
      try {
        if ((await host.listDir(dirPath)).length === 0) {
          await host.removeDir(dirPath);
        }
      } catch {
        // Leaving an empty directory is harmless.
      }
    }
  }

  return report;
}

/**
 * Keep the `missing` flag in step with the disk. The current library folder
 * must be readable: if the whole folder is unavailable, every book would look
 * missing and the real problem is already reported by reconcile.
 */
export type MissingFilesReport = {
  /** Books whose library file cannot be found right now. */
  missing: number;
  /** Rows whose flag changed during this pass. */
  changed: number;
};

export async function markMissingFiles(
  host: Host,
  config: Config,
  store: BookStore,
): Promise<MissingFilesReport> {
  if (!config.libraryDir) return { missing: 0, changed: 0 };
  const library = await host.stat(config.libraryDir).catch(() => null);
  if (!library?.isDirectory) return { missing: 0, changed: 0 };

  let missing = 0;
  let changed = 0;
  for (const book of await store.list()) {
    if (!book.libraryPath || book.status === "flagged") continue;
    const info = await host.stat(book.libraryPath).catch(() => null);
    const isMissing = !info || info.isDirectory;
    if (isMissing !== book.missing) {
      await store.setMissing(book.id, isMissing);
      changed++;
    }
    if (isMissing) missing++;
  }
  return { missing, changed };
}

async function regenerateMissingThumbnails(
  host: Host,
  config: Config,
  store: BookStore,
  install: CalibreInstall | null,
): Promise<number> {
  if (!host.makeThumbnail || !install) return 0;
  const books = await store.list();
  const candidates = books.filter((book) => book.libraryPath);
  if (candidates.length === 0) return 0;

  const workDir = joinPath(config.homeDir, "tmp", "thumbs");
  const coverDir = joinPath(config.homeDir, "covers");
  await host.ensureDir(workDir);
  let made = 0;
  try {
    for (const book of candidates) {
      const libraryPath = book.libraryPath;
      if (!libraryPath) continue;
      const thumbnail = joinPath(coverDir, `${book.id}.jpg`);
      const existing = await host.stat(thumbnail);
      if (existing?.size) {
        if (!book.hasCover) {
          await store.setHasCover(book.id, true).catch(() => undefined);
        }
        continue;
      }
      if (existing) await host.removeFile(thumbnail).catch(() => undefined);

      // A missing file cannot produce a cover; leave the cached image alone
      // and do not spend a calibre call on a path that is known to be gone.
      if (book.missing) {
        if (book.hasCover) {
          await store.setHasCover(book.id, false).catch(() => undefined);
        }
        continue;
      }

      const cover = joinPath(workDir, `${book.id}.jpg`);
      try {
        if (!(await extractCover(host, install, libraryPath, cover))) {
          if (book.hasCover) {
            await store.setHasCover(book.id, false).catch(() => undefined);
          }
          continue;
        }
        await host.ensureDir(coverDir);
        await host.makeThumbnail(cover, thumbnail, 400);
        await store.setHasCover(book.id, true).catch(() => undefined);
        made++;
      } catch {
        // One unreadable book must not stop startup.
        if (book.hasCover) {
          await store.setHasCover(book.id, false).catch(() => undefined);
        }
      }
    }
  } finally {
    await host.removeDir(workDir).catch(() => undefined);
  }
  return made;
}

export type StartupReport = ReconcileReport & {
  thumbnails: number;
  /** Books whose interrupted rename was finished from the journal. */
  resumedRenames: number;
  /** Books whose library file cannot be found. */
  missingFiles: number;
};

/** Leave recent files alone; a script may still be writing its own temp file. */
const ORPHAN_TEMP_AGE = 60 * 60_000;

/**
 * Remove `.tmp-*` files a crashed edit or atomic write left in the library
 * folder. A pending rename journal is skipped: its temp files are the data the
 * next resume needs.
 */
async function removeOrphanTemps(
  host: Host,
  config: Config,
  problems: string[],
): Promise<void> {
  if (!config.libraryDir) return;
  if (await host.stat(journalPath(config))) return;

  let names: string[];
  try {
    names = await host.listDir(config.libraryDir);
  } catch {
    return;
  }

  const now = Date.now();
  for (const name of names) {
    if (!name.toLowerCase().startsWith(".tmp-")) continue;
    const path = joinPath(config.libraryDir, name);
    const info = await host.stat(path).catch(() => null);
    if (!info || info.isDirectory) continue;
    if (now - info.mtimeMs < ORPHAN_TEMP_AGE) continue;
    try {
      await host.removeFile(path);
    } catch (error) {
      problems.push(`${name}: ${errorMessage(error)}`);
    }
  }
}

/**
 * The app calls this once per start: finish an interrupted rename, clear the
 * per-ingest temp area, make the rows match the library folder, and fill in
 * missing thumbnails.
 */
export async function startup(
  host: Host,
  config: Config,
  store: BookStore,
  install: CalibreInstall | null,
): Promise<StartupReport> {
  const tmp = joinPath(config.homeDir, "tmp");
  try {
    await host.removeDir(tmp);
    await host.ensureDir(tmp);
  } catch {
    // A locked temp dir must not stop the app from opening.
  }
  const resumed = await resumeRenameJournal(host, config, store);
  const report = await reconcile(host, config, store, install);
  await removeOrphanTemps(host, config, report.problems);
  const missing = await markMissingFiles(host, config, store);
  return {
    ...report,
    problems: [...resumed.problems, ...report.problems],
    resumedRenames: resumed.resumed,
    missingFiles: missing.missing,
    thumbnails: await regenerateMissingThumbnails(host, config, store, install),
  };
}
