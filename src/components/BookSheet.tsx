import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { RefreshCw, Upload, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { textToParagraphHtml } from "../lib/description";
import { sourceLabel } from "../lib/format";
import { parseTags, serializeTags } from "../lib/tags";
import { errorMessage } from "../pipeline/errors";
import type { Host } from "../pipeline/host";
import type { CoverSize, RefreshMetadataResult } from "../pipeline/library";
import { extname, joinPath } from "../pipeline/paths";
import {
  type Book,
  CANDIDATE_FIELDS,
  type CandidateField,
  type Candidates,
  type FieldCandidate,
  type Metadata,
} from "../pipeline/types";
import { BookCover } from "./BookCover";
import { CoverCrop } from "./CoverCrop";
import { FieldPicker } from "./FieldPicker";
import { TagEditor } from "./TagEditor";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

type CoverChoice =
  | { kind: "current" }
  | { kind: "candidate"; path: string }
  | { kind: "upload" };

type CoverUpload = { blob: Blob; url: string };

type Props = {
  book: Book;
  homeDir: string;
  host: Host;
  /** Tags already used in the library, for the chip editor. */
  tagSuggestions: string[];
  /** Series names already used in the library, for autocomplete. */
  seriesSuggestions: string[];
  onClose: () => void;
  /** Read the file and ask the providers; never writes to the EPUB. */
  onRefresh: () => Promise<RefreshMetadataResult>;
  /** Measure the file's cover; display-only, may return null. */
  onCoverSize: (book: Book) => Promise<CoverSize | null>;
  onSave: (
    metadata: Metadata,
    coverPath: string | undefined,
    candidates: Candidates,
  ) => Promise<void>;
};

const FIELD_LABELS: Record<CandidateField, string> = {
  title: "Title",
  authors: "Authors",
  isbn: "ISBN",
  description: "Description",
  publisher: "Publisher",
  published: "Published",
  language: "Language",
  tags: "Tags",
  series: "Series",
  seriesIndex: "Book #",
};

const SHORT_FIELDS: CandidateField[] = [
  "isbn",
  "publisher",
  "published",
  "language",
];

function fieldsFromBook(book: Book): Record<CandidateField, string> {
  const fields = {} as Record<CandidateField, string>;
  for (const field of CANDIDATE_FIELDS) fields[field] = book[field] ?? "";
  return fields;
}

/** Add refreshed candidates without disturbing the ones already on screen. */
function mergeCandidates(
  current: Candidates,
  incoming: Candidates,
): Candidates {
  const fields = { ...current.fields };
  for (const field of CANDIDATE_FIELDS) {
    const seen = new Set(
      fields[field].map(
        (candidate) => `${candidate.source}:${candidate.value}`,
      ),
    );
    fields[field] = [
      ...fields[field],
      ...incoming.fields[field].filter(
        (candidate) => !seen.has(`${candidate.source}:${candidate.value}`),
      ),
    ];
  }

  // A refresh replaces that source's option with the new image.
  const covers = [...current.covers];
  for (const cover of incoming.covers) {
    const index = covers.findIndex((entry) => entry.source === cover.source);
    if (index >= 0) covers[index] = cover;
    else covers.push(cover);
  }

  return { fields, covers };
}

function imageMime(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    default:
      return "image/jpeg";
  }
}

function coverSizeLabel(size: CoverSize): string {
  return `${size.width}×${size.height}`;
}

function isRealDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Calibre only rejects a bad date deep in the write. Accept the shapes the
 * field can hold: a year, a year-month, a date, or an ISO timestamp.
 */
function isPublishedDate(value: string): boolean {
  const dateOnly = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = dateOnly[2] ? Number(dateOnly[2]) : 1;
    const day = dateOnly[3] ? Number(dateOnly[3]) : 1;
    return year >= 1000 && isRealDate(year, month, day);
  }
  const iso = /^(\d{4}-\d{2}-\d{2})T/u.exec(value);
  return Boolean(
    iso && isPublishedDate(iso[1]) && !Number.isNaN(Date.parse(value)),
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

export function BookSheet({
  book,
  homeDir,
  host,
  tagSuggestions,
  seriesSuggestions,
  onClose,
  onRefresh,
  onCoverSize,
  onSave,
}: Props) {
  const initial = useRef(fieldsFromBook(book));
  const initialCandidates = useRef(book.candidates);
  const [fields, setFields] = useState(initial.current);
  const [candidates, setCandidates] = useState(book.candidates);
  const [cover, setCover] = useState<CoverChoice>({ kind: "current" });
  const [coverSize, setCoverSize] = useState<CoverSize | null>(null);
  // Kept separately so switching to another cover option does not throw the
  // uploaded image away; only Cancel/Save ends its life.
  const [upload, setUpload] = useState<CoverUpload | null>(null);
  const [crop, setCrop] = useState<{ blob: Blob; url: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [customDescription, setCustomDescription] = useState(false);

  const cropUrlRef = useRef<string | null>(null);
  const uploadUrlRef = useRef<string | null>(null);

  const metadataDirty = useMemo(() => {
    if (cover.kind !== "current") return true;
    if (
      JSON.stringify(candidates) !== JSON.stringify(initialCandidates.current)
    ) {
      return true;
    }
    // Tags are a set: ordering and duplicate spelling do not count as edits.
    const sameTags =
      serializeTags(parseTags(fields.tags)) ===
      serializeTags(parseTags(initial.current.tags));
    return CANDIDATE_FIELDS.some((field) =>
      field === "tags" ? !sameTags : fields[field] !== initial.current[field],
    );
  }, [fields, cover, candidates]);

  const discardRef = useRef(confirmDiscard);
  discardRef.current = confirmDiscard;
  const dirtyRef = useRef(metadataDirty);
  dirtyRef.current = metadataDirty;
  const cropRef = useRef(crop);
  cropRef.current = crop;
  const savingRef = useRef(saving);
  savingRef.current = saving;

  function requestClose() {
    if (savingRef.current) return;
    if (dirtyRef.current) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  }

  useEffect(() => {
    return () => {
      if (cropUrlRef.current) URL.revokeObjectURL(cropUrlRef.current);
      if (uploadUrlRef.current) URL.revokeObjectURL(uploadUrlRef.current);
    };
  }, []);

  // Measuring the file's cover needs calibre; do it once when the sheet opens.
  const bookRef = useRef(book);
  bookRef.current = book;
  useEffect(() => {
    let cancelled = false;
    setCoverSize(null);
    // Nothing to measure when the file is gone; this would only fail slowly.
    if (book.missing) return;
    void onCoverSize(bookRef.current)
      .then((size) => {
        if (!cancelled) setCoverSize(size);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [book.missing, onCoverSize]);

  function setField(field: CandidateField, value: string) {
    setFields((current) => ({ ...current, [field]: value }));
  }

  function removeCandidate(field: CandidateField, candidate: FieldCandidate) {
    setCandidates((current) => ({
      ...current,
      fields: {
        ...current.fields,
        [field]: current.fields[field].filter(
          (entry) =>
            !(
              entry.source === candidate.source &&
              entry.value === candidate.value
            ),
        ),
      },
    }));
    // Deleting the picked alternative falls back to the file's value. The
    // picker then resolves its mode from the remaining options.
    if (fields[field] === candidate.value) {
      setField(field, book[field] ?? "");
    }
  }

  function removeCoverCandidate(path: string) {
    setCandidates((current) => ({
      ...current,
      covers: current.covers.filter((candidate) => candidate.path !== path),
    }));
    if (cover.kind === "candidate" && cover.path === path) {
      setCover({ kind: "current" });
    }
  }

  function removeUpload() {
    if (uploadUrlRef.current) {
      URL.revokeObjectURL(uploadUrlRef.current);
      uploadUrlRef.current = null;
    }
    setUpload(null);
    if (cover.kind === "upload") setCover({ kind: "current" });
  }

  async function pickUpload() {
    setError(null);
    const selected = await open({
      multiple: false,
      filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }],
    });
    if (typeof selected !== "string") return;

    try {
      const info = await host.stat(selected);
      if (!info || info.isDirectory) {
        setError("That file could not be read.");
        return;
      }
      if (info.size > 25 * 1024 * 1024) {
        setError("Choose an image smaller than 25 MB.");
        return;
      }
      const bytes = await host.readFile(selected);
      const blob = new Blob([toArrayBuffer(bytes)], {
        type: imageMime(selected),
      });
      const url = URL.createObjectURL(blob);
      if (cropUrlRef.current) URL.revokeObjectURL(cropUrlRef.current);
      cropUrlRef.current = url;
      setCrop({ blob, url });
    } catch (uploadError) {
      setError(errorMessage(uploadError));
    }
  }

  async function refresh() {
    if (refreshing || saving) return;
    setRefreshing(true);
    setError(null);
    setRefreshNote(null);
    try {
      const result = await onRefresh();
      setCandidates((current) => mergeCandidates(current, result.candidates));

      const filled = CANDIDATE_FIELDS.filter(
        (field) =>
          field !== "seriesIndex" &&
          !fields[field].trim() &&
          (result.metadata[field] ?? "").trim().length > 0,
      ).length;

      setFields((current) => {
        const next = { ...current };
        for (const field of CANDIDATE_FIELDS) {
          const value = result.metadata[field] ?? "";
          if (!current[field].trim() && value) next[field] = value;
        }
        if (!next.series.trim()) {
          next.seriesIndex = "";
        } else if (!current.seriesIndex.trim() && result.metadata.seriesIndex) {
          next.seriesIndex = result.metadata.seriesIndex;
        }
        return next;
      });

      const newCovers = result.candidates.covers.length;
      const parts: string[] = [];
      if (!result.found && newCovers === 0) parts.push("No online match.");
      if (filled > 0) {
        parts.push(`Filled ${filled} empty field${filled === 1 ? "" : "s"}.`);
      }
      if (newCovers > 0) {
        parts.push(`Fetched ${newCovers} cover${newCovers === 1 ? "" : "s"}.`);
      }
      if (parts.length === 0) {
        parts.push("New alternatives are available below.");
      }
      if (filled > 0 || newCovers > 0) parts.push("Review and save.");
      setRefreshNote([...parts, ...result.notes].join(" "));
    } catch (refreshError) {
      setError(errorMessage(refreshError));
    } finally {
      setRefreshing(false);
    }
  }

  async function save() {
    if (saving) return;
    if (!metadataDirty) return;

    if (book.missing) {
      setError(
        "The library file is missing. Restore it and use Recheck before changing metadata or the cover.",
      );
      return;
    }

    const title = fields.title.trim();
    const authors = fields.authors.trim();
    if (!title || !authors) {
      setError("Title and author are required.");
      return;
    }

    const series = fields.series.trim();
    const seriesIndex = fields.seriesIndex.trim();
    if (seriesIndex && !series) {
      setError("A book number needs a series name.");
      return;
    }
    if (
      series &&
      !seriesIndex &&
      book.seriesIndex &&
      series.toLocaleLowerCase("en-US") ===
        (book.series ?? "").trim().toLocaleLowerCase("en-US")
    ) {
      setError(
        "The book number cannot be cleared while the series stays. Clear the series too, or keep a number.",
      );
      return;
    }
    if (seriesIndex) {
      const value = Number(seriesIndex);
      if (
        !/^\d+(?:\.\d+)?$/u.test(seriesIndex) ||
        !Number.isFinite(value) ||
        value <= 0
      ) {
        setError("The book number must be a positive number such as 1 or 1.5.");
        return;
      }
    }

    if (!fields.language.trim() && book.language) {
      setError(
        "The language cannot be cleared here. Choose a value, or keep the current one.",
      );
      return;
    }

    const published = fields.published.trim();
    if (!published && book.published) {
      setError(
        "The published date cannot be cleared here. Choose a date, or keep the current one.",
      );
      return;
    }
    if (published && !isPublishedDate(published)) {
      setError(
        "The published date must look like 2020, 2020-05, or 2020-05-17.",
      );
      return;
    }

    setSaving(true);
    setError(null);
    let uploadedPath: string | undefined;
    try {
      const metadata: Metadata = {
        title,
        authors,
        isbn: fields.isbn.trim() || undefined,
        description: customDescription
          ? textToParagraphHtml(fields.description) || undefined
          : fields.description.trim() || undefined,
        publisher: fields.publisher.trim() || undefined,
        published: published || undefined,
        language: fields.language.trim() || undefined,
        tags: fields.tags.trim()
          ? serializeTags(parseTags(fields.tags))
          : undefined,
        series: series || undefined,
        seriesIndex: series ? seriesIndex || undefined : undefined,
      };

      let coverPath: string | undefined;
      if (cover.kind === "candidate") {
        coverPath = joinPath(homeDir, cover.path);
      } else if (cover.kind === "upload") {
        if (!upload) {
          throw new Error(
            "The uploaded cover is missing. Choose the image again.",
          );
        }
        await host.ensureDir(joinPath(homeDir, "tmp"));
        uploadedPath = joinPath(homeDir, "tmp", `upload-${Date.now()}.jpg`);
        await host.writeFileAtomic(
          uploadedPath,
          new Uint8Array(await upload.blob.arrayBuffer()),
        );
        coverPath = uploadedPath;
      }

      await onSave(metadata, coverPath, candidates);
      if (uploadedPath) {
        await host.removeFile(uploadedPath).catch(() => undefined);
      }
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  const coverCandidates = candidates.covers;
  const currentTags = serializeTags(parseTags(fields.tags));
  const tagAlternatives = candidates.fields.tags.filter(
    (candidate) => serializeTags(parseTags(candidate.value)) !== currentTags,
  );
  const seriesAlternatives = candidates.fields.series
    .filter(
      (candidate) =>
        candidate.value.trim() &&
        candidate.value.trim() !== fields.series.trim(),
    )
    .slice(0, 2);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (open || cropRef.current || discardRef.current) return;
        requestClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[92vh] w-[calc(100%-2rem)] max-w-[900px] flex-col overflow-hidden p-0 sm:max-w-[900px]"
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <DialogTitle className="text-base font-semibold">
              Edit book
            </DialogTitle>
            <p className="text-xs text-muted-foreground">
              {book.title || "Untitled"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refresh()}
              disabled={saving || refreshing || book.missing}
              title={
                book.missing ? "Restore the library file first" : undefined
              }
            >
              <RefreshCw
                className={cn(refreshing && "animate-spin")}
                aria-hidden
              />
              {refreshing ? "Fetching…" : "Refresh online"}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close"
              onClick={requestClose}
              disabled={saving}
            >
              <X aria-hidden />
            </Button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-6 overflow-y-auto p-5 md:grid-cols-[220px_1fr]">
          <div className="self-start">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Cover
            </h3>
            <div className="mt-2 flex flex-col gap-2">
              <CoverOption
                label="In the file"
                size={coverSize ? coverSizeLabel(coverSize) : undefined}
                selected={cover.kind === "current"}
                onSelect={() => setCover({ kind: "current" })}
              >
                <BookCover
                  bookId={book.id}
                  title={book.title}
                  homeDir={homeDir}
                  updatedAt={book.updatedAt}
                />
              </CoverOption>

              {coverCandidates.map((candidate) => (
                <CoverOption
                  key={candidate.path}
                  label={sourceLabel(candidate.source)}
                  size={`${candidate.width}×${candidate.height}`}
                  selected={
                    cover.kind === "candidate" && cover.path === candidate.path
                  }
                  onSelect={() =>
                    setCover({ kind: "candidate", path: candidate.path })
                  }
                  onRemove={() => removeCoverCandidate(candidate.path)}
                >
                  <CoverImage
                    src={convertFileSrc(joinPath(homeDir, candidate.path))}
                  />
                </CoverOption>
              ))}

              {upload && (
                <CoverOption
                  label="Your upload"
                  size="1200×1800"
                  selected={cover.kind === "upload"}
                  onSelect={() => setCover({ kind: "upload" })}
                  onRemove={removeUpload}
                >
                  <CoverImage src={upload.url} />
                </CoverOption>
              )}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={() => void pickUpload()}
              disabled={saving}
            >
              <Upload aria-hidden />
              Upload…
            </Button>
            <p className="mt-2 text-[11px] text-muted-foreground">
              JPEG, PNG, or WebP. The crop is exported at 1200×1800.
            </p>
          </div>

          <div className="space-y-4">
            {book.missing && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                The library file is missing. Restore it and use Recheck in the
                book panel before saving metadata or cover changes. Reading
                status and notes are edited in the panel.
              </p>
            )}
            {refreshNote && (
              <p className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                {refreshNote}
              </p>
            )}
            <FieldPicker
              field="title"
              label={FIELD_LABELS.title}
              current={book.title}
              candidates={candidates.fields.title}
              value={fields.title}
              onChange={(value) => setField("title", value)}
              onDelete={(candidate) => removeCandidate("title", candidate)}
            />
            <FieldPicker
              field="authors"
              label={FIELD_LABELS.authors}
              current={book.authors}
              candidates={candidates.fields.authors}
              value={fields.authors}
              onChange={(value) => setField("authors", value)}
              onDelete={(candidate) => removeCandidate("authors", candidate)}
            />

            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <div>
                <label
                  htmlFor="book-series"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {FIELD_LABELS.series}
                </label>
                <Input
                  id="book-series"
                  list="book-series-options"
                  value={fields.series}
                  onChange={(event) => setField("series", event.target.value)}
                  placeholder="No series"
                  autoComplete="off"
                  spellCheck={false}
                  className="mt-1.5"
                />
                <datalist id="book-series-options">
                  {seriesSuggestions.map((series) => (
                    <option key={series} value={series} />
                  ))}
                </datalist>
                {seriesAlternatives.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
                    {seriesAlternatives.map((candidate) => (
                      <button
                        key={`${candidate.source}:${candidate.value}`}
                        type="button"
                        onClick={() => setField("series", candidate.value)}
                        className="max-w-full truncate text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      >
                        Use “{candidate.value}” from{" "}
                        {candidate.source === "file"
                          ? "the file"
                          : sourceLabel(candidate.source)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label
                  htmlFor="book-series-index"
                  className="text-xs font-medium text-muted-foreground"
                >
                  {FIELD_LABELS.seriesIndex}
                </label>
                <Input
                  id="book-series-index"
                  inputMode="decimal"
                  value={fields.seriesIndex}
                  onChange={(event) =>
                    setField("seriesIndex", event.target.value)
                  }
                  placeholder="1"
                  autoComplete="off"
                  className="mt-1.5"
                />
              </div>
            </div>

            <FieldPicker
              field="description"
              label={FIELD_LABELS.description}
              current={book.description ?? ""}
              candidates={candidates.fields.description}
              value={fields.description}
              onChange={(value) => setField("description", value)}
              onModeChange={setCustomDescription}
              onDelete={(candidate) =>
                removeCandidate("description", candidate)
              }
              multiline
              html
            />

            <div>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {FIELD_LABELS.tags}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Enter or comma adds a tag
                </span>
              </div>
              <div className="mt-1.5">
                <TagEditor
                  value={fields.tags}
                  suggestions={tagSuggestions}
                  onChange={(value) => setField("tags", value)}
                  disabled={saving}
                />
              </div>

              {tagAlternatives.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-muted-foreground">
                    Other sources
                  </span>
                  {tagAlternatives.map((candidate) => {
                    const count = parseTags(candidate.value).length;
                    return (
                      <span
                        key={`${candidate.source}:${candidate.value}`}
                        className="inline-flex items-center gap-1 rounded-lg border bg-muted/30 py-0.5 pl-2 pr-1 text-[11px]"
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setField(
                              "tags",
                              serializeTags(parseTags(candidate.value)),
                            )
                          }
                          className="hover:underline"
                        >
                          Use {count} from{" "}
                          {candidate.source === "file"
                            ? "the file"
                            : sourceLabel(candidate.source)}
                        </button>
                        <button
                          type="button"
                          aria-label="Remove this tag alternative"
                          title="Remove this alternative"
                          onClick={() => removeCandidate("tags", candidate)}
                          className="rounded p-0.5 text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                        >
                          <X className="size-3" aria-hidden />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {SHORT_FIELDS.map((field) => (
                <FieldPicker
                  key={field}
                  field={field}
                  label={FIELD_LABELS[field]}
                  current={book[field] ?? ""}
                  candidates={candidates.fields[field]}
                  value={fields[field]}
                  onChange={(value) => setField(field, value)}
                  onDelete={(candidate) => removeCandidate(field, candidate)}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="border-t px-5 py-3">
          {error && (
            <p className="mb-3 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {metadataDirty ? "Unsaved changes" : "No changes"}
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={requestClose} disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={() => void save()}
                disabled={saving || refreshing || !metadataDirty}
              >
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>

      {crop && (
        <CoverCrop
          imageUrl={crop.url}
          onCancel={() => {
            if (cropUrlRef.current) URL.revokeObjectURL(cropUrlRef.current);
            cropUrlRef.current = null;
            setCrop(null);
          }}
          onApply={(blob) => {
            if (cropUrlRef.current) URL.revokeObjectURL(cropUrlRef.current);
            cropUrlRef.current = null;
            const url = URL.createObjectURL(blob);
            if (uploadUrlRef.current) URL.revokeObjectURL(uploadUrlRef.current);
            uploadUrlRef.current = url;
            setUpload({ blob, url });
            setCover({ kind: "upload" });
            setCrop(null);
          }}
        />
      )}

      {confirmDiscard && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirmDiscard(false);
          }}
        >
          <DialogContent showCloseButton={false}>
            <DialogTitle className="text-base font-semibold">
              Discard changes?
            </DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              The fields and cover you changed will be lost.
            </DialogDescription>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
                Keep editing
              </Button>
              <Button variant="destructive" onClick={onClose}>
                Discard
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </Dialog>
  );
}

function CoverOption({
  label,
  size,
  selected,
  onSelect,
  onRemove,
  children,
}: {
  label: string;
  size?: string;
  selected: boolean;
  onSelect: () => void;
  onRemove?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className="block w-full text-left"
      >
        <span
          className={cn(
            "relative block aspect-[2/3] overflow-hidden rounded-lg border bg-muted",
            selected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
          )}
        >
          {children}
          {size && (
            <span className="pointer-events-none absolute bottom-1 left-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-medium leading-none text-white tabular-nums">
              {size}
            </span>
          )}
        </span>
        <span className="mt-1 block truncate text-[11px] text-muted-foreground">
          {label}
        </span>
      </button>

      {onRemove && (
        <button
          type="button"
          aria-label={`Remove ${label} cover`}
          title="Remove"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onRemove();
          }}
          className="absolute right-1 top-1 rounded-full bg-background/85 p-1 text-foreground/80 shadow-sm backdrop-blur transition hover:bg-background hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}

function CoverImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="flex h-full w-full items-center justify-center bg-muted text-[10px] text-muted-foreground">
        Missing
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover"
    />
  );
}
