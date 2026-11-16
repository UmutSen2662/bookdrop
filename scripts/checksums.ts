/**
 * Release checksums: `bun run checksums`
 *
 * Reads the installers produced by `bun run tauri build` and writes
 * SHA256SUMS.txt in the repository root. The file is a release artifact, not
 * source; it is git-ignored and regenerated after every build.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

const root = process.cwd();
const bundleDir = join(root, "src-tauri", "target", "release", "bundle");
const output = join(root, "SHA256SUMS.txt");

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.isFile()) found.push(path);
  }
  return found;
}

if (!existsSync(bundleDir)) {
  console.error("No bundle folder found. Run `bun run tauri build` first.");
  process.exit(1);
}

const config = JSON.parse(
  readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"),
) as { version: string };
const version = config.version;

const installers = walk(bundleDir)
  .filter(
    (path) =>
      (/\.msi$/iu.test(path) || /-setup\.exe$/iu.test(path)) &&
      basename(path).includes(version),
  )
  .sort();

if (installers.length === 0) {
  console.error(
    `No ${version} installers found. Check tauri.conf.json and rebuild.`,
  );
  process.exit(1);
}

const lines = installers.map((path) => {
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
  return `${hash}  ${basename(path)}`;
});

writeFileSync(output, `${lines.join("\n")}\n`, "utf8");
console.log(`Wrote ${relative(root, output)}:\n${lines.join("\n")}`);
