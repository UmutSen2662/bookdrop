/** JSON.parse for a downloaded body; null for anything malformed. */
export function parseJson<T>(bytes: Uint8Array): T | null {
  try {
    return JSON.parse(new TextDecoder("utf-8").decode(bytes)) as T;
  } catch {
    return null;
  }
}
