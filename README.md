# tedit

An Electron desktop application for editing Typst documents with Monaco, live compiler diagnostics, tabs, and a synchronized PDF preview.

*This App is 100% vibe coded for my own purposes. It just puts together already existing pieces: electron, typst, tinymist, the monaco editor &amp; pdf.js. As of right now it is intended to be fo personal use only, which means no support or guarantees are given.*

## Run locally

```sh
npm install
npm run package-docs
npm run package-tinymist
npm run dev
```

`npm run dev` starts Vite and opens the Electron window automatically.

`npm run package-docs` builds and stages the offline Typst documentation from `../typst`. The checkout must match the Typst version embedded in Tinymist (`0.15.0`). Pass another checkout with `npm run package-docs -- /path/to/typst` or set `TYPST_SOURCE_DIR`. The first Rust build can take several minutes; subsequent builds are incremental. `npm run package-tinymist` downloads the platform binary and verifies its upstream SHA-256 checksum.

## Build

```sh
npm run dist
```

Installers are written to `release/`. `npm run dist` packages the Typst docs and Tinymist automatically. Use `npm run build` when you only need to validate the renderer production build.

The desktop app stores its open-file session in the operating system cache directory. On restart, existing files are reopened in their previous tab order and the active tab is restored; missing files are skipped.

The bundled Tinymist process is the single Typst backend for diagnostics and PDF compilation. PDF export uses Tinymist's in-memory LSP document, so unsaved edits compile without temporary source files.

## Offline documentation

The **Docs** toolbar button opens the official generated Typst documentation inside tedit. The complete static site, including its search index, is staged in `resources/typst-docs` and packaged as an Electron extra resource. Release CI builds the docs once from the pinned Typst revision and shares the platform-neutral result across all installer jobs.

## Source synchronization

For saved documents, tedit runs a Tinymist preview sidecar to map Monaco cursor positions to PDF page coordinates. The current editing location is scrolled into view and highlighted without replacing the PDF.js renderer.

Tinymist is resolved in this order:

1. `TINYMIST_PATH`
2. The packaged Tinymist `0.15.2` binary
3. A `tinymist` executable on `PATH` during development

The dot beside **PDF Preview** shows synchronization status. Hover it for details. Unsaved documents must be saved before source synchronization can start.
