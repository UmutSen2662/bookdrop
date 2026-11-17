# Bookdrop

Bookdrop is a Windows app that keeps your ebooks in one tidy library. Drop
EPUB, PDF, MOBI, AZW3, RTF, DOCX, HTML, or TXT files into the window. It
converts them to EPUB, looks up the title, author, and cover, and saves them
into a single folder you can copy to your e-reader. It also keeps a simple
reading log for each book.

**[Download the latest version from the Releases page](https://github.com/UmutSen2662/bookdrop/releases)**

![Bookdrop library grid](docs/screenshots/library.webp)

## What it does

- **Adds books by drag and drop.** Files are converted to EPUB and filed
  automatically. Anything that fails goes into a Needs attention list.
- **Fills in metadata and covers.** It looks up details from the file itself,
  Google Books, Open Library, and iTunes, and lets you pick the best match.
  Nothing changes in a book until you save.
- **Tracks reading.** Mark each book as Unread, Reading, or Finished, and add
  private notes. Notes are stored in Bookdrop's database, not inside the EPUB.
- **Keeps one flat folder.** There are no author or series subfolders. If you
  move the library folder, books left behind are flagged until you move them.
- **Works with the keyboard.** Arrow keys move through the grid, `/` or
  `Ctrl+F` jumps to search, and Escape clears search or the selection.
- **Shares over Wi-Fi.** You can send books to a KOReader device on the same
  network without a cable. See below.

![Metadata editor](docs/screenshots/metadata.webp)

## How it works

- **Metadata is only saved when you ask.** Fetched values stay in the editor
  until you press save.
- **Reading status lives apart from the books.** Status, notes, and pins are in
  a SQLite database, so the library folder is just a set of EPUB files that any
  device can read.
- **Missing files don't lose data.** If an EPUB disappears from the library, the
  book keeps its metadata, status, and notes. It is flagged in the grid with
  Open folder, Recheck, and Remove options.
- **The network is off unless you turn sharing on.** Bookdrop only listens for
  connections while sharing is active, and the catalog goes away when you close
  the app.

## Sending books to a reader over Wi-Fi

Click **Share over Wi-Fi** in the footer. Bookdrop shows an address such as
`http://192.168.1.5:8099/opds`, a Copy button, and how many books are included.

1. On a device running [KOReader](https://koreader.rocks/), open the search
   menu, choose **OPDS catalog**, then **Add catalog**, and paste the address.
2. Browse the list and download the EPUBs you want.
3. Click **Stop sharing** when you are done. Sharing also stops when you close
   Bookdrop or lose the network.

The catalog includes every book that has a readable file, including books still
in Needs attention. Books that are missing, failed to convert, or have no file
are left out. The list is sorted by title and can be searched from KOReader.

Some things to know:

- The connection is plain HTTP on your local network, with no password. Anyone
  on the same network who has the address can see and download the library. Only
  share on networks you trust, and stop sharing when you are finished.
- The port is 8099, so it does not clash with calibre's server on 8080.
- The first time, Windows may ask whether to let Bookdrop through the firewall.
  If the reader cannot connect, check that prompt, and check whether the network
  is set to Public.
- The address changes if the computer's IP address changes. Each address is
  labelled with its network adapter (Wi-Fi, VPN, vEthernet), and only the one on
  the reader's network will work. To keep the address stable, set a DHCP
  reservation on your router. Bookdrop refreshes the list each time you open it.
- Names like `terra.local` need mDNS support on the reader. Kindle firmware does
  not have it, so use the IP address on a Kindle.
- Sharing only works while Bookdrop is open. Nothing is uploaded anywhere.

## Getting started

### What you need

- Windows 10 or 11, 64-bit, with WebView2 (included in Windows 10 version 1803
  and later, and in Windows 11)
- [calibre](https://calibre-ebook.com/) (tested with version 9.18), either on
  your `PATH` or set in Bookdrop's Settings

Bookdrop uses calibre's command-line tools (`ebook-meta`, `ebook-convert`, and
`fetch-ebook-metadata`) to do the conversion and metadata work. calibre is not
bundled with Bookdrop, so install it separately.

### Install

Go to the [Releases page](https://github.com/UmutSen2662/bookdrop/releases) and
download the latest installer.

Because the installer is not code-signed, Windows may show "Windows protected
your PC." Click **More info**, then **Run anyway**.

Each release also includes a `SHA256SUMS.txt` file. To check your download, run
this in PowerShell:

```powershell
Get-FileHash .\Bookdrop_*_x64-setup.exe -Algorithm SHA256
```

Compare the result with the matching line in the checksums file.

Bookdrop updates itself. It checks GitHub shortly after you open it, and you can
check manually with **Check for updates** in the footer. When a new version is
ready, click **Update available** and the app will install it and restart.
Versions before 1.1.0 did not have this feature, so install the latest release
manually once. Your library and the data in `%LOCALAPPDATA%\bookdrop` are kept
either way.

## Development

You need Bun, Rust 1.90 or later with the MSVC target, and the Visual Studio C++
build tools. Run these from Windows, not WSL:

```bat
bun install
bun run tauri dev
```

To build an installer, checksums, and the updater manifest, set the signing key
in the same window that runs the build:

```bat
set TAURI_SIGNING_PRIVATE_KEY=%USERPROFILE%\.tauri\bookdrop.key
set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=your-key-password
bun run tauri build
bun run checksums
bun run latest-json "What changed in this release"
```

Environment variables only apply in the window where you set them. If you open
another terminal, or set them in one tab and build in another, you will see
"a public key has been found, but no private key." In PowerShell, use the
`$env:` form instead, since `set` only creates a local variable there and the
build will still fail:

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = "$env:USERPROFILE\.tauri\bookdrop.key"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "your-key-password"
bun run tauri build
```

Generate the key once and keep it outside the repository:

```bat
bunx tauri signer generate -w %USERPROFILE%\.tauri\bookdrop.key
```

Store the password somewhere safe. If you make a new key pair, you must update
`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. Installed copies only
trust the key they shipped with, so they will reject builds signed with a
different key.

The build fails without the key, because every build is signed for the updater.
When publishing a release, upload the NSIS installer, its `.sig` file,
`SHA256SUMS.txt`, and `latest.json`. The app reads `latest.json` from the newest
non-prerelease.

Common checks:

```bat
bun run test          :: Vitest: pipeline and helper tests
bun run typecheck     :: TypeScript
bun run lint          :: Biome formatting and linting
cd src-tauri && cargo test
```

The repository contains no books. For manual testing, use your own files.
`samples/` is git-ignored for local test files. `bun scripts/ingest.ts path\to\book.epub`
runs the same steps as the app and writes to the configured library and
database. Environment variables such as `BOOKDROP_HOME` and `BOOKDROP_LIBRARY`
override the config for scripts and tests.

### Tech stack

- **Desktop shell:** Tauri 2, Rust
- **Frontend:** React 19, TypeScript, Vite, Tailwind CSS
- **Data:** SQLite via `tauri-plugin-sql`
- **Testing:** Vitest, Cargo test
- **Tooling:** Bun, Biome

## Your data

Bookdrop's own data (config, database, covers, temporary files) is stored in
`%LOCALAPPDATA%\bookdrop`. The library folder can be anywhere you like, and you
can sync it to any device.

Reading status, notes, and pins are only stored in the database, so back it up.
Close Bookdrop, then copy the whole `%LOCALAPPDATA%\bookdrop` folder somewhere
safe. EPUBs can be re-imported and covers can be regenerated, but the database
cannot be rebuilt. To restore, close the app, put the folder back in place, and
reopen Bookdrop. **Settings → Data folder** opens the location for you.

## Privacy

Bookdrop has no telemetry and no account. Your files stay on your computer.

When the app starts, it checks GitHub for a newer release. That request contains
no library, account, or usage information. When you look up metadata, the book's
title, author, or ISBN is sent to Google Books and Open Library (through calibre),
and to iTunes and Open Library directly. Covers are downloaded from those
services.

Sharing over Wi-Fi is the only feature that listens on the network, and only
while you have it turned on. The catalog and the EPUBs it serves stay on your
local network. Nothing is uploaded. Anyone who can reach the address can see the
catalog, so treat the address the way you would treat the library itself.

## Not affiliated with calibre

Bookdrop is an independent project. It is not affiliated with, endorsed by, or
sponsored by calibre, which is a separate application by Kovid Goyal. Bookdrop's
own code is MIT licensed and contains no calibre code.

## License

MIT © 2026 Umut Şen. See [LICENSE](LICENSE) and [THIRD-PARTY.md](THIRD-PARTY.md).
