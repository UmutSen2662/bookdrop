/**
 * A Host that answers just enough for the Settings and Edit screens to render.
 * Every write is swallowed, so demo mode cannot change the real library.
 */

import { DEMO_LIBRARY_DIR, DEMO_ORIGINALS_DIR } from "@/demo/constants";
import type { Host } from "@/pipeline/host";

const ARCHIVE_FILES = [
  "Alice's Adventures in Wonderland.epub",
  "Frankenstein.epub",
  "Pride and Prejudice.epub",
  "Walden.epub",
];

function normalize(path: string): string {
  return path.replace(/\\/gu, "/").replace(/\/+$/u, "");
}

export function createDemoHost(): Host {
  return {
    async readFile() {
      throw new Error("Demo mode does not read files.");
    },
    async writeFileAtomic() {
      // Intentionally inert.
    },
    async copyFile() {
      // Intentionally inert.
    },
    async renameFile() {
      // Intentionally inert.
    },
    async removeFile() {
      // Intentionally inert.
    },
    async ensureDir() {
      // Intentionally inert.
    },
    async removeDir() {
      // Intentionally inert.
    },
    async listDir(path) {
      return normalize(path) === normalize(DEMO_ORIGINALS_DIR)
        ? ARCHIVE_FILES
        : [];
    },
    async stat(path) {
      const clean = normalize(path);
      if (clean === normalize(DEMO_LIBRARY_DIR)) {
        return { size: 0, mtimeMs: 0, isDirectory: true };
      }
      if (clean === normalize(DEMO_ORIGINALS_DIR)) {
        return { size: 0, mtimeMs: 0, isDirectory: true };
      }
      if (clean.startsWith(`${normalize(DEMO_ORIGINALS_DIR)}/`)) {
        return { size: 2_400_000, mtimeMs: 0, isDirectory: false };
      }
      return null;
    },
    async httpGet() {
      throw new Error("Demo mode has no network access.");
    },
    async hashFile() {
      throw new Error("Demo mode does not hash files.");
    },
    async runProcess() {
      throw new Error("Demo mode does not run external programs.");
    },
    env() {
      return undefined;
    },
    async makeThumbnail() {
      // Intentionally inert.
    },
    async imageSize() {
      return null;
    },
  };
}
