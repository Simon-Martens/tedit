const { app } = require('electron')
const { execFile } = require('node:child_process')
const path = require('node:path')
const { promisify } = require('node:util')
const { TINYMIST_TARGETS, TINYMIST_VERSION } = require('./tinymist-release.cjs')

const execFileAsync = promisify(execFile)

let resolvingBinary

async function isExecutable(command) {
  try {
    await execFileAsync(command, ['--version'], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

function bundledTinymistPath() {
  const platformTarget = `${process.platform}-${process.arch}`
  if (!TINYMIST_TARGETS[platformTarget]) return undefined
  const resourcesDirectory = app.isPackaged
    ? process.resourcesPath
    : path.join(__dirname, '..', 'resources')
  return path.join(
    resourcesDirectory,
    'tinymist',
    platformTarget,
    process.platform === 'win32' ? 'tinymist.exe' : 'tinymist',
  )
}

async function resolveTinymistBinary() {
  if (resolvingBinary) return resolvingBinary
  resolvingBinary = (async () => {
    if (process.env.TINYMIST_PATH && await isExecutable(process.env.TINYMIST_PATH)) {
      return process.env.TINYMIST_PATH
    }
    const bundled = bundledTinymistPath()
    if (bundled && await isExecutable(bundled)) return bundled
    if (await isExecutable('tinymist')) return 'tinymist'
    throw new Error(`Tinymist ${TINYMIST_VERSION} is not bundled for ${process.platform}-${process.arch}.`)
  })()
  return resolvingBinary
}

module.exports = { resolveTinymistBinary, TINYMIST_VERSION }
