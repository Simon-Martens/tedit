import { spawn } from 'node:child_process'
import { access, cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { TINYMIST_TYPST_VERSION } = require('../electron/tinymist-release.cjs')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.resolve(
  projectRoot,
  process.argv[2] ?? process.env.TYPST_SOURCE_DIR ?? '../typst',
)
const generatedSite = path.join(sourceRoot, 'docs', 'dist', 'site')
const resourcesRoot = path.join(projectRoot, 'resources')
const outputRoot = path.join(resourcesRoot, 'typst-docs')
const temporaryRoot = `${outputRoot}.tmp`
const scrollbarStyles = `
:root {
  scrollbar-gutter: auto;
}

body.docs > .main-grid {
  padding-top: 18px;
}

@media screen and (min-width: 696px) {
  body.docs > header {
    display: none;
  }
}

:root {
  scrollbar-color: #aeb2a6 transparent;
  scrollbar-width: thin;
}

::-webkit-scrollbar {
  width: 10px;
  height: 10px;
  background: transparent;
}

::-webkit-scrollbar-track,
::-webkit-scrollbar-track-piece,
::-webkit-scrollbar-corner {
  background: transparent;
  box-shadow: none;
}

::-webkit-scrollbar-thumb {
  border: 0;
  border-radius: 0;
  background: #aeb2a6;
}

::-webkit-scrollbar-thumb:hover {
  background: #8f9487;
}

::-webkit-scrollbar-button {
  display: none;
  width: 0;
  height: 0;
}
`.trimStart()
const documentationStateScript = `
const lastRouteKey = 'tedit.docs.last-route';
const homeParameter = 'tedit-home';
const url = new URL(window.location.href);
const returningHome = url.searchParams.has(homeParameter);
let redirecting = false;

if (returningHome) {
  url.searchParams.delete(homeParameter);
  history.replaceState(null, '', url.pathname + url.search + url.hash);
  localStorage.setItem(lastRouteKey, '/');
  window.scrollTo(0, 0);
} else {
  const savedRoute = localStorage.getItem(lastRouteKey);
  if (window.location.pathname === '/' && savedRoute && savedRoute !== '/') {
    redirecting = true;
    window.location.replace(savedRoute);
  }
}

function currentRoute() {
  return window.location.pathname + window.location.search + window.location.hash;
}

function scrollKey() {
  return 'tedit.docs.scroll:' + currentRoute();
}

function savePosition() {
  localStorage.setItem(lastRouteKey, currentRoute());
  localStorage.setItem(scrollKey(), String(window.scrollY));
}

const savedScroll = !returningHome && !redirecting
  ? Number(localStorage.getItem(scrollKey()))
  : 0;
let restoring = Number.isFinite(savedScroll) && savedScroll > 0;

if (restoring) {
  window.addEventListener('load', () => {
    const behavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    window.scrollTo(0, savedScroll);
    requestAnimationFrame(() => {
      document.documentElement.style.scrollBehavior = behavior;
      restoring = false;
      savePosition();
    });
  }, { once: true });
}

if (!redirecting) {
  let saveTimer;
  window.addEventListener('scroll', () => {
    if (restoring) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(savePosition, 80);
  }, { passive: true });
  window.addEventListener('hashchange', savePosition);
  window.addEventListener('pagehide', savePosition);
  if (!restoring) savePosition();
}
`.trimStart()

function run(command, args, cwd, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === 'win32',
      stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    })
    let stdout = ''
    if (capture) child.stdout.on('data', (chunk) => { stdout += chunk })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve(stdout.trim())
      else reject(new Error(`${command} exited with code ${code}`))
    })
  })
}

async function injectScrollbarStyles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await injectScrollbarStyles(entryPath)
    } else if (entry.name.endsWith('.html')) {
      const html = await readFile(entryPath, 'utf8')
      await writeFile(entryPath, html.replace(
        '</head>',
        '<link href="/assets/tedit-scrollbars.css" rel="stylesheet">'
        + '<script src="/assets/tedit-state.js"></script></head>',
      ))
    }
  }))
}

await access(path.join(sourceRoot, 'docs', 'Cargo.toml')).catch(() => {
  throw new Error(
    `Typst source not found at ${sourceRoot}. Pass a path to "npm run package-docs -- <path>" `
    + 'or set TYPST_SOURCE_DIR.',
  )
})
const typstManifest = await readFile(path.join(sourceRoot, 'Cargo.toml'), 'utf8')
const typstVersion = /\[workspace\.package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/.exec(typstManifest)?.[1]
if (typstVersion !== TINYMIST_TYPST_VERSION) {
  throw new Error(
    `Typst documentation ${typstVersion ?? 'version could not be determined'} does not match `
    + `Tinymist's Typst ${TINYMIST_TYPST_VERSION}.`,
  )
}

await run('cargo', ['docit', 'compile'], sourceRoot)
await Promise.all([
  access(path.join(generatedSite, 'index.html')),
  access(path.join(generatedSite, 'assets', 'search.json')),
])

const [commit, description] = await Promise.all([
  run('git', ['rev-parse', 'HEAD'], sourceRoot, true),
  run('git', ['describe', '--tags', '--always', '--dirty'], sourceRoot, true),
])
const packageVersion = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8')).version

await mkdir(resourcesRoot, { recursive: true })
await rm(temporaryRoot, { recursive: true, force: true })
await mkdir(path.join(temporaryRoot, 'licenses'), { recursive: true })
await Promise.all([
  cp(generatedSite, path.join(temporaryRoot, 'site'), { recursive: true }),
  cp(path.join(sourceRoot, 'LICENSE'), path.join(temporaryRoot, 'licenses', 'LICENSE-TYPST')),
  cp(path.join(sourceRoot, 'NOTICE'), path.join(temporaryRoot, 'licenses', 'NOTICE-TYPST')),
  writeFile(path.join(temporaryRoot, 'manifest.json'), `${JSON.stringify({
    name: 'Typst documentation',
    source: 'https://github.com/typst/typst',
    commit,
    description,
    typstVersion,
    packagedBy: `tedit ${packageVersion}`,
  }, null, 2)}\n`),
])
await writeFile(path.join(temporaryRoot, 'site', 'assets', 'tedit-scrollbars.css'), scrollbarStyles)
await writeFile(path.join(temporaryRoot, 'site', 'assets', 'tedit-state.js'), documentationStateScript)
await injectScrollbarStyles(path.join(temporaryRoot, 'site'))
await rm(outputRoot, { recursive: true, force: true })
await rename(temporaryRoot, outputRoot)

console.log(`Packaged Typst documentation from ${description} into ${outputRoot}`)
