/**
 * The only door to the outside world.
 *
 * `src/pipeline` is plain TypeScript: it never imports @tauri-apps/*, node:fs,
 * or Bun. Everything native goes through this interface, so the same code runs
 * in the app (host.tauri.ts) and under Bun (host.node.ts).
 */

export type ProcessResult = {
  /** Null when the process was killed for running too long. */
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
};

export type FileStat = {
  size: number;
  mtimeMs: number;
  isDirectory: boolean;
};

export type HttpResult = {
  status: number;
  /** Empty when the server sent no Content-Type. */
  contentType: string;
};

export interface Host {
  readFile(path: string): Promise<Uint8Array>;
  /** Write via a temp file in the same directory, then rename. */
  writeFileAtomic(path: string, bytes: Uint8Array): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  /** Move a file. Refuses when `to` already exists, so nothing is clobbered. */
  renameFile(from: string, to: string): Promise<void>;
  removeFile(path: string): Promise<void>;
  /** Create a directory and its parents; no error when it already exists. */
  ensureDir(path: string): Promise<void>;
  /** Remove a directory and everything in it; no error when it is missing. */
  removeDir(path: string): Promise<void>;
  /** Entry names, not full paths. Throws when the directory is unreadable. */
  listDir(path: string): Promise<string[]>;
  /** Null when the path does not exist. */
  stat(path: string): Promise<FileStat | null>;
  /**
   * Download straight to a file. Never throws for an HTTP error status; the
   * caller decides what 404 means. A network or write failure throws.
   */
  httpGet(
    url: string,
    destination: string,
    timeoutMs: number,
  ): Promise<HttpResult>;
  /** Streaming SHA-256, lowercase hex. */
  hashFile(path: string): Promise<string>;
  /**
   * Run an executable with an argv array (never a shell string). The adapter is
   * responsible for hiding console windows and forcing UTF-8 on calibre.
   */
  runProcess(
    program: string,
    args: string[],
    timeoutMs: number,
  ): Promise<ProcessResult>;
  /** Environment lookup; the webview has no `process.env`. */
  env(name: string): string | undefined;
  /**
   * Optional display concern. Extract the cover from an EPUB, resize it to at
   * most `maxWidth` px, and write a JPEG. Bun tests skip it; the app implements
   * it with the Rust `image` crate.
   */
  makeThumbnail?(
    sourcePath: string,
    destination: string,
    maxWidth: number,
  ): Promise<void>;
  /**
   * Pixel dimensions from the image header, without decoding it. Optional:
   * the Bun host skips it, so cover sizes are a display concern in the app.
   */
  imageSize?(path: string): Promise<{ width: number; height: number } | null>;
}
