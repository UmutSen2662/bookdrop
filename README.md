# Bookdrop

**Drop your ebooks in. Get one organized library with clean metadata and a reading log.**

![Bookdrop library grid](docs/screenshots/library.webp)

Bookdrop is a lightweight desktop app for Windows that turns a pile of ebook
files into one organized library. Drop EPUB, PDF, MOBI, AZW3, RTF, DOCX, HTML,
or TXT files anywhere in the window. Bookdrop converts them with calibre, fetches
metadata and covers, and files them into a single flat folder you can sync to
your e-reader.

## Highlights

- **Drag and drop ingestion.** Files are converted to EPUB and filed
  automatically. Anything that fails lands in a Needs attention list.
- **Metadata and covers.** Compare alternatives from the file, Google Books,
  Open Library, and iTunes. Re-fetching fills only empty fields and writes
  nothing until you save.
- **Reading log.** Track each book as Unread, Reading, or Finished, with private
  notes that stay in the app's database, not the EPUB.
- **Flat library, by design.** No `author/` or `series/` subfolders to navigate.
  If you move the library folder, books left behind are flagged until you move
  them.
- **Keyboard friendly.** Arrow keys move through the grid, `/` or `Ctrl+F`
  focuses search, and Escape clears search or selection.

![Metadata editor](docs/screenshots/metadata.webp)

## Why it's built this way

- **Metadata is never written silently.** Fetched values sit in the editor until
  you save, so the EPUB only changes when you ask it to.
- **Reading state lives apart from the books.** Status, notes, and pins are
  stored in SQLite, so the library folder stays a plain set of EPUBs that any
  device can read.
- **Missing files don't lose data.** If a library EPUB disappears, the book keeps
  its metadata, reading state, and notes, and is flagged in the grid with Open
  folder, Recheck, and Remove options.

## Tech stack

- **Desktop shell:** Tauri 2, Rust
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS
- **Data:** SQLite via `tauri-plugin-sql`
- **Testing:** Vitest, Cargo test
- **Tooling:** Bun, Biome

## Getting started

### Requirements

- Windows 10/11, 64-bit, with WebView2 (included in Windows 10 1803+ and Windows 11)
- [calibre](https://calibre-ebook.com/) (tested with 9.18), on `PATH` or set in
  Settings

Bookdrop calls calibre's command-line tools (`ebook-meta`, `ebook-convert`,
`fetch-ebook-metadata`). It does not bundle or link calibre, so install it
separately.

### Install

Download the latest installer from the Releases page.

The installer is not code-signed, so Windows may show "Windows protected your
PC." Choose **More info**, then **Run anyway**. Each release includes a
`SHA256SUMS.txt`. To verify a download in PowerShell:

```powershell
Get-FileHash .\Bookdrop_1.1.0_x64-setup.exe -Algorithm SHA256
```

Compare the result with the matching line in the checksums file.

Updates are built in. Bookdrop checks GitHub shortly after launch, and
**Check for updates** in the footer checks on demand. When a newer release is
found, clicking **Update available** downloads, installs, and reopens the app.
Version 1.0.0 predates the updater, so install 1.1.0 manually once; later
releases update themselves. Your library and `%LOCALAPPDATA%\bookdrop` data are
left in place either way.

## Development

You need Bun, Rust 1.90+ with the MSVC target, and the Visual Studio C++ build
tools. Run these from Windows, not WSL:

```bat
bun install
bun run tauri dev
```

To produce an installer, checksums, and the updater manifest:

```bat
set TAURI_SIGNING_PRIVATE_KEY=%USERPROFILE%\.tauri\bookdrop.key
set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=your-key-password
bun run tauri build
bun run checksums
bun run latest-json "What changed in this release"
```

The updater signs every build, so `tauri build` fails without the key. Upload
the NSIS installer, its `.sig` file, `SHA256SUMS.txt`, and `latest.json` to the
release. The app reads `latest.json` from the newest non-prerelease.

Common checks:

```bat
bun run test          :: Vitest: pipeline and helper tests
bun run typecheck     :: TypeScript
bun run lint          :: Biome formatting and linting
cd src-tauri && cargo test
```

The repository ships no books. Use your own files for manual testing; `samples/`
is git-ignored for local fixtures. `bun scripts/ingest.ts path\to\book.epub` runs
the same pipeline as the app and writes to the configured library and database.
Environment variables such as `BOOKDROP_HOME` and `BOOKDROP_LIBRARY` override the
config for scripts and tests.

## Your data

Runtime data (config, database, covers, temp files) lives in
`%LOCALAPPDATA%\bookdrop`. The library folder is yours to place and sync anywhere.

Reading status, notes, and pins exist only in the database, so back it up. Close
Bookdrop and copy the whole `%LOCALAPPDATA%\bookdrop` folder somewhere safe. EPUBs
can be re-imported and covers regenerated, but the database cannot be rebuilt.
To restore, close the app, put the folder back, and reopen. Settings → Data
folder opens the location for you.

## Privacy

Bookdrop has no telemetry and no account. Files stay on your machine. Launching
the app checks GitHub for a newer release; that request contains no library,
account, or usage data. Metadata lookups send a book's title, author, or ISBN to
Google Books and Open Library (through calibre), and to iTunes and Open Library
directly. Cover images are downloaded from those services.

## Not affiliated with calibre

Bookdrop is an independent project and is not affiliated with, endorsed by, or
sponsored by calibre, which is a separate application by Kovid Goyal. Bookdrop's
own code is MIT licensed and contains no calibre code.

## License

MIT © 2026 Umut Şen. See [LICENSE](LICENSE) and [THIRD-PARTY.md](THIRD-PARTY.md).
