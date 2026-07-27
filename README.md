# Typst Edit

An Electron desktop application for editing a single Typst document with Monaco, live compiler diagnostics, and a PDF preview.

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
