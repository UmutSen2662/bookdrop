/**
 * The app's Host adapter. The only pipeline file allowed to import
 * @tauri-apps/*; every native action is a Rust command in `src-tauri/src/host.rs`.
 *
 * Byte payloads go out base64-encoded (a Vec<u8> argument arrives as a JSON
 * array of numbers). `read_file` returns raw bytes as an ArrayBuffer, which is
 * the right direction for large payloads.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  FileStat,
  Host,
  HttpResult,
  ProcessResult,
} from "@/pipeline/host";

const BASE64_CHUNK = 0x8000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += BASE64_CHUNK) {
    binary += String.fromCharCode(
      ...bytes.subarray(index, index + BASE64_CHUNK),
    );
  }
  return btoa(binary);
}

function toBytes(data: ArrayBuffer | number[]): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return Uint8Array.from(data);
}

export function createTauriHost(): Host {
  return {
    async readFile(path) {
      return toBytes(
        await invoke<ArrayBuffer | number[]>("read_file", { path }),
      );
    },

    async writeFileAtomic(path, bytes) {
      await invoke("write_file_atomic", { path, data: toBase64(bytes) });
    },

    async copyFile(from, to) {
      await invoke("copy_file", { from, to });
    },

    async renameFile(from, to) {
      await invoke("rename_file", { from, to });
    },

    async removeFile(path) {
      await invoke("remove_file", { path });
    },

    async ensureDir(path) {
      await invoke("ensure_dir", { path });
    },

    async removeDir(path) {
      await invoke("remove_dir", { path });
    },

    async listDir(path) {
      return invoke<string[]>("list_dir", { path });
    },

    async stat(path): Promise<FileStat | null> {
      const raw = await invoke<FileStat | null>("stat_path", { path });
      if (!raw) return null;
      return {
        size: Number(raw.size),
        mtimeMs: Number(raw.mtimeMs),
        isDirectory: Boolean(raw.isDirectory),
      };
    },

    async hashFile(path) {
      return invoke<string>("hash_file", { path });
    },

    async runProcess(program, args, timeoutMs): Promise<ProcessResult> {
      return invoke<ProcessResult>("run_process", {
        program,
        args,
        timeoutMs,
      });
    },

    async httpGet(url, destination, timeoutMs): Promise<HttpResult> {
      return invoke<HttpResult>("http_get", {
        url,
        destination,
        timeoutMs,
      });
    },

    env(name) {
      // Tauri commands are async, but Host.env is synchronous by design. The
      // app only asks for values that were preloaded below.
      return envCache.get(name);
    },

    async makeThumbnail(sourcePath, destination, maxWidth) {
      await invoke("make_thumbnail", {
        source: sourcePath,
        destination,
        maxWidth,
      });
    },

    async imageSize(path) {
      return invoke<{ width: number; height: number } | null>("image_size", {
        path,
      });
    },
  };
}

/**
 * The webview has no `process.env`, and `env` must stay synchronous (it is a
 * plain lookup in the pipeline). The app primes this cache before loading
 * config.
 */
const envCache = new Map<string, string>();

export async function primeEnv(names: string[]): Promise<void> {
  await Promise.all(
    names.map(async (name) => {
      const value = await invoke<string | null>("env_var", { name });
      if (value !== null) envCache.set(name, value);
    }),
  );
}
