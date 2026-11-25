/**
 * The headless pipeline: bun scripts/ingest.ts <file>...
 *
 * Same code path as the app. This is the only file that wires the Bun host and
 * the Bun SQLite adapter to the pipeline; the app wires its Tauri host instead.
 */

import { type CalibreInstall, findCalibre } from "@/pipeline/calibre";
import { loadConfig } from "@/pipeline/config";
import { openNodeStore } from "@/pipeline/db.node";
import { errorMessage } from "@/pipeline/errors";
import { createNodeHost } from "@/pipeline/host.node";
import { ingestFile } from "@/pipeline/ingest";
import { joinPath } from "@/pipeline/paths";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: bun scripts/ingest.ts <file>...");
  process.exit(2);
}

const host = createNodeHost();
const config = await loadConfig(host);

if (!config.libraryDir) {
  console.error(
    "no library folder configured. Set BOOKDROP_LIBRARY or libraryDir in config.json.",
  );
  process.exit(2);
}

// Startup: a temp dir from a crashed run is never reused.
const tmp = joinPath(config.homeDir, "tmp");
await host.removeDir(tmp);
await host.ensureDir(tmp);

const store = await openNodeStore(joinPath(config.homeDir, "db.sqlite"));

const started = performance.now();
let install: CalibreInstall;
try {
  install = await findCalibre(host, config.calibreDir);
} catch (error) {
  console.error(errorMessage(error));
  await store.close();
  process.exit(2);
}

console.log(`calibre ${install.version} at ${install.dir}`);
console.log(`library ${config.libraryDir}`);
console.log(
  `fetch=${onOff(config.fetchMetadata)} clean=${onOff(config.cleanConverted)} covers=${onOff(config.fetchCovers)} archive=${onOff(config.archiveOriginals)}`,
);

let failures = 0;
for (const file of files) {
  const before = performance.now();
  const outcome = await ingestFile(host, config, file, { install, store });
  const seconds = ((performance.now() - before) / 1000).toFixed(1);

  console.log("");
  if (outcome.duplicate) {
    console.log(`DUPLICATE  ${file}  (${seconds}s)`);
    console.log(`  in library: ${outcome.book?.title ?? "-"}`);
    if (outcome.book?.libraryPath)
      console.log(`  library   ${outcome.book.libraryPath}`);
    continue;
  }

  console.log(`${outcome.status.toUpperCase()}  ${file}  (${seconds}s)`);
  if (outcome.book) console.log(`  id       ${outcome.book.id}`);
  console.log(`  sha256   ${outcome.sha256 || "-"}`);
  if (outcome.metadata) {
    console.log(`  title    ${outcome.metadata.title || "-"}`);
    console.log(`  authors  ${outcome.metadata.authors || "-"}`);
    console.log(`  isbn     ${outcome.metadata.isbn ?? "-"}`);
    console.log(`  publish  ${outcome.metadata.publisher ?? "-"}`);
    console.log(`  date     ${outcome.metadata.published ?? "-"}`);
  }
  if (outcome.libraryPath) console.log(`  library  ${outcome.libraryPath}`);
  if (outcome.archivedPath) console.log(`  archive  ${outcome.archivedPath}`);
  if (outcome.bookUuid) console.log(`  uuid     ${outcome.bookUuid}`);
  if (outcome.flagReason) console.log(`  reason   ${outcome.flagReason}`);
  if (outcome.candidates) {
    const fields = Object.values(outcome.candidates.fields).reduce(
      (sum, list) => sum + list.length,
      0,
    );
    console.log(
      `  cands    ${fields} field value(s), ${outcome.candidates.covers.length} cover(s)`,
    );
    for (const cover of outcome.candidates.covers) {
      console.log(
        `           ${cover.source} ${cover.width}x${cover.height} ${cover.path}`,
      );
    }
  }
  if (outcome.cleanWarning) console.log(`  warning  ${outcome.cleanWarning}`);
  if (outcome.notes) console.log(`  notes    ${outcome.notes}`);
  if (outcome.error) {
    console.log(
      `  error    ${outcome.error.split("\n").slice(-6).join("\n           ")}`,
    );
  }

  if (outcome.status === "flagged") failures++;
}

const counts = await store.counts();
console.log("");
console.log(
  `database: ${counts.total} book(s), ${counts.flagged} flagged, ${counts.needsReview} need review, ${counts.pinned} pinned`,
);
console.log(
  `done in ${((performance.now() - started) / 1000).toFixed(1)}s, ${failures} flagged`,
);

await store.close();
process.exit(failures > 0 ? 1 : 0);

function onOff(value: boolean): string {
  return value ? "on" : "off";
}
