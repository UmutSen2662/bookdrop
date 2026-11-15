# Third-party notices

Bookdrop's own source is MIT licensed (see `LICENSE`). It builds on the
following projects. Full license texts ship with each package in
`node_modules/` and in the Rust crate sources referenced by
`src-tauri/Cargo.lock`.

## Runtime libraries

| Project | License |
| --- | --- |
| React, React DOM | MIT |
| Tauri and its official plugins (dialog, opener, SQL, window-state, single-instance) | MIT OR Apache-2.0 |
| Base UI (`@base-ui/react`) | MIT |
| Tailwind CSS | MIT |
| tw-animate-css | MIT |
| class-variance-authority | Apache-2.0 |
| `cn` | MIT |
| Lucide icons (`lucide-react`) | ISC |
| `@xmldom/xmldom` | MIT |
| `fflate` | MIT |
| shadcn/ui | MIT |

## Rust dependencies

The Rust dependencies declared in `src-tauri/Cargo.toml` — Tauri, Serde,
`sha2`, `base64`, `image`, and `reqwest` — are dual-licensed under MIT and/or
Apache-2.0. Transitive dependencies under `src-tauri/Cargo.lock` carry their
own MIT, Apache-2.0, BSD, ISC, or Unicode licenses; their texts are available
from the crates.io packages.

## Not included

- **calibre** is not bundled, linked, or redistributed. Bookdrop invokes its
  command-line tools when calibre is installed separately. calibre is a
  separate project by Kovid Goyal, licensed under GPLv3.
- **WebView2** is supplied by Windows and is not part of this repository.
- No book files are distributed with this repository.
