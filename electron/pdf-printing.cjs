const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const MAX_PDF_BYTES = 256 * 1024 * 1024

function registerPdfPrinting({ app, BrowserWindow, handleIpc }) {
  const printDirectory = path.join(app.getPath('cache'), 'tedit', 'print')
  const stalePrintCleanup = fs.rm(printDirectory, { force: true, recursive: true }).catch((error) => {
    console.error(`[tedit:pdf-print] Could not remove stale print files: ${error.message}`)
  })

  handleIpc('pdf:print', async (event, pdf) => {
    if (!(pdf instanceof Uint8Array) || pdf.byteLength < 5 || pdf.byteLength > MAX_PDF_BYTES) {
      throw new Error('Invalid PDF print request.')
    }
    const bytes = Buffer.from(pdf.buffer, pdf.byteOffset, pdf.byteLength)
    if (bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('Invalid PDF data.')

    const pdfPath = path.join(printDirectory, `${crypto.randomUUID()}.pdf`)
    await stalePrintCleanup
    await fs.mkdir(printDirectory, { recursive: true })
    await fs.writeFile(pdfPath, bytes, { mode: 0o600 })

    const parent = BrowserWindow.fromWebContents(event.sender)
    const printWindow = new BrowserWindow({
      show: false,
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        plugins: true,
        sandbox: true,
      },
    })

    try {
      const rendered = new Promise((resolve) => printWindow.once('ready-to-show', resolve))
      await Promise.all([
        printWindow.loadURL(pathToFileURL(pdfPath).href),
        Promise.race([
          rendered,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out preparing the PDF for printing.')), 15_000)),
        ]),
      ])
      return await new Promise((resolve) => {
        let completed = false
        const finish = (result) => {
          if (completed) return
          completed = true
          resolve(result)
        }
        printWindow.once('closed', () => finish({ success: false, failureReason: 'Print window closed.' }))
        printWindow.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
          finish({ success, failureReason })
        })
      })
    } finally {
      if (!printWindow.isDestroyed()) printWindow.destroy()
      await fs.rm(pdfPath, { force: true })
    }
  })
}

module.exports = { registerPdfPrinting }
