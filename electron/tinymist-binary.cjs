const crypto = require('node:crypto')
const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { promisify } = require('node:util')
const extractZip = require('extract-zip')
const tar = require('tar')
const yauzl = require('yauzl')
const { app } = require('electron')
const {
  TINYMIST_TARGETS,
  TINYMIST_TYPST_VERSION,
  TINYMIST_VERSION,
} = require('./tinymist-release.cjs')

const execFileAsync = promisify(execFile)
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
const MAX_EXTRACTED_BYTES = 512 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 128
const RELEASE_BASE = `https://github.com/Myriad-Dreamin/tinymist/releases/download/v${TINYMIST_VERSION}`
const progressListeners = new Set()
let resolvingBinary

function emitProgress(message) {
  console.info(`[tedit:tinymist-install] ${message}`)
  for (const listener of progressListeners) {
    try {
      listener(message)
    } catch {}
  }
}

function executableName(platform = process.platform) {
  return platform === 'win32' ? 'tinymist.exe' : 'tinymist'
}

async function inspectTinymist(command) {
  try {
    const { stdout, stderr } = await execFileAsync(command, ['--version'], {
      timeout: 10_000,
      windowsHide: true,
    })
    const output = `${stdout}\n${stderr}`
    const typstVersion = /Typst Version:\s*([^\s]+)/i.exec(output)?.[1]
    return {
      compatible: typstVersion === TINYMIST_TYPST_VERSION,
      output: output.trim(),
      typstVersion,
    }
  } catch (error) {
    return {
      compatible: false,
      output: error instanceof Error ? error.message : String(error),
    }
  }
}

async function executableFile(filePath) {
  try {
    const stats = await fs.stat(filePath)
    if (!stats.isFile()) return false
    if (process.platform !== 'win32') await fs.access(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function findCompatibleTinymistOnPath() {
  const directories = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)
  if (process.platform === 'darwin') directories.push('/opt/homebrew/bin', '/usr/local/bin')
  const extensions = process.platform === 'win32' ? ['.exe'] : ['']
  for (const directory of [...new Set(directories)]) {
    for (const extension of extensions) {
      const candidate = path.resolve(directory, `tinymist${extension}`)
      const compatible = await validateCandidate(candidate, `Tinymist from PATH (${candidate})`)
      if (compatible) return compatible
    }
  }
  return undefined
}

function cachePaths() {
  const platformTarget = `${process.platform}-${process.arch}`
  const target = TINYMIST_TARGETS[platformTarget]
  if (!target) {
    throw new Error(`Tinymist ${TINYMIST_VERSION} is not available for ${platformTarget}.`)
  }
  const versionDirectory = path.join(app.getPath('userData'), 'tinymist', `v${TINYMIST_VERSION}`)
  const installDirectory = path.join(versionDirectory, platformTarget)
  return {
    binaryPath: path.join(installDirectory, executableName()),
    installDirectory,
    platformTarget,
    target,
    versionDirectory,
  }
}

async function validateCandidate(candidate, label) {
  if (!candidate || !await executableFile(candidate)) return undefined
  const inspection = await inspectTinymist(candidate)
  if (inspection.compatible) {
    emitProgress(`Using ${label} with Typst ${TINYMIST_TYPST_VERSION}.`)
    return candidate
  }
  const foundVersion = inspection.typstVersion ? `Typst ${inspection.typstVersion}` : 'an unknown Typst version'
  emitProgress(`Ignoring ${label}; it contains ${foundVersion}, not Typst ${TINYMIST_TYPST_VERSION}.`)
  return undefined
}

async function downloadArchive(url, destination, expectedChecksum) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 300_000)
  let file
  try {
    const response = await fetch(url, { redirect: 'follow', signal: controller.signal })
    if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`)
    if (!response.body) throw new Error('Tinymist download returned an empty response.')
    const totalBytes = Number(response.headers.get('content-length')) || undefined
    if (totalBytes && totalBytes > MAX_ARCHIVE_BYTES) throw new Error('Tinymist archive exceeds the download limit.')
    const hash = crypto.createHash('sha256')
    const reader = response.body.getReader()
    file = await fs.open(destination, 'wx')
    let receivedBytes = 0
    let reportedPercent = -1
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      receivedBytes += value.byteLength
      if (receivedBytes > MAX_ARCHIVE_BYTES) throw new Error('Tinymist archive exceeds the download limit.')
      const chunk = Buffer.from(value)
      hash.update(chunk)
      let offset = 0
      while (offset < chunk.length) {
        const { bytesWritten } = await file.write(chunk, offset)
        if (!bytesWritten) throw new Error('Could not write the Tinymist archive.')
        offset += bytesWritten
      }
      if (totalBytes) {
        const percent = Math.min(100, Math.floor((receivedBytes / totalBytes) * 100))
        if (percent >= reportedPercent + 5) {
          reportedPercent = percent
          emitProgress(`Downloading Tinymist ${TINYMIST_VERSION} (${percent}%)...`)
        }
      }
    }
    await file.close()
    file = undefined
    emitProgress(`Verifying Tinymist ${TINYMIST_VERSION} download...`)
    const actualChecksum = hash.digest('hex')
    if (actualChecksum !== expectedChecksum) throw new Error('Tinymist download checksum did not match.')
  } catch (error) {
    await file?.close().catch(() => undefined)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function createArchiveGuard() {
  let entries = 0
  let extractedBytes = 0
  return (entryPath, entrySize = 0, entryType) => {
    const normalized = path.posix.normalize(entryPath.replaceAll('\\', '/'))
    if (normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
      throw new Error('Tinymist archive contained an unsafe path.')
    }
    if (['SymbolicLink', 'Link'].includes(entryType)) {
      throw new Error('Tinymist archive contained a link.')
    }
    entries += 1
    extractedBytes += Number(entrySize) || 0
    if (entries > MAX_ARCHIVE_ENTRIES) throw new Error('Tinymist archive contains too many entries.')
    if (extractedBytes > MAX_EXTRACTED_BYTES) throw new Error('Tinymist archive is too large when extracted.')
  }
}

function validateZipArchive(archivePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { lazyEntries: true }, (openError, zipFile) => {
      if (openError || !zipFile) {
        reject(openError ?? new Error('Could not read the Tinymist ZIP archive.'))
        return
      }
      const guardEntry = createArchiveGuard()
      let settled = false
      const fail = (error) => {
        if (settled) return
        settled = true
        zipFile.close()
        reject(error)
      }
      zipFile.on('error', fail)
      zipFile.on('entry', (entry) => {
        try {
          const unixMode = entry.externalFileAttributes >>> 16
          const entryType = (unixMode & 0o170000) === 0o120000 ? 'SymbolicLink' : undefined
          guardEntry(entry.fileName, entry.uncompressedSize, entryType)
          zipFile.readEntry()
        } catch (error) {
          fail(error)
        }
      })
      zipFile.on('end', () => {
        if (settled) return
        settled = true
        resolve()
      })
      zipFile.readEntry()
    })
  })
}

async function extractArchive(archivePath, destination, asset) {
  if (asset.endsWith('.zip')) {
    await validateZipArchive(archivePath)
    await extractZip(archivePath, { dir: destination })
  } else {
    const guardEntry = createArchiveGuard()
    await tar.x({
      cwd: destination,
      file: archivePath,
      filter: (entryPath, entry) => {
        guardEntry(entryPath, entry.size, entry.type)
        return true
      },
      preservePaths: false,
      strict: true,
    })
  }
}

async function findExtractedBinaries(directory, name, matches = []) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Tinymist archive contained a symbolic link.')
    if (entry.isDirectory()) {
      await findExtractedBinaries(entryPath, name, matches)
    } else if (entry.isFile() && entry.name === name) {
      matches.push(entryPath)
    }
  }
  return matches
}

async function installTinymist(paths) {
  await fs.mkdir(paths.versionDirectory, { recursive: true })
  const staleInstallPrefix = `.install-${paths.platformTarget}-`
  const staleEntries = await fs.readdir(paths.versionDirectory)
  await Promise.all(staleEntries
    .filter((entry) => entry.startsWith(staleInstallPrefix))
    .map((entry) => fs.rm(path.join(paths.versionDirectory, entry), { recursive: true, force: true })))
  const temporaryRoot = path.join(
    paths.versionDirectory,
    `.install-${paths.platformTarget}-${process.pid}-${crypto.randomBytes(6).toString('hex')}`,
  )
  const archivePath = path.join(temporaryRoot, paths.target.asset)
  const extractedDirectory = path.join(temporaryRoot, 'extracted')
  const candidateDirectory = path.join(temporaryRoot, 'installed')
  const candidatePath = path.join(candidateDirectory, executableName())
  try {
    await fs.mkdir(extractedDirectory, { recursive: true })
    await fs.mkdir(candidateDirectory, { recursive: true })
    emitProgress(`Downloading Tinymist ${TINYMIST_VERSION} for ${paths.platformTarget}...`)
    await downloadArchive(`${RELEASE_BASE}/${paths.target.asset}`, archivePath, paths.target.sha256)
    emitProgress(`Extracting Tinymist ${TINYMIST_VERSION}...`)
    await extractArchive(archivePath, extractedDirectory, paths.target.asset)
    const extractedBinaries = await findExtractedBinaries(extractedDirectory, executableName())
    if (extractedBinaries.length !== 1) {
      throw new Error(`Tinymist archive must contain exactly one ${executableName()}.`)
    }
    const [extractedBinary] = extractedBinaries
    await fs.copyFile(extractedBinary, candidatePath)
    if (process.platform !== 'win32') await fs.chmod(candidatePath, 0o755)
    const inspection = await inspectTinymist(candidatePath)
    if (!inspection.compatible) {
      const foundVersion = inspection.typstVersion ?? 'unknown'
      throw new Error(
        `Downloaded Tinymist contains Typst ${foundVersion}; expected Typst ${TINYMIST_TYPST_VERSION}.`,
      )
    }
    await fs.rm(paths.installDirectory, { recursive: true, force: true })
    await fs.rename(candidateDirectory, paths.installDirectory)
    emitProgress(`Installed Tinymist ${TINYMIST_VERSION} with Typst ${TINYMIST_TYPST_VERSION}.`)
    return paths.binaryPath
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function resolveNow() {
  if (process.env.TINYMIST_PATH) {
    const explicitPath = path.resolve(process.env.TINYMIST_PATH)
    const explicit = await validateCandidate(explicitPath, 'TINYMIST_PATH')
    if (explicit) return explicit
  }

  const pathCandidate = await findCompatibleTinymistOnPath()
  if (pathCandidate) return pathCandidate

  const paths = cachePaths()
  const cached = await validateCandidate(paths.binaryPath, `cached Tinymist ${TINYMIST_VERSION}`)
  if (cached) return cached
  await fs.rm(paths.installDirectory, { recursive: true, force: true })
  return installTinymist(paths)
}

async function resolveTinymistBinary(onProgress) {
  if (onProgress) progressListeners.add(onProgress)
  try {
    if (!resolvingBinary) {
      resolvingBinary = resolveNow().finally(() => {
        resolvingBinary = undefined
      })
    }
    return await resolvingBinary
  } finally {
    if (onProgress) progressListeners.delete(onProgress)
  }
}

module.exports = {
  inspectTinymist,
  resolveTinymistBinary,
  TINYMIST_TYPST_VERSION,
  TINYMIST_VERSION,
}
