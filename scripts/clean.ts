/**
 * Run the cleaner alone: bun scripts/clean.ts in.epub [out.epub]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { cleanEpub } from "../src/pipeline/clean";

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error("usage: bun scripts/clean.ts in.epub [out.epub]");
  process.exit(2);
}

const started = performance.now();
const result = cleanEpub(readFileSync(input));
const elapsed = Math.round(performance.now() - started);
const { report } = result;

for (const join of report.joins) {
  console.log(`${join.file}: '...${join.before}' + '${join.after}...'`);
}
console.log(`joins: ${report.joins.length}`);
console.log(
  `TOC problems before: ${report.tocProblemsBefore.length}, after: ${report.tocProblemsAfter.length}`,
);
for (const problem of report.tocProblemsAfter) {
  console.log("  ", problem);
}
if (report.error) {
  console.error(`error: ${report.error}`);
  process.exit(1);
}
console.log(`changed files: ${report.changedFiles.length}, ${elapsed} ms`);

if (report.blocked) {
  console.error("TOC broke, nothing written");
  process.exit(1);
}
if (!output) process.exit(0);

if (!result.output) {
  console.log("nothing to write: no paragraph needed joining");
  process.exit(0);
}
writeFileSync(output, result.output);
console.log(`wrote ${output}`);
