# Typst Edit

An Electron desktop application for editing Typst documents with Monaco, live compiler diagnostics, tabs, and a synchronized PDF preview.

## Run locally

```sh
npm install
npm run dev
```

`npm run dev` starts Vite and opens the Electron window automatically.

## Build

```sh
npm run dist
```

Installers are written to `release/`. Use `npm run build` when you only need to validate the renderer production build.

The Typst compiler runs in the Electron renderer through WebAssembly. Font families referenced by Typst `font:` settings are loaded from the operating system; bundled Libertinus text fonts and New Computer Modern Math remain available as offline fallbacks.

## Source synchronization

For saved documents, Typst Edit runs a Tinymist preview sidecar to map Monaco cursor positions to PDF page coordinates. The current editing location is scrolled into view and highlighted without replacing the PDF.js renderer.

Tinymist is resolved in this order:

1. `TINYMIST_PATH`
2. A `tinymist` executable on `PATH`
3. Tinymist `0.15.2`, downloaded and checksum-verified in the application data directory

The dot beside **PDF Preview** shows synchronization status. Hover it for details. Unsaved documents must be saved before source synchronization can start.
