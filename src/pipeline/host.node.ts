/**
 * Bun/Node implementation of the Host. Used by scripts and tests; never by the
 * app. This is the only pipeline file that may import node:* modules.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type {
  FileStat,
  Host,
  HttpResult,
  ProcessResult,
} from "@/pipeline/host";

/** Matches the cap the Rust host imposes: no cover or JSON body needs more. */
const HTTP_MAX_BYTES = 10 * 1024 * 1024;

function tempPath(destination: string): string {
  const stamp = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  return path.join(
    path.dirname(destination),
    `.tmp-${process.pid}-${stamp}-${path.basename(destination)}`,
  );
}

async function killTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    const killer = Bun.spawn(["taskkill", "/PID", String(pid), "/T", "/F"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
    await killer.exited;
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already gone.
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

export function createNodeHost(): Host {
  return {
    async readFile(filePath) {
      return new Uint8Array(await readFile(filePath));
    },

    async writeFileAtomic(destination, bytes) {
      const temporary = tempPath(destination);
      try {
        await writeFile(temporary, bytes);
        await rename(temporary, destination);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
    },

    async copyFile(from, to) {
      await copyFile(from, to);
    },

    async renameFile(from, to) {
      // Match the Windows primitive: refuse to clobber an existing file.
      if (await stat(to).catch(() => null)) {
        throw new Error(`will not overwrite ${to}`);
      }
      await rename(from, to);
    },

    async removeFile(target) {
      await rm(target, { force: true });
    },

    async ensureDir(dir) {
      await mkdir(dir, { recursive: true });
    },

    async removeDir(dir) {
      await rm(dir, { recursive: true, force: true });
    },

    async listDir(dir) {
      return (await readdir(dir)).sort();
    },

    async httpGet(url, destination, timeoutMs): Promise<HttpResult> {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        Math.max(timeoutMs, 1_000),
      );
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          redirect: "follow",
          headers: { "user-agent": "bookdrop/1.0 (personal library tool)" },
        });
        const body = new Uint8Array(await response.arrayBuffer());
        if (body.length > HTTP_MAX_BYTES) {
          throw new Error(`response from ${url} is larger than 10 MB`);
        }
        await writeFile(destination, body);
        return {
          status: response.status,
          contentType: response.headers.get("content-type") ?? "",
        };
      } finally {
        clearTimeout(timer);
      }
    },

    async stat(target): Promise<FileStat | null> {
      try {
        const info = await stat(target);
        return {
          size: info.size,
          mtimeMs: info.mtimeMs,
          isDirectory: info.isDirectory(),
        };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "ENOENT" || code === "ENOTDIR") return null;
        throw error;
      }
    },

    async hashFile(filePath) {
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(filePath)) {
        hash.update(chunk as Buffer);
      }
      return hash.digest("hex");
    },

    async runProcess(program, args, timeoutMs): Promise<ProcessResult> {
      // Bun.spawn never touches a shell: the argv array is passed as-is.
      const child = Bun.spawn([program, ...args], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          // calibre is Python; without this it writes cp1252 and mangles names.
          PYTHONUTF8: "1",
          PYTHONIOENCODING: "utf-8",
        },
      });

      const stdoutChunks: Uint8Array[] = [];
      const stderrChunks: Uint8Array[] = [];
      let timedOut = false;

      const collect = async (
        stream: ReadableStream<Uint8Array>,
        chunks: Uint8Array[],
      ) => {
        for await (const chunk of stream) chunks.push(chunk);
      };
      const readers = Promise.all([
        collect(child.stdout as ReadableStream<Uint8Array>, stdoutChunks),
        collect(child.stderr as ReadableStream<Uint8Array>, stderrChunks),
      ]);
      // Never leave the promise unhandled if we stop waiting below.
      readers.catch(() => undefined);

      const timer = setTimeout(
        () => {
          timedOut = true;
          void killTree(child.pid);
        },
        Math.max(timeoutMs, 1_000),
      );

      try {
        const code = await child.exited;
        // A detached grandchild can inherit the pipes and keep them open long
        // after the child is gone. Give the readers a moment, then use what we
        // have, exactly like the Rust host does.
        await Promise.race([readers, Bun.sleep(2_000)]);

        return {
          code: timedOut ? null : code,
          stdout: new TextDecoder("utf-8").decode(concat(stdoutChunks)),
          stderr: new TextDecoder("utf-8").decode(concat(stderrChunks)),
          timedOut,
        };
      } finally {
        clearTimeout(timer);
      }
    },

    env(name) {
      return process.env[name];
    },
  };
}
