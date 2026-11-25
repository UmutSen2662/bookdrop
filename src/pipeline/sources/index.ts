/**
 * The source registry.
 *
 * Registry order is merge priority after the file: calibre's merged Google /
 * Open Library result first, then iTunes, then Open Library. Covers keep that
 * same order, so the first tile in the picker is iTunes.
 *
 * To add a source: write `sources/<name>.ts` and add it to `BOOK_SOURCES`.
 * The merge, candidate list, cover download, and UI labels need no changes.
 */
import type { CalibreInstall } from "@/pipeline/calibre";
import { errorMessage } from "@/pipeline/errors";
import type { Host } from "@/pipeline/host";
import { joinPath } from "@/pipeline/paths";
import { calibreSource } from "@/pipeline/sources/calibre";
import { itunesSource } from "@/pipeline/sources/itunes";
import { sourceLabel } from "@/pipeline/sources/labels";
import { openLibrarySource } from "@/pipeline/sources/openlibrary";
import type {
  BookSource,
  SourceQuery,
  SourceResult,
} from "@/pipeline/sources/types";

export const BOOK_SOURCES: readonly BookSource[] = [
  calibreSource,
  itunesSource,
  openLibrarySource,
];

export type SourceRun = {
  source: BookSource;
  result: SourceResult;
};

export type SourcesRun = {
  runs: SourceRun[];
  notes: string[];
};

/** Which sources can contribute to the kinds the user has enabled. */
export function selectSources(enabled: {
  metadata: boolean;
  covers: boolean;
}): BookSource[] {
  return BOOK_SOURCES.filter((source) =>
    source.kinds.some((kind) =>
      kind === "metadata" ? enabled.metadata : enabled.covers,
    ),
  );
}

/**
 * Ask the selected sources concurrently. One source failing is a note on the
 * book, never a failed ingest or refresh.
 */
export async function runSources(
  sources: readonly BookSource[],
  query: SourceQuery,
  runner: {
    host: Host;
    install: CalibreInstall | null;
    /** Parent scratch directory; each source gets its own subdirectory. */
    baseDir: string;
  },
): Promise<SourcesRun> {
  const settled = await Promise.allSettled(
    sources.map(async (source) => {
      const workDir = joinPath(runner.baseDir, source.id);
      await runner.host.ensureDir(workDir);
      return source.lookup(query, {
        host: runner.host,
        install: runner.install,
        workDir,
      });
    }),
  );

  const runs: SourceRun[] = [];
  const notes: string[] = [];
  settled.forEach((outcome, index) => {
    const source = sources[index];
    if (outcome.status === "rejected") {
      notes.push(
        `${sourceLabel(source.id)} lookup failed: ${errorMessage(outcome.reason)}`,
      );
      return;
    }
    if (!outcome.value) return;
    runs.push({ source, result: outcome.value });
    for (const note of outcome.value.notes ?? []) notes.push(note);
  });

  return { runs, notes };
}
