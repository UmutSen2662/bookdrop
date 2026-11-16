/**
 * Updater manifest: `bun run latest-json ["release notes"]`
 *
 * Reads the NSIS installer and its signature from the bundle produced by
 * `bun run tauri build`, then writes latest.json. Upload it next to the
 * installer on the GitHub release; the app fetches the manifest from the
 * newest release (`/releases/latest/download/latest.json`).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, relative } from "node:path";

const root = process.cwd();
const bundleDir = join(
  root,
  "src-tauri",
  "target",
  "release",
  "bundle",
  "nsis",
);
const output = join(root, "latest.json");
const notes = process.argv.slice(2).join(" ").trim();

const config = JSON.parse(
  readFileSync(join(root, "src-tauri", "tauri.conf.json"), "utf8"),
) as {
  version: string;
  plugins?: { updater?: { endpoints?: string[] } };
};
const version = config.version;

const endpoint = config.plugins?.updater?.endpoints?.[0];
const repository = endpoint?.replace(
  /\/releases\/latest\/download\/latest\.json$/u,
  "",
);
if (!endpoint || !repository || repository === endpoint) {
  console.error(
    "No GitHub updater endpoint in tauri.conf.json. It should end in /releases/latest/download/latest.json.",
  );
  process.exit(1);
}

if (!existsSync(bundleDir)) {
  console.error("No NSIS bundle found. Run `bun run tauri build` first.");
  process.exit(1);
}

const installer = readdirSync(bundleDir).find(
  (name) => /-setup\.exe$/iu.test(name) && name.includes(version),
);
if (!installer) {
  console.error(
    `No ${version} NSIS installer found. Check tauri.conf.json and rebuild.`,
  );
  process.exit(1);
}

const signaturePath = join(bundleDir, `${installer}.sig`);
if (!existsSync(signaturePath)) {
  console.error(
    `No signature for ${installer}. Set TAURI_SIGNING_PRIVATE_KEY and rebuild.`,
  );
  process.exit(1);
}

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature: readFileSync(signaturePath, "utf8").trim(),
      url: `${repository}/releases/download/v${version}/${encodeURIComponent(
        basename(installer),
      )}`,
    },
  },
};

writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${relative(root, output)} for ${version}.`);
console.log(
  "Upload latest.json, the NSIS installer, SHA256SUMS.txt, and the .sig file to the release.",
);
