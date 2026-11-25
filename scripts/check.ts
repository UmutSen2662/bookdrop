/**
 * Doctor: bun scripts/check.ts
 *
 * Checks the things that must be true before an ingest can work: calibre, the
 * library folder, the archive folder if enabled, the database, and the config.
 * Exits non-zero on any hard failure so it is usable from a shell loop.
 */
import { findCalibre } from "@/pipeline/calibre";
import { configPath, loadConfig } from "@/pipeline/config";
import { openNodeStore } from "@/pipeline/db.node";
import { errorMessage } from "@/pipeline/errors";
import { createNodeHost } from "@/pipeline/host.node";
import { joinPath, normalizedFolder } from "@/pipeline/paths";

const host = createNodeHost();
const config = await loadConfig(host);
let failures = 0;

function ok(label: string, detail: string) {
  console.log(`  ok    ${label}: ${detail}`);
}

function fail(label: string, detail: string) {
  failures++;
  console.log(`  FAIL  ${label}: ${detail}`);
}

function note(label: string, detail: string) {
  console.log(`  --    ${label}: ${detail}`);
}

console.log("Bookdrop check");

console.log("\nconfig");
const configFile = configPath(config);
if (await host.stat(configFile)) ok("file", configFile);
else note("file", `${configFile} does not exist yet; using defaults`);

console.log("\ncalibre");
try {
  const install = await findCalibre(host, config.calibreDir);
  ok("version", `${install.version} at ${install.dir}`);
} catch (error) {
  fail("calibre", errorMessage(error));
}

console.log("\nlibrary");
if (!config.libraryDir) {
  fail("library folder", "not configured (set libraryDir in config.json)");
} else {
  const library = await host.stat(config.libraryDir);
  if (!library) {
    fail("library folder", `${config.libraryDir} does not exist`);
  } else if (!library.isDirectory) {
    fail("library folder", `${config.libraryDir} is not a directory`);
  } else {
    const probe = joinPath(config.libraryDir, ".write-check");
    try {
      await host.writeFileAtomic(probe, new TextEncoder().encode("ok"));
      await host.removeFile(probe);
      ok("library folder", `${config.libraryDir} (writable)`);
    } catch (error) {
      fail("library folder", `not writable: ${errorMessage(error)}`);
    }
  }
}

console.log("\narchive");
if (!config.archiveOriginals) {
  note("archiving", "off; nothing outside the library will be written");
} else if (!config.originalsDir.trim()) {
  fail("archive folder", "choose an archive folder");
} else {
  const archive = await host.stat(config.originalsDir);
  if (archive && !archive.isDirectory) {
    fail("archive folder", `${config.originalsDir} is not a directory`);
  } else {
    ok("archive folder", config.originalsDir);
  }
  const archivePath = normalizedFolder(config.originalsDir);
  const libraryPath = normalizedFolder(config.libraryDir);
  if (archivePath === libraryPath) {
    fail("archive folder", "the archive cannot be the library folder");
  } else if (libraryPath && archivePath.startsWith(`${libraryPath}/`)) {
    fail("archive folder", "the archive cannot be inside the library folder");
  } else if (libraryPath?.startsWith(`${archivePath}/`)) {
    fail("archive folder", "the archive cannot contain the library folder");
  }
}

console.log("\ndatabase");
try {
  const store = await openNodeStore(joinPath(config.homeDir, "db.sqlite"));
  const counts = await store.counts();
  ok(
    "books",
    `${counts.total} total, ${counts.flagged} flagged, ${counts.needsReview} need review, ${counts.pinned} pinned`,
  );
  await store.close();
} catch (error) {
  fail("database", errorMessage(error));
}

console.log("\ntmp");
const tmp = joinPath(config.homeDir, "tmp");
try {
  await host.ensureDir(tmp);
  ok("tmp folder", tmp);
} catch (error) {
  fail("tmp folder", errorMessage(error));
}

console.log("");
if (failures > 0) {
  console.log(`${failures} problem(s)`);
  process.exit(1);
}
console.log("all good");
