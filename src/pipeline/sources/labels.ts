/**
 * Display names for source ids. Kept free of runtime imports so the UI can use
 * it without pulling in the network layer.
 */
const LABELS: Record<string, string> = {
  file: "In the file",
  google_openlibrary: "Google / Open Library",
  itunes: "iTunes",
  open_library: "Open Library",
  upload: "Uploaded",
};

/** A stored id we have no name for is shown as-is, not hidden. */
export function sourceLabel(id: string): string {
  return LABELS[id] ?? id;
}
