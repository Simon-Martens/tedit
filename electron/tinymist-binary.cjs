const { app } = require('electron')
const { execFile } = require('node:child_process')
const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { promisify } = require('node:util')
const extractZip = require('extract-zip')
const tar = require('tar')

const execFileAsync = promisify(execFile)
const TINYMIST_VERSION = '0.15.2'
const RELEASE_BASE = `https://github.com/Myriad-Dreamin/tinymist/releases/download/v${TINYMIST_VERSION}`

const TARGETS = {
  'linux-x64': 'x86_64-unknown-linux-gnu.tar.gz',
  'linux-arm64': 'aarch64-unknown-linux-gnu.tar.gz',
  'darwin-x64': 'x86_64-apple-darwin.tar.gz',
  'darwin-arm64': 'aarch64-apple-darwin.tar.gz',
  'win32-x64': 'x86_64-pc-windows-msvc.zip',
  'win32-arm64': 'aarch64-pc-windows-msvc.zip',
}

let resolvingBinary

async function isExecutable(command) {
  try {
    await execFileAsync(command, ['--version'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

async function installTinymist() {
  const target = TARGETS[`${process.platform}-${process.arch}`]
  if (!target) throw new Error(`Tinymist is not available for ${process.platform}-${process.arch}.`)

  const installDirectory = path.join(app.getPath('userData'), 'bin', `tinymist-${TINYMIST_VERSION}`)
  const executable = path.join(installDirectory, process.platform === 'win32' ? 'tinymist.exe' : 'tinymist')
  if (await isExecutable(executable)) return executable

  await fs.mkdir(installDirectory, { recursive: true })
  const archiveName = `tinymist-${target}`
  const archivePath = path.join(installDirectory, archiveName)
  const [archive, checksumFile] = await Promise.all([
    download(`${RELEASE_BASE}/${archiveName}`),
    download(`${RELEASE_BASE}/${archiveName}.sha256`),
  ])
  const expectedChecksum = checksumFile.toString('utf8').trim().split(/\s+/)[0]
  const actualChecksum = crypto.createHash('sha256').update(archive).digest('hex')
  if (actualChecksum !== expectedChecksum) throw new Error('Tinymist download checksum did not match.')

  await fs.writeFile(archivePath, archive)
  if (target.endsWith('.zip')) await extractZip(archivePath, { dir: installDirectory })
  else await tar.x({ file: archivePath, cwd: installDirectory })
  await fs.rm(archivePath, { force: true })
  const extractedFiles = await fs.readdir(installDirectory, { recursive: true })
  const executableName = process.platform === 'win32' ? 'tinymist.exe' : 'tinymist'
  const extractedExecutable = extractedFiles.find((file) => path.basename(file) === executableName)
  if (extractedExecutable && path.resolve(installDirectory, extractedExecutable) !== executable) {
    await fs.copyFile(path.resolve(installDirectory, extractedExecutable), executable)
  }
  if (process.platform !== 'win32') await fs.chmod(executable, 0o755)
  if (!await isExecutable(executable)) throw new Error('The downloaded Tinymist binary could not be started.')
  return executable
}

async function resolveTinymistBinary() {
  if (resolvingBinary) return resolvingBinary
  resolvingBinary = (async () => {
    if (process.env.TINYMIST_PATH && await isExecutable(process.env.TINYMIST_PATH)) {
      return process.env.TINYMIST_PATH
    }
    if (await isExecutable('tinymist')) return 'tinymist'
    return installTinymist()
  })()
  return resolvingBinary
}

module.exports = { resolveTinymistBinary, TINYMIST_VERSION }
