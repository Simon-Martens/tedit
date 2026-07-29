const fs = require('node:fs/promises')
const path = require('node:path')
const { formatTinymistExportError, TinymistLspService } = require('./tinymist-lsp-service.cjs')
const { TinymistService } = require('./tinymist-service.cjs')
const { logFailure } = require('./logging.cjs')

function createTinymistIpcController({ app, handleIpc, isAllowedPreviewRoot, onIpc, registry, sendToWindows }) {
  let tinymistLspStartGeneration = 0
  const tinymist = new TinymistService(sendToWindows)
  const tinymistLsp = new TinymistLspService(sendToWindows)

  handleIpc('tinymist:start', async (_event, request) => {
    const filePath = registry.normalizeDocumentPath(request.filePath)
    const sourceFilePath = registry.normalizeDocumentPath(request.sourceFilePath)
    if (!isAllowedPreviewRoot(sourceFilePath, filePath) || !registry.isAllowed(sourceFilePath)) {
      throw new Error('Tinymist can only inspect a discovered preview root and open source file.')
    }
    const memoryFiles = normalizeMemoryFiles(request.memoryFiles)
    void tinymist.start({ ...request, filePath, sourceFilePath, memoryFiles })
  })

  onIpc('tinymist:update', (_event, request) => {
    tinymist.update({ ...request, memoryFiles: normalizeMemoryFiles(request.memoryFiles) })
  })
  onIpc('tinymist:locate', (_event, request) => tinymist.locate(request))
  onIpc('tinymist:stop', () => tinymist.stop())

  handleIpc('tinymist-lsp:start', async (_event, request) => {
    const startGeneration = ++tinymistLspStartGeneration
    if (
      typeof request?.documentId !== 'string'
      || !/^[A-Za-z0-9-]{1,64}$/.test(request.documentId)
      || !/^[A-Za-z0-9-]{1,64}$/.test(request.documentId)
      || typeof request.source !== 'string'
      || !Number.isSafeInteger(request.version)
      || !Number.isSafeInteger(request.sourceVersion)
    ) throw new Error('Invalid Tinymist language-server start request.')
    const activeFilePath = request.filePath
      ? registry.normalizeDocumentPath(request.filePath)
      : path.join(app.getPath('cache'), 'tedit', 'untitled', `${request.documentId}.typ`)
    const filePath = request.previewFilePath
      ? registry.normalizeDocumentPath(request.previewFilePath)
      : activeFilePath
    if (request.filePath && !registry.isAllowed(activeFilePath)) {
      throw new Error('Tinymist can only inspect a document opened by tedit.')
    }
    if (request.previewFilePath && !isAllowedPreviewRoot(activeFilePath, filePath)) {
      throw new Error('Tinymist can only compile a discovered preview root.')
    }
    if (!request.filePath) await fs.mkdir(path.dirname(activeFilePath), { recursive: true })
    const openDocuments = registry.normalizeLanguageServerDocuments(request.openDocuments)
    const openRoot = openDocuments.find((document) => document.filePath === filePath)
    const source = openRoot?.source ?? (filePath === activeFilePath
      ? request.source
      : await fs.readFile(filePath, 'utf8'))
    const version = openRoot?.version ?? (filePath === activeFilePath ? request.version : 0)
    if (startGeneration !== tinymistLspStartGeneration) return
    await tinymistLsp.start({
      ...request,
      activeFilePath,
      filePath,
      source,
      version,
      activeVersion: request.sourceVersion,
      rootDiskBacked: !openRoot && filePath !== activeFilePath,
      openDocuments,
    })
  })
  handleIpc('tinymist-lsp:sync-documents', async (_event, request) => {
    const openDocuments = registry.normalizeLanguageServerDocuments(request.openDocuments)
    await tinymistLsp.syncDocuments({ ...request, openDocuments })
  })
  handleIpc('tinymist-lsp:complete', async (_event, request) => {
    if (
      typeof request?.documentId !== 'string'
      || !Number.isSafeInteger(request.line)
      || request.line < 0
      || !Number.isSafeInteger(request.character)
      || request.character < 0
      || typeof request.source !== 'string'
      || !Number.isSafeInteger(request.sourceVersion)
      || request.sourceVersion < 0
      || Buffer.byteLength(request.source) > 8 * 1024 * 1024
      || (request.triggerCharacter !== undefined && (
        typeof request.triggerCharacter !== 'string'
        || [...request.triggerCharacter].length !== 1
      ))
    ) throw new Error('Invalid Tinymist completion request.')
    const openDocuments = registry.normalizeLanguageServerDocuments(request.openDocuments)
    return tinymistLsp.complete({ ...request, openDocuments })
  })
  handleIpc('tinymist-lsp:compile', async (_event, request) => {
    try {
      if (
        typeof request?.documentId !== 'string'
        || typeof request.source !== 'string'
        || !Number.isSafeInteger(request.version)
      ) throw new Error('Invalid Tinymist compile request.')
      const previewFilePath = request.previewFilePath
        ? registry.normalizeDocumentPath(request.previewFilePath)
        : undefined
      const openDocuments = registry.normalizeLanguageServerDocuments(request.openDocuments)
      return await tinymistLsp.compile({ ...request, previewFilePath, openDocuments })
    } catch (error) {
      logFailure('tinymist-compile', error, { documentId: request?.documentId })
      return { error: formatTinymistExportError(error) }
    }
  })
  onIpc('tinymist-lsp:stop', () => {
    tinymistLspStartGeneration += 1
    return tinymistLsp.stop()
  })

  function normalizeMemoryFiles(documents) {
    return (Array.isArray(documents) ? documents : []).flatMap((document) => {
      if (!document?.filePath || typeof document.source !== 'string') return []
      const documentPath = registry.normalizeDocumentPath(document.filePath)
      if (!registry.isAllowed(documentPath)) return []
      return [{ filePath: documentPath, source: document.source }]
    })
  }

  function stop() {
    return Promise.all([tinymist.stop(), tinymistLsp.stop()])
  }

  return { stop }
}

module.exports = { createTinymistIpcController }
