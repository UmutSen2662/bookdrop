/**
 * Prune stale unit dirs for the app crate: bun run prune [keep]
 *
 * Cargo never deletes a unit directory when its hash changes, and for the app
 * crate each one can be hundreds of MB (rlib + debuginfo). This keeps the
 * newest `keep` dirs for the app crate in each profile and deletes the rest.
 * Four covers lib, bin, build script compile, and build script run.
 *
 * Dependencies are deliberately left alone: Cargo has no "last used" marker,
 * so any heuristic that prunes them can delete a live cache entry and trigger
 * a rebuild cascade. Use `cargo clean` for those.
 *
 * Run it when no build is in progress.
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { join } from "node:path";

const target = join(process.cwd(), "src-tauri", "target");
const manifest = readFileSync(
  join(process.cwd(), "src-tauri", "Cargo.toml"),
  "utf8",
);
const match = /\[package\][\s\S]*?\nname = "([^"]+)"/u.exec(manifest);
if (!match) {
  console.error("cannot find the package name in src-tauri/Cargo.toml");
  process.exit(1);
}
const app = match[1];

function size(path: string): number {
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    total += entry.isDirectory() ? size(child) : statSync(child).size;
  }
  return total;
}

function megabytes(bytes: number): string {
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`;
}

function lastCompiled(path: string): number {
  const stamp = join(path, "fingerprint", "invoked.timestamp");
  return existsSync(stamp) ? statSync(stamp).mtimeMs : statSync(path).mtimeMs;
}

export function prune(keep = 4): void {
  for (const profile of ["debug", "release"]) {
    const dir = join(target, profile, "build", app);
    if (!existsSync(dir)) continue;

    const units = readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && /^[0-9a-f]{16}$/u.test(entry.name),
      )
      .map((entry) => {
        const path = join(dir, entry.name);
        return { path, mtime: lastCompiled(path) };
      })
      .sort((a, b) => b.mtime - a.mtime);

    let freed = 0;
    const stale = units.slice(keep);
    for (const unit of stale) {
      freed += size(unit.path);
      rmSync(unit.path, { recursive: true, force: true });
    }

    if (stale.length > 0) {
      console.log(
        `${profile}: removed ${stale.length} stale dirs for ${app}, freed ${megabytes(freed)}`,
      );
    }
  }
}

if (import.meta.main) {
  const keep = Number(process.argv[2] ?? 4);
  if (!Number.isInteger(keep) || keep < 1) {
    console.error("usage: bun run prune [keep], e.g. bun run prune 4");
    process.exit(2);
  }
  prune(keep);
}
