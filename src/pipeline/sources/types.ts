/**
 * What a metadata/cover source is.
 *
 * One file per provider, one registry entry. A source only has to turn its
 * response into normalised values; merging, candidate ordering, cover
 * validation, and error notes stay in the pipeline.
 */
import type { CalibreInstall } from "@/pipeline/calibre";
import type { Host } from "@/pipeline/host";
import type { Metadata, SourceId } from "@/pipeline/types";

export type SourceKind = "metadata" | "cover";

export type SourceQuery = {
  /** Already stripped of filename junk by the caller. */
  title: string;
  authors: string;
  isbn?: string;
};

export type SourceContext = {
  host: Host;
  /** A private scratch directory for this source, created before `lookup`. */
  workDir: string;
  /** Null when calibre is not installed; only the calibre source needs it. */
  install: CalibreInstall | null;
};

/** A cover this source can offer. It is downloaded and validated later. */
export type CoverLink = {
  source: SourceId;
  url: string;
};

export type SourceResult = {
  /** Values this source offers. The merge gives the file priority over them. */
  metadata?: Partial<Metadata>;
  /**
   * The title/authors the source actually matched, for the needs_review
   * decision. Only a source that found a real book should set this.
   */
  match?: { title?: string; authors?: string };
  /**
   * In display order. Keep it to one per source; the edit sheet replaces a
   * source's image when a refresh returns a new one.
   */
  covers?: CoverLink[];
  /** Non-fatal problems worth keeping in the book's notes. */
  notes?: string[];
};

export type BookSource = {
  /** Stored in candidates. Never rename an id that has already shipped. */
  id: SourceId;
  kinds: readonly SourceKind[];
  /**
   * Null when nothing matched. Throwing is a failure, not a miss.
   * Bound the work yourself: the registry does not impose a timeout, so every
   * request or process needs one.
   */
  lookup(
    query: SourceQuery,
    context: SourceContext,
  ): Promise<SourceResult | null>;
};
