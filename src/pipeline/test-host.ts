/**
 * An in-memory Host for tests that only care about HTTP, files, and argv.
 * `src/pipeline/library.test.ts` keeps its own richer fake for calibre output.
 */
import type {
  FileStat,
  Host,
  HttpResult,
  ProcessResult,
} from "@/pipeline/host";

export type FakeResponse = {
  status: number;
  contentType: string;
  body?: Uint8Array;
};

export class FakeHost implements Host {
  files = new Map<string, Uint8Array>();
  dirs = new Set<string>();
  requests: string[] = [];
  responses = new Map<string, FakeResponse>();

  constructor(
    private readonly responder: (url: string) => FakeResponse | null = () =>
      null,
  ) {}

  async readFile(path: string): Promise<Uint8Array> {
    const bytes = this.files.get(path);
    if (!bytes) throw new Error(`ENOENT ${path}`);
    return bytes;
  }

  async writeFileAtomic(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(path, bytes);
  }

  async copyFile(from: string, to: string): Promise<void> {
    this.files.set(to, this.files.get(from) ?? new Uint8Array());
  }

  async renameFile(from: string, to: string): Promise<void> {
    const bytes = this.files.get(from);
    if (!bytes) throw new Error(`ENOENT ${from}`);
    this.files.delete(from);
    this.files.set(to, bytes);
  }

  async removeFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async ensureDir(path: string): Promise<void> {
    this.dirs.add(path);
  }

  async removeDir(path: string): Promise<void> {
    this.dirs.delete(path);
    for (const key of [...this.files.keys()]) {
      if (key.startsWith(`${path}/`)) this.files.delete(key);
    }
  }

  async listDir(path: string): Promise<string[]> {
    return [...this.files.keys()]
      .filter((key) => key.startsWith(`${path}/`))
      .map((key) => key.slice(path.length + 1));
  }

  async stat(path: string): Promise<FileStat | null> {
    const bytes = this.files.get(path);
    if (bytes) return { size: bytes.length, mtimeMs: 0, isDirectory: false };
    if (this.dirs.has(path)) return { size: 0, mtimeMs: 0, isDirectory: true };
    return null;
  }

  async hashFile(path: string): Promise<string> {
    return `hash:${path}`;
  }

  async runProcess(): Promise<ProcessResult> {
    return { code: 0, stdout: "", stderr: "", timedOut: false };
  }

  async httpGet(
    url: string,
    destination: string,
    _timeoutMs: number,
  ): Promise<HttpResult> {
    this.requests.push(url);
    const response = this.responses.get(url) ?? this.responder(url);
    if (!response) throw new Error(`network down for ${url}`);
    this.files.set(destination, response.body ?? new Uint8Array());
    return { status: response.status, contentType: response.contentType };
  }

  env(): string | undefined {
    return undefined;
  }
}

export function jsonResponse(value: unknown): FakeResponse {
  return {
    status: 200,
    contentType: "application/json",
    body: new TextEncoder().encode(JSON.stringify(value)),
  };
}

export function pad(bytes: Uint8Array, length = 9_000): Uint8Array {
  if (bytes.length >= length) return bytes;
  const output = new Uint8Array(length);
  output.set(bytes);
  return output;
}

/** A JPEG header with a real SOF0, then padding. */
export function jpeg(width = 662, height = 1000): Uint8Array {
  const header = new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xc0, // SOF0
    0x00,
    0x11, // length
    0x08, // precision
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff,
    0x03, // components
    0x01,
    0x22,
    0x00,
    0x02,
    0x11,
    0x01,
    0x03,
    0x11,
    0x01,
  ]);
  return pad(header);
}

export function png(width = 800, height = 1200): Uint8Array {
  const header = new Uint8Array(33);
  header.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  header.set([0, 0, 0, 13, 73, 72, 68, 82], 8); // IHDR
  const view = new DataView(header.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return pad(header);
}
