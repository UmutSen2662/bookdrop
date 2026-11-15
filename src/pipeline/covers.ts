/**
 * The cover half of the pipeline: image headers, download validation, and
 * candidate storage. Provider lookups live in `sources/`; this file knows
 * nothing about which services exist.
 */
import type { Host } from "./host";
import { extname, joinPath, toForwardSlashes } from "./paths";
import type { CoverLink } from "./sources/types";
import type { CoverCandidate } from "./types";

const HTTP_TIMEOUT = 15_000;
const MIN_COVER_BYTES = 8 * 1024;
const MIN_COVER_SIDE = 300;

export type DownloadedCover = {
  source: string;
  path: string;
  width: number;
  height: number;
};

// ---------------------------------------------------------------------------
// image headers
// ---------------------------------------------------------------------------

export type ImageSize = { width: number; height: number };

function jpegSize(bytes: Uint8Array): ImageSize | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset++;
      continue;
    }
    const marker = bytes[offset + 1];
    // Standalone markers carry no length.
    if (
      marker === 0xd8 ||
      marker === 0xd9 ||
      marker === 0x01 ||
      (marker >= 0xd0 && marker <= 0xd7)
    ) {
      offset += 2;
      continue;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2) return null;
    const isStartOfFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // DHT
      marker !== 0xc8 && // JPG
      marker !== 0xcc; // DAC
    if (isStartOfFrame) {
      return {
        height: (bytes[offset + 5] << 8) | bytes[offset + 6],
        width: (bytes[offset + 7] << 8) | bytes[offset + 8],
      };
    }
    offset += 2 + length;
  }
  return null;
}

function pngSize(bytes: Uint8Array): ImageSize | null {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 24) return null;
  if (!signature.every((value, index) => bytes[index] === value)) return null;
  const width =
    ((bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19]) >>>
    0;
  const height =
    ((bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23]) >>>
    0;
  return width > 0 && height > 0 ? { width, height } : null;
}

export function imageSize(bytes: Uint8Array): ImageSize | null {
  return jpegSize(bytes) ?? pngSize(bytes);
}

// ---------------------------------------------------------------------------
// download
// ---------------------------------------------------------------------------

function extensionFor(contentType: string): string | null {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "image/jpeg" || type === "image/jpg") return "jpg";
  if (type === "image/png") return "png";
  return null;
}

/**
 * Download one candidate and validate it. Returns null for HTTP errors, a
 * non-image type, a tiny file, or an image under 300 px on its long side.
 * Failures are never fatal: a book can be filed without a fetched cover.
 */
export async function downloadCover(
  host: Host,
  link: CoverLink,
  directory: string,
): Promise<DownloadedCover | null> {
  const partial = joinPath(directory, `${link.source}.download`);
  try {
    const response = await host.httpGet(link.url, partial, HTTP_TIMEOUT);
    if (response.status !== 200) return null;
    const extension = extensionFor(response.contentType);
    if (!extension) return null;

    const bytes = await host.readFile(partial);
    if (bytes.length <= MIN_COVER_BYTES) return null;
    const size = imageSize(bytes);
    if (!size || Math.max(size.width, size.height) < MIN_COVER_SIDE)
      return null;

    const path = joinPath(directory, `${link.source}.${extension}`);
    await host.copyFile(partial, path);
    return { source: link.source, path, ...size };
  } catch {
    return null;
  } finally {
    await host.removeFile(partial).catch(() => undefined);
  }
}

/**
 * Copy downloaded covers into the app's candidate folder and describe them
 * relative to the config home dir. Each download gets a unique name so a
 * refresh never overwrites the image the row still points at; startup removes
 * the files a cancelled refresh leaves behind.
 */
export async function storeCoverCandidates(
  host: Host,
  homeDir: string,
  key: string,
  downloaded: DownloadedCover[],
): Promise<CoverCandidate[]> {
  if (downloaded.length === 0) return [];
  const destination = joinPath(homeDir, "candidates", key);
  await host.ensureDir(destination);
  const stamp = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
  const stored: CoverCandidate[] = [];
  for (const cover of downloaded) {
    const name = `${cover.source}-${stamp}${extname(cover.path)}`;
    await host.copyFile(cover.path, joinPath(destination, name));
    stored.push({
      path: toForwardSlashes(`candidates/${key}/${name}`),
      source: cover.source,
      width: cover.width,
      height: cover.height,
    });
  }
  return stored;
}
