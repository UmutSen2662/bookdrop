/**
 * Read a book's own metadata, ask the source registry, and build the merged
 * result plus the candidate list. Shared by ingest and the per-book refresh so
 * both make the same decisions.
 */
import { type CalibreInstall, readMetadataOpf } from "@/pipeline/calibre";
import type { Host } from "@/pipeline/host";
import {
  buildCandidates,
  type MergeOutcome,
  mergeMetadata,
  type OpfMetadata,
  type ProviderValues,
  parseOpf,
  stripFilenameJunk,
} from "@/pipeline/metadata";
import { joinPath } from "@/pipeline/paths";
import { runSources, type SourceRun, selectSources } from "@/pipeline/sources";
import type { CoverLink } from "@/pipeline/sources/types";
import type { Candidates } from "@/pipeline/types";

export type BookLookup = {
  file: OpfMetadata;
  coverLinks: CoverLink[];
  merged: MergeOutcome;
  candidates: Candidates;
  notes: string[];
  /** A metadata source returned something usable. */
  found: boolean;
};

export type LookupOptions = {
  fetchMetadata: boolean;
  fetchCovers: boolean;
  /** Holds the temporary OPF and the per-source JSON. Created if missing. */
  workDir: string;
  /** Used only to tell a filename-derived title apart from a real one. */
  sourcePath: string;
};

/** Same URL from two sources is downloaded once. */
function uniqueCovers(runs: readonly SourceRun[]): CoverLink[] {
  const seen = new Set<string>();
  const covers: CoverLink[] = [];
  for (const run of runs) {
    for (const link of run.result.covers ?? []) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      covers.push(link);
    }
  }
  return covers;
}

export async function lookupBookMetadata(
  host: Host,
  install: CalibreInstall,
  epubPath: string,
  options: LookupOptions,
): Promise<BookLookup> {
  await host.ensureDir(options.workDir);
  const file = parseOpf(
    await readMetadataOpf(
      host,
      install,
      epubPath,
      joinPath(options.workDir, "own.opf"),
    ),
  );

  const notes: string[] = [];
  const canQuery = Boolean(file.title.trim() && file.authors.trim());
  let runs: SourceRun[] = [];

  if (canQuery) {
    const looked = await runSources(
      selectSources({
        metadata: options.fetchMetadata,
        covers: options.fetchCovers,
      }),
      {
        isbn: file.isbn,
        title: stripFilenameJunk(file.title),
        authors: stripFilenameJunk(file.authors),
      },
      {
        host,
        install,
        baseDir: joinPath(options.workDir, "lookup"),
      },
    );
    runs = looked.runs;
    notes.push(...looked.notes);
  }

  // With metadata fetching off, a cover-only run must not leak values into the
  // merge or the candidate list.
  const providers: ProviderValues[] = options.fetchMetadata
    ? runs.map((run) => ({
        source: run.source.id,
        values: run.result.metadata ?? {},
        match: run.result.match,
      }))
    : [];

  const merged = mergeMetadata(file, providers, options.sourcePath);
  const candidates = buildCandidates(file, providers);
  // "Found" means a metadata value was usable. Cover-only runs are counted by
  // the caller, which knows whether a downloaded image actually validated.
  const found = providers.some(
    (provider) =>
      provider.match || Object.values(provider.values).some(Boolean),
  );
  return {
    file,
    coverLinks: uniqueCovers(runs),
    merged,
    candidates,
    notes,
    found,
  };
}
