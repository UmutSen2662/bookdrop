import { invoke } from "@tauri-apps/api/core";
import { downloadDir } from "@tauri-apps/api/path";
import { save as chooseSavePath, open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FolderOpen, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { SECTION_LABEL } from "@/components/ui/typography";
import { formatBytes } from "@/lib/format";
import { CALIBRE_DOWNLOAD_URL } from "@/lib/links";
import { useAppVersion } from "@/lib/useAppVersion";
import type { CalibreInstall } from "@/pipeline/calibre";
import type { Config } from "@/pipeline/config";
import { errorMessage } from "@/pipeline/errors";
import type { Host } from "@/pipeline/host";
import type { RenamePlan, RenameReport } from "@/pipeline/library";
import {
  DEFAULT_FILE_NAME_TEMPLATE,
  FILE_NAME_TOKENS,
  formatLibraryFileName,
  templateProblems,
} from "@/pipeline/names";
import { notesExportFileName, notesExportJson } from "@/pipeline/notes";
import {
  basename,
  dirname,
  joinPath,
  normalizedFolder,
} from "@/pipeline/paths";
import type { Book } from "@/pipeline/types";

type Props = {
  config: Config;
  host: Host;
  install: CalibreInstall | null;
  books: Book[];
  /** Demo mode opens the dialog but never touches the OS. */
  demo?: boolean;
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
  demo = false,
  onClose,
  onSave,
  onRecheck,
  onPlanRenames,
  onRenameLibrary,
}: Props) {
  const [template, setTemplate] = useState(config.fileNameTemplate);
  const [plan, setPlan] = useState<RenamePlan | null>(null);
  const [planning, setPlanning] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameReport, setRenameReport] = useState<RenameReport | null>(null);
  const [archiveStats, setArchiveStats] = useState<
    FolderStats | null | undefined
  >(undefined);
  const [pendingLibrary, setPendingLibrary] = useState<string | null>(null);
  const [changingLibrary, setChangingLibrary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const version = useAppVersion();
  const templateInput = useRef<HTMLInputElement>(null);
  const templateRef = useRef(template);
  templateRef.current = template;
  const saveQueue = useRef<Promise<void>>(Promise.resolve());

  const archiveIssue = config.archiveOriginals
    ? archiveProblem(config.libraryDir, config.originalsDir)
    : null;
  const pendingOutside = useMemo(() => {
    if (!pendingLibrary) return 0;
    const target = normalizedFolder(pendingLibrary);
    if (!target) return 0;
    return books.filter(
      (book) =>
        book.libraryPath &&
        !book.missing &&
        normalizedFolder(dirname(book.libraryPath)) !== target,
    ).length;
  }, [books, pendingLibrary]);
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
              normalizedFolder(config.libraryDir),
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
    [books, effectiveTemplate, config.libraryDir],
  );

  useEffect(() => {
    if (!config.originalsDir) {
      setArchiveStats(undefined);
      return;
    }
    setArchiveStats(undefined);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void readFolderStats(host, config.originalsDir)
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
  }, [host, config.originalsDir]);

  function resetPlan() {
    setPlan(null);
    setRenameReport(null);
  }

  async function pickFolder(title: string): Promise<string | null> {
    if (demo) return null;
    const selected = await open({ directory: true, multiple: false, title });
    return typeof selected === "string" ? selected : null;
  }

  /** Queue writes so two quick changes cannot overwrite each other. */
  function apply(patch: Partial<Config>): Promise<boolean> {
    setError(null);
    const run = saveQueue.current.then(() => onSave(patch));
    saveQueue.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run.then(
      () => true,
      (saveError) => {
        setError(errorMessage(saveError));
        return false;
      },
    );
  }

  async function pickLibrary() {
    const selected = await pickFolder("Choose the library folder");
    if (!selected || selected === config.libraryDir) return;
    if (config.archiveOriginals) {
      const issue = archiveProblem(selected, config.originalsDir);
      if (issue) {
        setError(issue);
        return;
      }
    }
    setError(null);
    setPendingLibrary(selected);
  }

  async function confirmLibrary() {
    if (!pendingLibrary || changingLibrary) return;
    setChangingLibrary(true);
    const applied = await apply({ libraryDir: pendingLibrary });
    setChangingLibrary(false);
    if (applied) {
      resetPlan();
      setPendingLibrary(null);
    }
  }

  async function pickArchive() {
    const selected = await pickFolder("Choose the archive folder");
    if (!selected || selected === config.originalsDir) return;
    const issue = archiveProblem(config.libraryDir, selected);
    if (issue) {
      setError(issue);
      return;
    }
    await apply({ originalsDir: selected });
  }

  async function pickCalibre() {
    const selected = await pickFolder("Choose the calibre folder");
    if (!selected || selected === config.calibreDir) return;
    await apply({ calibreDir: selected });
  }

  function toggleArchive(value: boolean) {
    void applyArchive(value);
  }

  async function applyArchive(value: boolean) {
    if (!value) {
      await apply({ archiveOriginals: false });
      return;
    }
    if (!config.originalsDir) {
      const selected = await pickFolder("Choose the archive folder");
      if (!selected) return;
      const issue = archiveProblem(config.libraryDir, selected);
      if (issue) {
        setError(issue);
        return;
      }
      await apply({ originalsDir: selected, archiveOriginals: true });
      return;
    }
    const issue = archiveProblem(config.libraryDir, config.originalsDir);
    if (issue) {
      setError(issue);
      return;
    }
    await apply({ archiveOriginals: true });
  }

  async function commitTemplate() {
    const next = effectiveTemplate;
    if (next === config.fileNameTemplate || templateIssues.length > 0) return;
    const applied = await apply({ fileNameTemplate: next });
    // The user may have kept typing while the write was in flight.
    if (templateRef.current !== template) return;
    setTemplate(applied ? next : config.fileNameTemplate);
  }

  async function resetTemplate() {
    if (template === DEFAULT_FILE_NAME_TEMPLATE) return;
    setTemplate(DEFAULT_FILE_NAME_TEMPLATE);
    resetPlan();
    const applied = await apply({
      fileNameTemplate: DEFAULT_FILE_NAME_TEMPLATE,
    });
    if (!applied && templateRef.current === DEFAULT_FILE_NAME_TEMPLATE) {
      setTemplate(config.fileNameTemplate);
    }
  }

  async function exportNotes() {
    setError(null);
    setExportMessage(null);
    if (demo) {
      setExportMessage("Exporting is disabled in demo mode.");
      return;
    }
    try {
      const exportedAt = new Date();
      const path = await chooseSavePath({
        title: "Export notes",
        defaultPath: joinPath(
          await downloadDir(),
          notesExportFileName(exportedAt),
        ),
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      const bytes = new TextEncoder().encode(
        notesExportJson(books, exportedAt),
      );
      await host.writeFileAtomic(path, bytes);
      setExportMessage(
        `Exported ${books.length} ${books.length === 1 ? "book" : "books"} to ${basename(path)}.`,
      );
    } catch (exportError) {
      setError(errorMessage(exportError));
    }
  }

  async function openDownload() {
    if (demo) return;
    setError(null);
    try {
      await openUrl(CALIBRE_DOWNLOAD_URL);
    } catch (openError) {
      setError(errorMessage(openError));
    }
  }

  async function openFolder(path: string) {
    if (demo) return;
    setError(null);
    try {
      await invoke("open_path", { path });
    } catch (openError) {
      setError(errorMessage(openError));
    }
  }

  function insertToken(token: string) {
    const text = `{${token}}`;
    resetPlan();
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
      const saved = await apply({ fileNameTemplate: effectiveTemplate });
      if (!saved) return;
      setTemplate(effectiveTemplate);
      setRenameReport(await onRenameLibrary(plan));
      setPlan(null);
    } catch (renameError) {
      setError(errorMessage(renameError));
    } finally {
      setRenaming(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        size="lg"
        className="flex max-h-[90vh] flex-col overflow-hidden p-0"
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <DialogTitle>Settings</DialogTitle>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Close"
            onClick={onClose}
          >
            <X aria-hidden />
          </Button>
        </div>

        {error && (
          <div className="border-b px-5 py-2">
            <Callout role="alert" className="whitespace-pre-wrap">
              <ScrollArea className="max-h-20">{error}</ScrollArea>
            </Callout>
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-5">
            <BandHeading first title="Library" />
            <section className="mt-5">
              <h3 className={SECTION_LABEL}>Folder</h3>
              <div className="mt-2 flex gap-2">
                <Input
                  value={config.libraryDir}
                  readOnly
                  placeholder="Choose a folder…"
                  aria-label="Library folder"
                  spellCheck={false}
                  className="cursor-default bg-muted/20"
                />
                <Button variant="outline" size="sm" onClick={pickLibrary}>
                  <FolderOpen aria-hidden />
                  Choose…
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!config.libraryDir}
                  onClick={() => void openFolder(config.libraryDir)}
                >
                  Open
                </Button>
              </div>
              {pendingLibrary ? (
                <Callout tone="warning" className="mt-2">
                  <p className="text-xs font-medium break-all">
                    Use {pendingLibrary} as the library folder?
                  </p>
                  <p className="mt-1">
                    {pendingOutside > 0 ? (
                      <>
                        {pendingOutside} book
                        {pendingOutside === 1 ? "" : "s"} already filed
                        elsewhere will be marked{" "}
                        <strong>outside library</strong> until you move them.
                        Move the files into the new folder: Bookdrop re-attaches
                        them by file hash on the next start. Copying instead of
                        moving creates duplicates.
                      </>
                    ) : (
                      "Nothing already filed needs to move."
                    )}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      disabled={changingLibrary}
                      onClick={() => void confirmLibrary()}
                    >
                      {changingLibrary ? "Changing…" : "Change folder"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={changingLibrary}
                      onClick={() => setPendingLibrary(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </Callout>
              ) : (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  New drops go here; books already filed stay where they were.
                </p>
              )}
            </section>

            <section className="mt-5">
              <div className="flex items-center justify-between gap-2">
                <h3 className={SECTION_LABEL}>File names</h3>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={template === DEFAULT_FILE_NAME_TEMPLATE}
                  onClick={() => void resetTemplate()}
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
                  resetPlan();
                }}
                onBlur={() => void commitTemplate()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    setTemplate(config.fileNameTemplate);
                    resetPlan();
                  }
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
                  and a blank template means the default. New drops use this
                  right away.
                </p>
              )}

              {preview.length > 0 && (
                <div className="mt-3 rounded-lg border bg-muted/30 px-3 py-2">
                  <p className={SECTION_LABEL}>Preview</p>
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
                <Callout tone="warning" className="mt-3">
                  <p className="text-xs font-medium">
                    {plan.moves.length === 0
                      ? "Every filename already matches."
                      : `Rename ${plan.moves.length} file${
                          plan.moves.length === 1 ? "" : "s"
                        }?`}
                  </p>
                  {plan.moves.length > 0 && (
                    <ScrollArea className="mt-1 max-h-32">
                      <ul className="space-y-0.5">
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
                    </ScrollArea>
                  )}
                  {plan.problems.length > 0 && (
                    <ul className="mt-1 text-[11px]">
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
                </Callout>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      planning ||
                      templateIssues.length > 0 ||
                      !config.libraryDir
                    }
                    onClick={() => void startRename()}
                  >
                    <RefreshCw aria-hidden />
                    {planning ? "Checking…" : "Rename library…"}
                  </Button>
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

            <BandHeading title="Importing" />
            <section className="mt-5">
              <h3 className={SECTION_LABEL}>Processing</h3>
              <div className="mt-2 space-y-1">
                <ToggleRow
                  label="Fetch metadata online"
                  checked={config.fetchMetadata}
                  onChange={(value) => void apply({ fetchMetadata: value })}
                />
                <ToggleRow
                  label="Clean converted EPUBs"
                  checked={config.cleanConverted}
                  onChange={(value) => void apply({ cleanConverted: value })}
                />
                <ToggleRow
                  label="Fetch covers"
                  checked={config.fetchCovers}
                  onChange={(value) => void apply({ fetchCovers: value })}
                />
              </div>
            </section>

            <section className="mt-5">
              <h3 className={SECTION_LABEL}>calibre</h3>
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
                title={config.calibreDir ?? undefined}
              >
                {config.calibreDir
                  ? `Override: ${config.calibreDir}`
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
                  disabled={!config.calibreDir}
                  onClick={() => void apply({ calibreDir: null })}
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

            <BandHeading title="Data" />
            <section className="mt-5">
              <h3 className={SECTION_LABEL}>Archive originals</h3>
              <div className="mt-2">
                <ToggleRow
                  label="Keep a copy of every dropped file"
                  checked={config.archiveOriginals}
                  onChange={toggleArchive}
                />
                {config.archiveOriginals && (
                  <div className="mt-2 flex gap-2">
                    <Input
                      value={config.originalsDir}
                      readOnly
                      placeholder="Archive folder…"
                      aria-label="Archive folder"
                      spellCheck={false}
                      className="cursor-default bg-muted/20"
                    />
                    <Button variant="outline" size="sm" onClick={pickArchive}>
                      <FolderOpen aria-hidden />
                      Choose…
                    </Button>
                  </div>
                )}
                <p
                  className="mt-1 text-xs text-muted-foreground"
                  title={config.originalsDir}
                >
                  {archiveSummary(archiveStats, config.archiveOriginals)}
                </p>
                {archiveIssue && (
                  <p className="mt-2 text-xs text-destructive">
                    {archiveIssue}
                  </p>
                )}
              </div>
            </section>

            <section className="mt-5">
              <h3 className={SECTION_LABEL}>Backup</h3>
              <div className="mt-2 flex items-center gap-2">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  {exportMessage ??
                    "Export reading status and personal notes to a JSON file."}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void exportNotes()}
                >
                  Export…
                </Button>
              </div>
            </section>

            <BandHeading title="About" />
            <section className="mt-5">
              <p className="mt-1 text-sm font-medium">
                Bookdrop{version ? ` ${version}` : ""}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Drop your ebooks in. Get one organized library with clean
                metadata and a reading log.
              </p>
              <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                Bookdrop is an independent project. It is not affiliated with,
                endorsed by, or sponsored by calibre. calibre is a separate
                application by Kovid Goyal; Bookdrop calls its command-line
                tools when calibre is installed.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                MIT licensed. LICENSE.txt and THIRD-PARTY.md are installed with
                the app.
              </p>
              <Button
                variant="link"
                size="sm"
                className="mt-3 h-auto px-0 text-xs"
                title={config.homeDir}
                onClick={() => void openFolder(config.homeDir)}
              >
                <FolderOpen aria-hidden />
                Open data folder
              </Button>
            </section>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function BandHeading({ title, first }: { title: string; first?: boolean }) {
  return (
    <div className={first ? "" : "mt-9 border-t pt-6"}>
      <h2 className="font-heading text-base font-semibold">{title}</h2>
    </div>
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
