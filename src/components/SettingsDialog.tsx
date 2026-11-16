import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FolderOpen, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes } from "../lib/format";
import { CALIBRE_DOWNLOAD_URL } from "../lib/links";
import { useAppVersion } from "../lib/useAppVersion";
import type { CalibreInstall } from "../pipeline/calibre";
import type { Config } from "../pipeline/config";
import { errorMessage } from "../pipeline/errors";
import type { Host } from "../pipeline/host";
import type { RenamePlan, RenameReport } from "../pipeline/library";
import {
  DEFAULT_FILE_NAME_TEMPLATE,
  FILE_NAME_TOKENS,
  formatLibraryFileName,
  templateProblems,
} from "../pipeline/names";
import {
  basename,
  dirname,
  joinPath,
  normalizedFolder,
} from "../pipeline/paths";
import type { Book } from "../pipeline/types";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";
import { Input } from "./ui/input";
import { Switch } from "./ui/switch";

type Props = {
  config: Config;
  host: Host;
  install: CalibreInstall | null;
  books: Book[];
  onClose: () => void;
  onSave: (patch: Partial<Config>) => Promise<void>;
  onRecheck: () => Promise<void>;
  onPlanRenames: (template: string) => Promise<RenamePlan>;
  onRenameLibrary: (plan: RenamePlan) => Promise<RenameReport>;
};

type FolderStats = {
  files: number;
  bytes: number;
  missing: boolean;
};

function archiveProblem(library: string, archive: string): string | null {
  const lib = normalizedFolder(library);
  const arc = normalizedFolder(archive);
  if (!arc) return "Choose an archive folder.";
  if (arc === lib) return "The archive cannot be the library folder.";
  if (lib && arc.startsWith(`${lib}/`)) {
    return "The archive cannot be inside the library folder.";
  }
  if (lib?.startsWith(`${arc}/`)) {
    return "The archive cannot contain the library folder.";
  }
  return null;
}

async function readFolderStats(host: Host, path: string): Promise<FolderStats> {
  const info = await host.stat(path);
  if (!info?.isDirectory) return { files: 0, bytes: 0, missing: true };

  const names = await host.listDir(path);
  let files = 0;
  let bytes = 0;
  for (const name of names) {
    const entry = await host.stat(joinPath(path, name));
    if (!entry || entry.isDirectory) continue;
    files++;
    bytes += entry.size;
  }
  return { files, bytes, missing: false };
}

function archiveSummary(
  stats: FolderStats | null | undefined,
  enabled: boolean,
): string {
  if (stats === undefined) return "Checking the archive…";
  if (stats === null) return "Could not read the archive folder.";
  if (stats.missing) {
    return enabled
      ? "That folder does not exist yet."
      : "Archive is off; that folder does not exist yet.";
  }
  const summary = `${stats.files.toLocaleString()} file${
    stats.files === 1 ? "" : "s"
  } · ${formatBytes(stats.bytes)}`;
  return enabled ? summary : `Archive is off · existing copies: ${summary}`;
}

export function SettingsDialog({
  config,
  host,
  install,
  books,
  onClose,
  onSave,
  onRecheck,
  onPlanRenames,
  onRenameLibrary,
}: Props) {
  const [libraryDir, setLibraryDir] = useState(config.libraryDir);
  const [archiveOriginals, setArchiveOriginals] = useState(
    config.archiveOriginals,
  );
  const [originalsDir, setOriginalsDir] = useState(config.originalsDir);
  const [fetchMetadata, setFetchMetadata] = useState(config.fetchMetadata);
  const [cleanConverted, setCleanConverted] = useState(config.cleanConverted);
  const [fetchCovers, setFetchCovers] = useState(config.fetchCovers);
  const [calibreDir, setCalibreDir] = useState<string | null>(
    config.calibreDir,
  );
  const [template, setTemplate] = useState(config.fileNameTemplate);
  const [plan, setPlan] = useState<RenamePlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameReport, setRenameReport] = useState<RenameReport | null>(null);
  const [archiveStats, setArchiveStats] = useState<
    FolderStats | null | undefined
  >(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const version = useAppVersion();
  const templateInput = useRef<HTMLInputElement>(null);
  const templateRef = useRef(template);
  templateRef.current = template;

  const libraryChanged = libraryDir !== config.libraryDir;
  const archiveIssue = archiveOriginals
    ? archiveProblem(libraryDir, originalsDir)
    : null;
  const outsideCount = useMemo(() => {
    const target = libraryDir.trim();
    if (!target) return 0;
    return books.filter(
      (book) =>
        book.libraryPath &&
        !book.missing &&
        normalizedFolder(dirname(book.libraryPath)) !==
          normalizedFolder(target),
    ).length;
  }, [books, libraryDir]);
  const effectiveTemplate = template.trim() || DEFAULT_FILE_NAME_TEMPLATE;
  const templateIssues = template.trim() ? templateProblems(template) : [];
  const preview = useMemo(
    () =>
      books
        .filter(
          (book) =>
            book.libraryPath &&
            !book.missing &&
            normalizedFolder(dirname(book.libraryPath)) ===
              normalizedFolder(libraryDir),
        )
        .map((book) => ({
          book,
          path: book.libraryPath ?? "",
          next: formatLibraryFileName(effectiveTemplate, {
            title: book.title,
            authors: book.authors,
            series: book.series,
            seriesIndex: book.seriesIndex,
            published: book.published,
          }),
        }))
        .filter(
          ({ path, next }) =>
            basename(path).toLowerCase() !== next.toLowerCase(),
        ),
    [books, effectiveTemplate, libraryDir],
  );

  useEffect(() => {
    if (!originalsDir) {
      setArchiveStats(undefined);
      return;
    }
    setArchiveStats(undefined);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void readFolderStats(host, originalsDir)
        .then((stats) => {
          if (!cancelled) setArchiveStats(stats);
        })
        .catch(() => {
          if (!cancelled) setArchiveStats(null);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [host, originalsDir]);

  async function pickLibrary() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose the library folder",
    });
    if (typeof selected === "string") setLibraryDir(selected);
  }

  async function pickArchive() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose the archive folder",
    });
    if (typeof selected === "string") setOriginalsDir(selected);
  }

  async function pickCalibre() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Choose the calibre folder",
    });
    if (typeof selected === "string") setCalibreDir(selected);
  }

  async function openDownload() {
    setError(null);
    try {
      await openUrl(CALIBRE_DOWNLOAD_URL);
    } catch (openError) {
      setError(errorMessage(openError));
    }
  }

  async function openLibrary() {
    if (!libraryDir) return;
    setError(null);
    try {
      await invoke("open_path", { path: libraryDir });
    } catch (openError) {
      setError(errorMessage(openError));
    }
  }

  async function openDataFolder() {
    setError(null);
    try {
      await invoke("open_path", { path: config.homeDir });
    } catch (openError) {
      setError(errorMessage(openError));
    }
  }

  function insertToken(token: string) {
    const text = `{${token}}`;
    setPlan(null);
    setRenameReport(null);
    const input = templateInput.current;
    if (!input) {
      setTemplate((current) => current + text);
      return;
    }
    const start = input.selectionStart ?? template.length;
    const end = input.selectionEnd ?? start;
    setTemplate(`${template.slice(0, start)}${text}${template.slice(end)}`);
    requestAnimationFrame(() => {
      input.focus();
      const caret = start + text.length;
      input.setSelectionRange(caret, caret);
    });
  }

  async function startRename() {
    setError(null);
    setRenameReport(null);
    setPlanning(true);
    const requestedTemplate = template;
    const requestedEffective = effectiveTemplate;
    try {
      const next = await onPlanRenames(requestedEffective);
      // The template changed while the plan was being built; its result is
      // for a name the user is no longer looking at.
      if (templateRef.current !== requestedTemplate) return;
      setPlan(next);
    } catch (planError) {
      setError(errorMessage(planError));
    } finally {
      setPlanning(false);
    }
  }

  async function confirmRename() {
    if (!plan) return;
    setRenaming(true);
    setError(null);
    try {
      await onSave({ fileNameTemplate: effectiveTemplate });
      setRenameReport(await onRenameLibrary(plan));
      setPlan(null);
    } catch (renameError) {
      setError(errorMessage(renameError));
    } finally {
      setRenaming(false);
    }
  }

  async function save() {
    if (!libraryDir.trim()) {
      setError("Choose a library folder first.");
      return;
    }
    if (archiveIssue) {
      setError(archiveIssue);
      return;
    }
    if (templateIssues.length > 0) {
      setError(templateIssues.join(" "));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        libraryDir,
        archiveOriginals,
        originalsDir,
        fetchMetadata,
        cleanConverted,
        fetchCovers,
        calibreDir,
        fileNameTemplate: effectiveTemplate,
      });
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        size="lg"
        className="flex max-h-[90vh] flex-col overflow-hidden p-0"
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <DialogTitle className="text-base font-semibold">
            Settings
          </DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close"
            onClick={onClose}
            disabled={saving}
          >
            <X aria-hidden />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <section>
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Library folder
            </h3>
            <div className="mt-2 flex gap-2">
              <Input
                value={libraryDir}
                onChange={(event) => setLibraryDir(event.target.value)}
                placeholder="Choose a folder…"
                aria-label="Library folder"
                spellCheck={false}
              />
              <Button variant="outline" size="sm" onClick={pickLibrary}>
                <FolderOpen aria-hidden />
                Choose…
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!libraryDir}
                onClick={() => void openLibrary()}
              >
                Open
              </Button>
            </div>
            {libraryChanged && (
              <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                New drops go to this folder.{" "}
                {outsideCount > 0 ? (
                  <>
                    {outsideCount} book{outsideCount === 1 ? "" : "s"} already
                    filed elsewhere will be marked{" "}
                    <strong>outside library</strong> until you move them. Move
                    the files into the new folder: Bookdrop re-attaches them by
                    file hash on the next start. Copying instead of moving
                    creates duplicates.
                  </>
                ) : (
                  "Nothing already filed needs to move."
                )}
              </p>
            )}
            {!libraryChanged && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                New drops go here; books already filed stay where they were.
              </p>
            )}
          </section>

          <section className="mt-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                File names
              </h3>
              <Button
                variant="ghost"
                size="sm"
                disabled={template === DEFAULT_FILE_NAME_TEMPLATE}
                onClick={() => {
                  setTemplate(DEFAULT_FILE_NAME_TEMPLATE);
                  setPlan(null);
                  setRenameReport(null);
                }}
              >
                Reset
              </Button>
            </div>
            <Input
              ref={templateInput}
              value={template}
              onChange={(event) => {
                setTemplate(event.target.value);
                // A plan names files for the template it was built from.
                setPlan(null);
                setRenameReport(null);
              }}
              placeholder={DEFAULT_FILE_NAME_TEMPLATE}
              aria-label="Filename template"
              spellCheck={false}
              className="mt-2 font-mono text-xs"
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {FILE_NAME_TOKENS.map((token) => (
                <Button
                  key={token}
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 font-mono text-[11px]"
                  onClick={() => insertToken(token)}
                >
                  {`{${token}}`}
                </Button>
              ))}
            </div>
            {templateIssues.length > 0 ? (
              <p className="mt-2 text-xs text-destructive">
                {templateIssues.join(" ")}
              </p>
            ) : (
              <p className="mt-2 text-xs text-muted-foreground">
                Flat names only. A missing field takes its separators with it,
                and a blank template means the default. New drops use this right
                away.
              </p>
            )}

            {preview.length > 0 && (
              <div className="mt-3 rounded-lg border bg-muted/30 px-3 py-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  Preview
                </p>
                <ul className="mt-1 space-y-0.5">
                  {preview.slice(0, 5).map(({ book, path, next }) => (
                    <li
                      key={book.id}
                      className="truncate text-xs"
                      title={`${basename(path)} → ${next}`}
                    >
                      <span className="text-muted-foreground">
                        {basename(path)}
                      </span>
                      <span className="text-muted-foreground"> → </span>
                      <span>{next}</span>
                    </li>
                  ))}
                </ul>
                {preview.length > 5 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    and {preview.length - 5} more…
                  </p>
                )}
              </div>
            )}

            {plan ? (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                <p className="text-xs font-medium">
                  {plan.moves.length === 0
                    ? "Every filename already matches."
                    : `Rename ${plan.moves.length} file${
                        plan.moves.length === 1 ? "" : "s"
                      }?`}
                </p>
                {plan.moves.length > 0 && (
                  <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto">
                    {plan.moves.map((move) => (
                      <li
                        key={move.id}
                        className="truncate text-[11px]"
                        title={`${move.from} → ${move.to}`}
                      >
                        <span className="text-muted-foreground">
                          {basename(move.from)}
                        </span>
                        <span className="text-muted-foreground"> → </span>
                        <span>{basename(move.to)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {plan.problems.length > 0 && (
                  <ul className="mt-1 text-[11px] text-amber-800 dark:text-amber-200">
                    {plan.problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    disabled={renaming || plan.moves.length === 0}
                    onClick={() => void confirmRename()}
                  >
                    {renaming
                      ? "Renaming…"
                      : `Rename ${plan.moves.length} file${
                          plan.moves.length === 1 ? "" : "s"
                        }`}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={renaming}
                    onClick={() => setPlan(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    planning ||
                    templateIssues.length > 0 ||
                    !libraryDir ||
                    libraryChanged
                  }
                  onClick={() => void startRename()}
                >
                  <RefreshCw aria-hidden />
                  {planning ? "Checking…" : "Rename library…"}
                </Button>
                {libraryChanged && (
                  <p className="text-[11px] text-muted-foreground">
                    Save the new library folder first.
                  </p>
                )}
                {renameReport && (
                  <p className="text-[11px] text-muted-foreground">
                    Renamed {renameReport.renamed} file
                    {renameReport.renamed === 1 ? "" : "s"}.
                    {renameReport.problems.length > 0
                      ? ` ${renameReport.problems.length} did not move.`
                      : ""}
                  </p>
                )}
              </div>
            )}
            {renameReport && renameReport.problems.length > 0 && (
              <ul className="mt-1 text-[11px] text-destructive">
                {renameReport.problems.slice(0, 5).map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-6">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Ingest
            </h3>
            <div className="mt-2 space-y-1">
              <ToggleRow
                label="Fetch metadata online"
                checked={fetchMetadata}
                onChange={setFetchMetadata}
              />
              <ToggleRow
                label="Clean converted EPUBs"
                checked={cleanConverted}
                onChange={setCleanConverted}
              />
              <ToggleRow
                label="Fetch covers"
                checked={fetchCovers}
                onChange={setFetchCovers}
              />
            </div>
          </section>

          <section className="mt-6">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Archive originals
            </h3>
            <div className="mt-2">
              <ToggleRow
                label="Keep a copy of every dropped file"
                checked={archiveOriginals}
                onChange={setArchiveOriginals}
              />
              {archiveOriginals && (
                <div className="mt-2 flex gap-2">
                  <Input
                    value={originalsDir}
                    onChange={(event) => setOriginalsDir(event.target.value)}
                    placeholder="Archive folder…"
                    aria-label="Archive folder"
                    spellCheck={false}
                  />
                  <Button variant="outline" size="sm" onClick={pickArchive}>
                    <FolderOpen aria-hidden />
                    Choose…
                  </Button>
                </div>
              )}
              <p
                className="mt-1 text-xs text-muted-foreground"
                title={originalsDir}
              >
                {archiveSummary(archiveStats, archiveOriginals)}
              </p>
              {archiveIssue && (
                <p className="mt-2 text-xs text-destructive">{archiveIssue}</p>
              )}
            </div>
          </section>

          <section className="mt-6">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              calibre
            </h3>
            <div className="mt-2 flex items-center gap-2">
              {install ? (
                <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {install.version} · {install.dir}
                </p>
              ) : (
                <p className="min-w-0 flex-1 text-xs text-destructive">
                  Not found. Install calibre or put it on PATH.
                </p>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void onRecheck()}
              >
                <RefreshCw aria-hidden />
                Re-check
              </Button>
            </div>
            <p
              className="mt-2 truncate text-[11px] text-muted-foreground"
              title={calibreDir ?? undefined}
            >
              {calibreDir
                ? `Override: ${calibreDir}`
                : "Detected automatically from PATH or the default install folder."}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={pickCalibre}>
                <FolderOpen aria-hidden />
                Change…
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={!calibreDir}
                onClick={() => setCalibreDir(null)}
              >
                Reset
              </Button>
              <Button
                variant="link"
                size="sm"
                className="ml-auto"
                onClick={() => void openDownload()}
              >
                Download calibre
              </Button>
            </div>
          </section>

          <section className="mt-6">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Data folder
            </h3>
            <div className="mt-2 flex items-center gap-2">
              <p
                className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                title={config.homeDir}
              >
                {config.homeDir}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void openDataFolder()}
              >
                <FolderOpen aria-hidden />
                Open
              </Button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Reading status and notes live here. Close Bookdrop before copying
              this folder as a backup.
            </p>
          </section>

          <section className="mt-6 border-t pt-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              About
            </h3>
            <p className="mt-1 text-sm font-medium">
              Bookdrop{version ? ` ${version}` : ""}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Drop your ebooks in. Get one organized library with clean metadata
              and a reading log.
            </p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              Bookdrop is an independent project. It is not affiliated with,
              endorsed by, or sponsored by calibre. calibre is a separate
              application by Kovid Goyal; Bookdrop calls its command-line tools
              when calibre is installed.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              MIT licensed. LICENSE.txt and THIRD-PARTY.md are installed with
              the app.
            </p>
          </section>
        </div>

        <div className="border-t px-5 py-3">
          {error && (
            <p className="mb-3 max-h-24 overflow-y-auto whitespace-pre-wrap rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={saving || renaming}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-1 py-1.5 text-sm hover:bg-muted/50">
      <span>{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
