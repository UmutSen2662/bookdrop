/**
 * The ingest pipeline: identify, gate, convert, clean, attach metadata, file.
 *
 * One file at a time, sequentially. Nothing here moves or deletes the source.
 * Every failure becomes a recorded row; nothing is dropped silently.
 */
import { DOMParser } from "@xmldom/xmldom";
import { unzipSync } from "fflate";
import {
  type CalibreInstall,
  CONVERT_TIMEOUT,
  calibrePath,
  convertToEpub,
  extractCover,
  failureText,
  findCalibre,
  readMetadataOpf,
  writeMetadata,
} from "@/pipeline/calibre";
import { cleanEpub } from "@/pipeline/clean";
import type { Config } from "@/pipeline/config";
import {
  type DownloadedCover,
  downloadCover,
  storeCoverCandidates,
} from "@/pipeline/covers";
import type { BookStore } from "@/pipeline/db";
import { errorMessage } from "@/pipeline/errors";
import type { Host } from "@/pipeline/host";
import { type BookLookup, lookupBookMetadata } from "@/pipeline/lookup";
import {
  mergeMetadata,
  parseOpf,
  stripFilenameJunk,
} from "@/pipeline/metadata";
import { formatLibraryFileName, withCollisionSuffix } from "@/pipeline/names";
import { basename, extname, joinPath, stripExtension } from "@/pipeline/paths";
import {
  type Book,
  type Candidates,
  emptyCandidates,
  type FlagReason,
  type IngestOutcome,
  type Metadata,
} from "@/pipeline/types";

const DRM_EXTENSIONS = new Set([".acsm", ".kfx"]);
const LOCKED_EXTENSIONS = new Set([".azw", ".azw3", ".mobi"]);
const FONT_URI = /\.(?:otf|ttf|woff2?)(?:[?#].*)?$/iu;
const MIN_TEXT_CHARACTERS = 200;

function joinNotes(...notes: Array<string | undefined>): string | undefined {
  const kept = notes.filter((note): note is string => Boolean(note?.trim()));
  return kept.length > 0 ? kept.join("; ") : undefined;
}

type Inspector =
  | { ok: true; bookUuid?: string }
  | { ok: false; reason: FlagReason; error: string };

function flagged(
  base: IngestOutcome,
  reason: FlagReason,
  error: string,
): IngestOutcome {
  return { ...base, status: "flagged", flagReason: reason, error };
}

/** DRM and readability gate for a dropped EPUB. Never modifies the file. */
function inspectEpub(bytes: Uint8Array): Inspector {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return {
      ok: false,
      reason: "unreadable",
      error: "not a readable zip archive",
    };
  }

  const container = entries["META-INF/container.xml"];
  if (!container) {
    return {
      ok: false,
      reason: "unreadable",
      error: "META-INF/container.xml is missing",
    };
  }

  const encryption = entries["META-INF/encryption.xml"];
  if (encryption) {
    const doc = new DOMParser().parseFromString(
      new TextDecoder("utf-8").decode(encryption),
      "application/xml",
    );
    const references = Array.from(
      doc.getElementsByTagNameNS("*", "CipherReference"),
    )
      .map((element) => element.getAttribute("URI") ?? "")
      .filter(Boolean);
    const blocked = references.filter((uri) => !FONT_URI.test(uri));
    if (blocked.length > 0) {
      return {
        ok: false,
        reason: "drm",
        error: `encrypted content: ${blocked.slice(0, 3).join(", ")}`,
      };
    }
  }

  // Best effort: a book without a package identifier is still a book.
  let bookUuid: string | undefined;
  try {
    const containerDoc = new DOMParser().parseFromString(
      new TextDecoder("utf-8").decode(container),
      "application/xml",
    );
    const rootFile = containerDoc.getElementsByTagNameNS("*", "rootfile")[0];
    const opfPath = rootFile?.getAttribute("full-path");
    const opfBytes = opfPath ? entries[opfPath] : undefined;
    if (opfBytes) {
      bookUuid = parseOpf(new TextDecoder("utf-8").decode(opfBytes)).bookUuid;
    }
  } catch {
    // No uuid; the hashes still identify the book.
  }

  return { ok: true, bookUuid };
}

async function probePdfText(
  host: Host,
  install: CalibreInstall,
  pdfPath: string,
  probePath: string,
): Promise<Inspector> {
  const result = await host.runProcess(
    calibrePath(install, "convert"),
    [pdfPath, probePath],
    CONVERT_TIMEOUT,
  );

  if (result.code !== 0) {
    return {
      ok: false,
      reason: "convert_failed",
      error: `text probe failed: ${failureText(result)}`,
    };
  }
  const text = new TextDecoder("utf-8").decode(await host.readFile(probePath));
  const characters = text.replace(/\s/gu, "").length;
  if (characters < MIN_TEXT_CHARACTERS) {
    return {
      ok: false,
      reason: "no_text",
      error: `only ${characters} characters of text; the PDF looks scanned`,
    };
  }
  return { ok: true };
}

/** A free library name, compared without regard to case. */
export async function uniqueLibraryTarget(
  host: Host,
  libraryDir: string,
  fileName: string,
  sha256: string,
): Promise<string> {
  const taken = new Set(
    (await host.listDir(libraryDir)).map((name) => name.toLowerCase()),
  );
  const free = (name: string) => !taken.has(name.toLowerCase());

  if (free(fileName)) return joinPath(libraryDir, fileName);

  for (let attempt = 1; attempt <= 20; attempt++) {
    const candidate = withCollisionSuffix(fileName, sha256, attempt);
    if (free(candidate)) return joinPath(libraryDir, candidate);
  }

  throw new Error(`no free filename for "${fileName}" in ${libraryDir}`);
}

/** Store the row; a database failure must not lose the library file. */
async function record(
  store: BookStore,
  outcome: IngestOutcome,
): Promise<IngestOutcome> {
  try {
    return { ...outcome, book: await store.insert(outcome) };
  } catch (error) {
    return {
      ...outcome,
      notes: joinNotes(
        outcome.notes,
        `database insert failed: ${errorMessage(error)}`,
      ),
    };
  }
}

/**
 * A display concern, not part of ingest correctness. The app writes both the
 * card thumbnail and the full cover used by the lightbox with the Rust `image`
 * crate; the Bun host has no image pipeline and skips this. Missing files are
 * regenerated on the next startup or when the lightbox opens.
 */
async function saveCoverImages(
  host: Host,
  config: Config,
  install: CalibreInstall,
  book: Book | undefined,
  sourcePath: string | undefined,
  workDir: string,
): Promise<boolean> {
  if (!host.makeThumbnail || !book?.libraryPath) return false;
  try {
    let cover = sourcePath;
    if (!cover) {
      const extracted = joinPath(workDir, "thumb-cover.jpg");
      if (!(await extractCover(host, install, book.libraryPath, extracted))) {
        return false;
      }
      cover = extracted;
    }
    const coverDir = joinPath(config.homeDir, "covers");
    await host.ensureDir(coverDir);
    await host.makeThumbnail(cover, joinPath(coverDir, `${book.id}.jpg`), 400);
    await host.makeThumbnail(
      cover,
      joinPath(coverDir, `${book.id}-full.jpg`),
      1600,
    );
    return true;
  } catch {
    // Ignore: the card falls back to a placeholder, and startup retries.
    return false;
  }
}

function duplicateOutcome(base: IngestOutcome, book: Book): IngestOutcome {
  return {
    ...base,
    status: book.status,
    duplicate: true,
    book,
  };
}

/**
 * Stop when the file is already in the library. A flagged row is retried: it
 * is deleted so the second drop can replace it, and the ingest continues.
 * Returns an outcome only when the caller must stop.
 */
async function stopIfDuplicate(
  store: BookStore,
  base: IngestOutcome,
  sha256: string,
  bookUuid?: string | null,
): Promise<IngestOutcome | null> {
  if (!sha256 && !bookUuid) return null;
  const existing = await store.findDuplicate(sha256, bookUuid);
  if (!existing) return null;
  if (existing.status !== "flagged") return duplicateOutcome(base, existing);
  await store.remove(existing.id);
  return null;
}

export type IngestOptions = {
  install?: CalibreInstall;
  /** The only writer of rows. The caller owns opening and closing it. */
  store: BookStore;
};

export async function ingestFile(
  host: Host,
  config: Config,
  sourcePath: string,
  options: IngestOptions,
): Promise<IngestOutcome> {
  const { store } = options;
  if (!config.libraryDir) {
    // A precondition, not a per-file outcome: the app opens Settings instead.
    throw new Error("no library folder is configured");
  }

  const base: IngestOutcome = { sourcePath, sha256: "", status: "flagged" };

  const info = await host.stat(sourcePath);
  if (!info || info.isDirectory) {
    return record(
      store,
      flagged(base, "unreadable", `${sourcePath} is not a readable file`),
    );
  }
  if (info.size === 0) {
    let sha256 = "";
    try {
      sha256 = await host.hashFile(sourcePath);
    } catch {
      // The row still records what happened.
    }
    const empty = { ...base, sha256 };
    const duplicate = await stopIfDuplicate(store, empty, sha256);
    if (duplicate) return duplicate;
    return record(store, flagged(empty, "unreadable", "the file is empty"));
  }

  let sha256: string;
  try {
    sha256 = await host.hashFile(sourcePath);
  } catch (error) {
    return record(
      store,
      flagged(
        base,
        "unreadable",
        `cannot read the file: ${errorMessage(error)}`,
      ),
    );
  }
  base.sha256 = sha256;

  const extension = extname(sourcePath).toLowerCase();
  if (DRM_EXTENSIONS.has(extension)) {
    const duplicate = await stopIfDuplicate(store, base, sha256);
    if (duplicate) return duplicate;
    return record(
      store,
      flagged(
        base,
        "drm",
        extension === ".acsm"
          ? "this is a download token, not a book; fetch the EPUB in Adobe Digital Editions first"
          : "calibre cannot read KFX without a plugin",
      ),
    );
  }

  // Read the EPUB's UUID before dedupe, but never let a corrupt EPUB skip the
  // duplicate check: a flagged drop must be replaceable by dropping it again.
  let bookUuid: string | undefined;
  let inspectionFailure: { reason: FlagReason; error: string } | undefined;
  if (extension === ".epub") {
    let bytes: Uint8Array;
    try {
      bytes = await host.readFile(sourcePath);
    } catch (error) {
      return record(
        store,
        flagged(
          base,
          "unreadable",
          `cannot read the EPUB: ${errorMessage(error)}`,
        ),
      );
    }
    const inspection = inspectEpub(bytes);
    if (inspection.ok) {
      bookUuid = inspection.bookUuid;
      base.bookUuid = bookUuid;
    } else {
      inspectionFailure = inspection;
    }
  }

  const duplicate = await stopIfDuplicate(store, base, sha256, bookUuid);
  if (duplicate) return duplicate;
  if (inspectionFailure) {
    return record(
      store,
      flagged(base, inspectionFailure.reason, inspectionFailure.error),
    );
  }

  let install: CalibreInstall;
  try {
    install = options.install ?? (await findCalibre(host, config.calibreDir));
  } catch (error) {
    return record(store, flagged(base, "convert_failed", errorMessage(error)));
  }

  const tmpDir = joinPath(
    config.homeDir,
    "tmp",
    `${Date.now()}-${sha256.slice(0, 8)}`,
  );
  const convertedPath = joinPath(tmpDir, "book.epub");

  try {
    await host.ensureDir(tmpDir);

    if (extension === ".pdf") {
      const probe = await probePdfText(
        host,
        install,
        sourcePath,
        joinPath(tmpDir, "probe.txt"),
      );
      if (!probe.ok) {
        return record(store, flagged(base, probe.reason, probe.error));
      }
    }

    const isConversion = extension !== ".epub";
    const notes: string[] = [];
    let cleanWarning: string | undefined;
    let epubPath: string;
    if (!isConversion) {
      // Work on a copy: the source file is never written to. ebook-meta edits
      // in place, and a crash there would damage the only copy the user has.
      epubPath = joinPath(tmpDir, "book.epub");
      await host.copyFile(sourcePath, epubPath);
    } else {
      const conversion = await convertToEpub(
        host,
        install,
        sourcePath,
        convertedPath,
        extension === ".pdf",
      );
      if (conversion.timedOut) {
        return record(
          store,
          flagged(
            base,
            "convert_failed",
            `conversion timed out after ${Math.round(CONVERT_TIMEOUT / 60_000)} minutes`,
          ),
        );
      }
      if (conversion.code !== 0) {
        const detail = failureText(conversion);
        const locked =
          LOCKED_EXTENSIONS.has(extension) && /drm|locked/iu.test(detail);
        return record(
          store,
          flagged(base, locked ? "drm" : "convert_failed", detail),
        );
      }
      epubPath = convertedPath;

      // Only EPUBs this pipeline produced are ever rewritten.
      if (config.cleanConverted) {
        const cleaned = cleanEpub(await host.readFile(epubPath));
        if (cleaned.report.blocked) {
          cleanWarning =
            "not cleaned: the table of contents would break; filed as converted";
        } else if (cleaned.report.error) {
          cleanWarning = `not cleaned: ${cleaned.report.error}; filed as converted`;
        } else if (cleaned.output) {
          await host.writeFileAtomic(epubPath, cleaned.output);
        }
      }
    }

    // --- metadata -------------------------------------------------------
    let metadataError: string | undefined;
    let lookup: BookLookup | null = null;
    try {
      lookup = await lookupBookMetadata(host, install, epubPath, {
        fetchMetadata: config.fetchMetadata,
        fetchCovers: config.fetchCovers,
        workDir: tmpDir,
        sourcePath,
      });
      for (const note of lookup.notes) notes.push(note);
      if (!base.bookUuid && lookup.file.bookUuid) {
        base.bookUuid = lookup.file.bookUuid;
      }
    } catch (error) {
      metadataError = errorMessage(error);
    }

    const merged =
      lookup?.merged ??
      mergeMetadata({ title: "", authors: "" }, [], sourcePath);
    const fallbackTitle =
      stripFilenameJunk(stripExtension(basename(sourcePath))) || "Untitled";
    const chosen: Metadata = {
      ...merged.metadata,
      title: merged.metadata.title || fallbackTitle,
      authors: merged.metadata.authors,
    };
    const candidates: Candidates = lookup?.candidates ?? emptyCandidates();
    const coverLinks = lookup?.coverLinks ?? [];

    // A dropped EPUB's own cover is the default. A conversion carries calibre's
    // generated placeholder, so it counts as no cover.
    let ownCoverPath: string | undefined;
    if (!isConversion) {
      const extracted = joinPath(tmpDir, "own-cover.jpg");
      try {
        if (await extractCover(host, install, epubPath, extracted)) {
          ownCoverPath = extracted;
        }
      } catch {
        ownCoverPath = undefined;
      }
    }

    let status = merged.status;
    if (merged.notes) notes.push(merged.notes);
    let error = metadataError;

    // Images are fetched for every successful match. A cover that came with
    // the file stays the default; the downloaded ones are alternatives.
    const downloadedCovers: DownloadedCover[] = [];
    let coverPath: string | undefined;
    if (status === "ok" && config.fetchCovers) {
      const coverDir = joinPath(tmpDir, "candidates");
      await host.ensureDir(coverDir);
      for (const link of coverLinks) {
        const cover = await downloadCover(host, link, coverDir);
        if (!cover) continue;
        downloadedCovers.push(cover);
        if (!ownCoverPath) coverPath ??= cover.path;
      }
    }

    // --- write and verify ----------------------------------------------
    const written = await writeMetadata(
      host,
      install,
      epubPath,
      chosen,
      coverPath,
    );
    if (written.code !== 0) {
      // The EPUB still exists with whatever calibre gave it; file it anyway.
      status = "needs_review";
      error = `metadata write failed: ${failureText(written)}`;
    } else {
      try {
        const verified = parseOpf(
          await readMetadataOpf(
            host,
            install,
            epubPath,
            joinPath(tmpDir, "verify.opf"),
          ),
        );
        if (!verified.title || !verified.authors) {
          status = status === "flagged" ? status : "needs_review";
          notes.push("metadata verify: title or author is missing");
        } else {
          // The EPUB is the source of truth. Use calibre's normalized values
          // and derived sorts for the row and the frozen filename.
          chosen.title = verified.title;
          chosen.authors = verified.authors;
          chosen.authorSort = verified.authorSort ?? chosen.authorSort;
          chosen.titleSort = verified.titleSort ?? chosen.titleSort;
          base.bookUuid = base.bookUuid ?? verified.bookUuid;
        }
      } catch (verifyError) {
        notes.push(`metadata verify failed: ${errorMessage(verifyError)}`);
      }
    }

    // A conversion can land on bytes that are already in the library even when
    // the source file was different. Check the file we are about to write.
    const tempHash = await host.hashFile(epubPath);
    const sameEpub = await store.findByEpubHash(tempHash);
    if (sameEpub) {
      if (sameEpub.status !== "flagged") {
        return duplicateOutcome({ ...base, status: sameEpub.status }, sameEpub);
      }
      await store.remove(sameEpub.id);
    }

    // --- file it --------------------------------------------------------
    await host.ensureDir(config.libraryDir);

    const target = await uniqueLibraryTarget(
      host,
      config.libraryDir,
      formatLibraryFileName(config.fileNameTemplate, chosen),
      sha256,
    );
    // writeFileAtomic writes its own `.tmp-*` next to the target and renames,
    // so a sync client never sees a partial EPUB.
    await host.writeFileAtomic(target, await host.readFile(epubPath));
    const epubSha256 = await host.hashFile(target);
    const libraryStat = await host.stat(target);

    let archivedPath: string | undefined;
    if (config.archiveOriginals) {
      try {
        await host.ensureDir(config.originalsDir);
        const archiveTarget = joinPath(
          config.originalsDir,
          `${sha256.slice(0, 8)} - ${basename(sourcePath)}`,
        );
        const existing = await host.stat(archiveTarget);
        if (!existing || existing.size !== info.size) {
          await host.copyFile(sourcePath, archiveTarget);
        }
        archivedPath = archiveTarget;
      } catch (archiveError) {
        // A failed copy is a note, not a failed ingest.
        notes.push(`archive failed: ${errorMessage(archiveError)}`);
      }
    }

    // --- candidates -----------------------------------------------------
    // Keep downloaded covers keyed by the source hash, so removing the book can
    // delete them without consulting the row first.
    if (downloadedCovers.length > 0) {
      try {
        candidates.covers = await storeCoverCandidates(
          host,
          config.homeDir,
          sha256.slice(0, 8),
          downloadedCovers,
        );
      } catch (coverError) {
        notes.push(`cover candidates not saved: ${errorMessage(coverError)}`);
      }
    }

    const saved = await record(store, {
      sourcePath,
      sha256,
      status,
      flagReason: merged.reason,
      error,
      notes: joinNotes(...notes),
      libraryPath: target,
      archivedPath,
      metadata: chosen,
      epubSha256,
      fileSize: libraryStat?.size,
      fileMtimeMs: libraryStat?.mtimeMs,
      bookUuid: base.bookUuid,
      candidates,
      cleanWarning,
    });
    const hasCover = await saveCoverImages(
      host,
      config,
      install,
      saved.book,
      ownCoverPath ?? coverPath,
      tmpDir,
    );
    if (saved.book) {
      await store.setHasCover(saved.book.id, hasCover).catch(() => undefined);
      saved.book.hasCover = hasCover;
    }
    return saved;
  } catch (error_) {
    return record(store, flagged(base, "convert_failed", errorMessage(error_)));
  } finally {
    await host.removeDir(tmpDir).catch(() => undefined);
  }
}
