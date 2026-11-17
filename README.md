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
- **Wireless transfer.** Share the library over Wi-Fi as an OPDS catalog and
  pull books straight onto a KOReader device, no cable and no calibre server.

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
- **Sharing is a session, not a setting.** Nothing listens on the network until
  you ask it to, and the catalog is gone when you close the app.

## Send books to your reader over Wi-Fi

Drop the cable. **Share over Wi-Fi** in the footer turns the library into an
[OPDS](https://opds.io/) catalog that a reader on the same network can browse.

1. Click **Share over Wi-Fi** in the footer. Bookdrop shows an address such as
   `http://192.168.1.5:8099/opds`, a Copy button, and how many books are
   included.
2. On a device running [KOReader](https://koreader.rocks/), open the search
   menu → **OPDS catalog** → **Add catalog**, and paste that address.
3. Browse and download EPUBs. Sharing ends when you click **Stop sharing**,
   close Bookdrop, or lose the network.

The catalog has every book with a readable file, including books still marked
Needs attention. It is sorted by title and searchable from KOReader. Books that
are missing, failed to convert, or have no file are left out.

A few practical notes:

- It is plain HTTP on your local network, with no account. Anyone who can reach
  the address can browse and download the library, so share on networks you
  trust and stop when you are done. The popover says this every time.
- The port is 8099, deliberately away from calibre's content server on 8080.
- Windows may ask to let Bookdrop through the firewall the first time. If the
  reader cannot connect, check that prompt and whether the network is marked
  public.
- The address changes when the computer's IP address changes. Each candidate is
  labelled with its adapter (Wi-Fi, VPN, vEthernet) because only the one on the
  reader's network can reach it. A DHCP reservation on the router keeps the
  address stable; Bookdrop refreshes the list whenever you open it.
- Names such as `terra.local` need mDNS on the reader. Kindle firmware does not
  provide it, so use the IP address there.
- Sharing only works while Bookdrop is open. Nothing is uploaded anywhere.

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
Get-FileHash .\Bookdrop_*_x64-setup.exe -Algorithm SHA256
```

Compare the result with the matching line in the checksums file.

Updates are built in. Bookdrop checks GitHub shortly after launch, and
**Check for updates** in the footer checks on demand. When a newer release is
found, clicking **Update available** downloads, installs, and reopens the app.
Versions before 1.1.0 predate the updater, so install the latest release
manually once; from 1.1.0 on, updates happen in place. Your library and
`%LOCALAPPDATA%\bookdrop` data are left in place either way.

## Development

You need Bun, Rust 1.90+ with the MSVC target, and the Visual Studio C++ build
tools. Run these from Windows, not WSL:

```bat
bun install
bun run tauri dev
```

To produce an installer, checksums, and the updater manifest, set the signing
key in the same window that runs the build:

```bat
set TAURI_SIGNING_PRIVATE_KEY=%USERPROFILE%\.tauri\bookdrop.key
set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=your-key-password
bun run tauri build
bun run checksums
bun run latest-json "What changed in this release"
```

Environment variables live only in the window that sets them. Opening another
terminal, or setting them in one tab and building in another, gives "a public
key has been found, but no private key." PowerShell needs the `$env:` form:
`set` there only creates a local variable, and the build still fails.

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\bookdrop.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "your-key-password"
bun run tauri build
```

The key is generated once and kept outside the repository:

```bat
bunx tauri signer generate -w %USERPROFILE%\.tauri\bookdrop.key
```

Store its password somewhere safe. A new key pair means a new
`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, and installed copies
only trust the key they shipped with, so they reject builds signed by a
different one.

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

Sharing over Wi-Fi is the one thing that listens on a network, and only while
you keep it on: the catalog and the EPUBs it serves stay on your local network,
Bookdrop does not phone home, and nothing is uploaded. Anyone who can reach the
address can read the catalog, so treat the address like the library itself.

## Not affiliated with calibre

Bookdrop is an independent project and is not affiliated with, endorsed by, or
sponsored by calibre, which is a separate application by Kovid Goyal. Bookdrop's
own code is MIT licensed and contains no calibre code.

## License

MIT © 2026 Umut Şen. See [LICENSE](LICENSE) and [THIRD-PARTY.md](THIRD-PARTY.md).
