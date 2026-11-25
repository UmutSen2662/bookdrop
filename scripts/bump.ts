/**
 * Set the app version everywhere: bun run bump 1.3.0
 *
 * Updates package.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, and
 * the bookdrop entry in src-tauri/Cargo.lock. Each file is edited in place so
 * its formatting is untouched; the script fails if a field is not found
 * exactly once.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { prune } from "./prune";

const root = process.cwd();
const next = process.argv[2];

if (!next || !/^\d+\.\d+\.\d+$/u.test(next)) {
  console.error("usage: bun run bump <major.minor.patch>, e.g. 1.3.0");
  process.exit(2);
}

const edits: {
  file: string;
  pattern: RegExp;
  replace: (old: string) => string;
}[] = [
  {
    file: "package.json",
    pattern: /"version": "(\d+\.\d+\.\d+)"/gu,
    replace: () => `"version": "${next}"`,
  },
  {
    file: join("src-tauri", "tauri.conf.json"),
    pattern: /"version": "(\d+\.\d+\.\d+)"/gu,
    replace: () => `"version": "${next}"`,
  },
  {
    file: join("src-tauri", "Cargo.toml"),
    pattern: /^version = "(\d+\.\d+\.\d+)"$/gmu,
    replace: () => `version = "${next}"`,
  },
  {
    file: join("src-tauri", "Cargo.lock"),
    pattern: /(name = "bookdrop"\nversion = ")(\d+\.\d+\.\d+)(")/gu,
    replace: (old) => old.replace(/\d+\.\d+\.\d+/u, next),
  },
];

for (const { file, pattern, replace } of edits) {
  const path = join(root, file);
  const text = readFileSync(path, "utf8");
  const matches = [...text.matchAll(pattern)];
  if (matches.length !== 1) {
    console.error(
      `${relative(root, path)}: expected one version field, found ${matches.length}`,
    );
    process.exit(1);
  }
  const updated = text.replace(pattern, replace);
  writeFileSync(path, updated, "utf8");
  const previous = matches[0][0].match(/\d+\.\d+\.\d+/u)?.[0];
  console.log(`${relative(root, path)}: ${previous} -> ${next}`);
}

// Each version gets its own Cargo unit dirs, so drop the old ones now.
prune();
