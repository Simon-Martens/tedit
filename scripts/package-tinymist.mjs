import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { chmod, copyFile, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import extractZip from 'extract-zip'
import * as tar from 'tar'

const require = createRequire(import.meta.url)
const { TINYMIST_TARGETS, TINYMIST_VERSION } = require('../electron/tinymist-release.cjs')
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const arguments_ = process.argv.slice(2)

function option(name, fallback) {
  const index = arguments_.indexOf(name)
  return index === -1 ? fallback : arguments_[index + 1]
}

const platform = option('--platform', process.platform)
const architecture = option('--arch', process.arch)
const platformTarget = `${platform}-${architecture}`
const releaseTarget = TINYMIST_TARGETS[platformTarget]
if (!releaseTarget) throw new Error(`Tinymist is not available for ${platformTarget}.`)

const archiveName = `tinymist-${releaseTarget}`
const releaseBase = `https://github.com/Myriad-Dreamin/tinymist/releases/download/v${TINYMIST_VERSION}`
const licenseUrl = `https://raw.githubusercontent.com/Myriad-Dreamin/tinymist/v${TINYMIST_VERSION}/LICENSE`
const outputDirectory = path.join(projectRoot, 'resources', 'tinymist', platformTarget)
const executableName = platform === 'win32' ? 'tinymist.exe' : 'tinymist'
const executablePath = path.join(outputDirectory, executableName)
const archivePath = path.join(outputDirectory, archiveName)

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}: ${url}`)
  return Buffer.from(await response.arrayBuffer())
}

await rm(outputDirectory, { recursive: true, force: true })
await mkdir(outputDirectory, { recursive: true })
const [archive, checksumFile, license] = await Promise.all([
  download(`${releaseBase}/${archiveName}`),
  download(`${releaseBase}/${archiveName}.sha256`),
  download(licenseUrl),
])
const expectedChecksum = checksumFile.toString('utf8').trim().split(/\s+/)[0]
const actualChecksum = crypto.createHash('sha256').update(archive).digest('hex')
if (actualChecksum !== expectedChecksum) throw new Error('Tinymist download checksum did not match.')

await writeFile(archivePath, archive)
if (releaseTarget.endsWith('.zip')) await extractZip(archivePath, { dir: outputDirectory })
else await tar.x({ file: archivePath, cwd: outputDirectory })
await rm(archivePath)

const extractedFiles = await readdir(outputDirectory, { recursive: true })
const extractedExecutable = extractedFiles.find((file) => path.basename(file) === executableName)
if (!extractedExecutable) throw new Error(`The Tinymist archive did not contain ${executableName}.`)
const extractedPath = path.resolve(outputDirectory, extractedExecutable)
if (extractedPath !== executablePath) await copyFile(extractedPath, executablePath)
if (platform !== 'win32') await chmod(executablePath, 0o755)
const stagedEntries = await readdir(outputDirectory)
await Promise.all(stagedEntries
  .filter((entry) => entry !== executableName)
  .map((entry) => rm(path.join(outputDirectory, entry), { recursive: true, force: true })))
await writeFile(path.join(outputDirectory, 'LICENSE-TINYMIST'), license)

console.log(`Packaged Tinymist ${TINYMIST_VERSION} for ${platformTarget}.`)
