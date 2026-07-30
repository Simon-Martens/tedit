import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { TINYMIST_TARGETS, TINYMIST_VERSION } = require('../electron/tinymist-release.cjs')
const releaseBase = `https://github.com/Myriad-Dreamin/tinymist/releases/download/v${TINYMIST_VERSION}`

async function verifyTarget([platformTarget, target]) {
  const [archiveResponse, checksumResponse] = await Promise.all([
    fetch(`${releaseBase}/${target.asset}`, { method: 'HEAD', redirect: 'follow' }),
    fetch(`${releaseBase}/${target.asset}.sha256`, { redirect: 'follow' }),
  ])
  if (!archiveResponse.ok) {
    throw new Error(`${platformTarget} archive returned HTTP ${archiveResponse.status}.`)
  }
  if (!checksumResponse.ok) {
    throw new Error(`${platformTarget} checksum returned HTTP ${checksumResponse.status}.`)
  }
  const publishedChecksum = (await checksumResponse.text()).trim().split(/\s+/)[0]
  if (publishedChecksum !== target.sha256) {
    throw new Error(`${platformTarget} checksum does not match the pinned SHA-256.`)
  }
}

await Promise.all(Object.entries(TINYMIST_TARGETS).map(verifyTarget))
console.log(`Verified ${Object.keys(TINYMIST_TARGETS).length} Tinymist ${TINYMIST_VERSION} release assets.`)
