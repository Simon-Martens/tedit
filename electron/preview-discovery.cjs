const path = require('node:path')
const { Worker } = require('node:worker_threads')
const { logFailure } = require('./logging.cjs')

function createPreviewDiscovery({ handleIpc, onIpc, registry, workerPath }) {
  const previewRootsBySource = new Map()
  const workers = new Map()

  handleIpc('document:discover-preview-roots', async (event, request) => {
    const filePath = registry.normalizeDocumentPath(request.filePath)
    if (!registry.isAllowed(filePath)) {
      throw new Error('Preview roots can only be discovered for a document opened by tedit.')
    }
    const openDocuments = (Array.isArray(request.openDocuments) ? request.openDocuments : [])
      .flatMap((document) => {
        if (!document?.filePath || typeof document.source !== 'string') return []
        const documentPath = registry.normalizeDocumentPath(document.filePath)
        if (!registry.isAllowed(documentPath)) return []
        return [{ filePath: documentPath, source: document.source }]
      })
    workers.get(event.sender.id)?.terminate()
    const worker = new Worker(workerPath, {
      workerData: {
        filePath,
        rootDirectory: registry.getWorkspaceRoot(filePath) ?? path.dirname(filePath),
        openDocuments,
      },
    })
    workers.set(event.sender.id, worker)

    return new Promise((resolve, reject) => {
      let settled = false
      let lastRoots = []
      const timeout = setTimeout(() => {
        if (settled || workers.get(event.sender.id) !== worker) return
        settled = true
        workers.delete(event.sender.id)
        void worker.terminate()
        reject(new Error('Preview-root discovery did not produce a result within 20 seconds.'))
      }, 20_000)
      worker.on('message', (result) => {
        if (workers.get(event.sender.id) !== worker) return
        if (
          result?.type !== 'result'
          || !Array.isArray(result.roots)
          || !result.status
          || !['ready', 'degraded'].includes(result.status.state)
        ) {
          logFailure('preview-root-discovery-message', new Error('Worker returned an invalid result.'))
          return
        }
        lastRoots = result.roots
        previewRootsBySource.set(filePath, new Set(
          result.roots.map((root) => registry.normalizeDocumentPath(root.filePath)),
        ))
        if (!settled) {
          settled = true
          clearTimeout(timeout)
          resolve(result)
        } else if (!event.sender.isDestroyed()) {
          event.sender.send('document:preview-roots', { filePath, roots: result.roots, status: result.status })
        }
      })
      worker.once('error', (error) => {
        clearTimeout(timeout)
        logFailure('preview-root-discovery-worker', error, { filePath })
        if (!settled) {
          settled = true
          reject(error)
        } else if (!event.sender.isDestroyed()) {
          event.sender.send('document:preview-roots', {
            filePath,
            roots: lastRoots,
            status: {
              state: 'error',
              message: 'Preview-root discovery stopped unexpectedly.',
              watchedDirectories: 0,
              requestedDirectories: 0,
            },
          })
        }
      })
      worker.once('exit', (code) => {
        clearTimeout(timeout)
        const wasCurrent = workers.get(event.sender.id) === worker
        if (wasCurrent) workers.delete(event.sender.id)
        if (!settled) {
          settled = true
          reject(new Error(code === 0
            ? 'Preview-root discovery stopped before producing a result.'
            : 'Preview-root discovery was cancelled.'))
        } else if (wasCurrent && code !== 0 && !event.sender.isDestroyed()) {
          event.sender.send('document:preview-roots', {
            filePath,
            roots: lastRoots,
            status: {
              state: 'error',
              message: 'Preview-root discovery stopped unexpectedly.',
              watchedDirectories: 0,
              requestedDirectories: 0,
            },
          })
        }
      })
    })
  })

  onIpc('document:stop-preview-root-discovery', (event) => stopForWebContents(event.sender.id))

  function stopForWebContents(webContentsId) {
    const worker = workers.get(webContentsId)
    if (worker) void worker.terminate()
    workers.delete(webContentsId)
  }

  function stopAll() {
    for (const worker of workers.values()) void worker.terminate()
    workers.clear()
  }

  function isAllowedPreviewRoot(sourceFilePath, previewFilePath) {
    return sourceFilePath === previewFilePath
      || previewRootsBySource.get(sourceFilePath)?.has(previewFilePath)
  }

  return { isAllowedPreviewRoot, stopAll, stopForWebContents }
}

module.exports = { createPreviewDiscovery }
