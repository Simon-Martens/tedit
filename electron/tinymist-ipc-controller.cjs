const fs = require('node:fs/promises')
const path = require('node:path')
const { formatTinymistExportError, TinymistLspService } = require('./tinymist-lsp-service.cjs')
const { TinymistService } = require('./tinymist-service.cjs')
const { logFailure } = require('./logging.cjs')

const INACTIVE_SERVICE_GRACE_MS = 30_000

function createTinymistIpcController({ app, handleIpc, isAllowedPreviewRoot, onIpc, registry, sendToWindows }) {
  const previewServices = new Map()
  const lspServices = new Map()

  const acquireService = (services, documentId, webContentsId, create) => {
    let entry = services.get(documentId)
    if (entry && entry.webContentsId !== webContentsId) {
      services.delete(documentId)
      clearTimeout(entry.stopTimer)
      void entry.service.stop().catch((error) => {
        logFailure('tinymist-owner-replacement', error, { documentId })
      })
      entry = undefined
    }
    if (!entry) {
      entry = {
        service: create(),
        webContentsId,
        stopTimer: undefined,
        startGeneration: 0,
        ready: false,
        pendingSync: undefined,
        pendingUpdate: undefined,
      }
      services.set(documentId, entry)
    }
    clearTimeout(entry.stopTimer)
    entry.stopTimer = undefined
    return entry
  }

  const releaseService = (services, documentId, webContentsId) => {
    const entry = services.get(documentId)
    if (!entry || entry.webContentsId !== webContentsId) return
    entry.startGeneration += 1
    clearTimeout(entry.stopTimer)
    entry.stopTimer = setTimeout(() => {
      if (services.get(documentId) !== entry) return
      services.delete(documentId)
      void entry.service.stop()
    }, INACTIVE_SERVICE_GRACE_MS)
  }

  handleIpc('tinymist:start', async (event, request) => {
    if (
      typeof request?.documentId !== 'string'
      || !/^[A-Za-z0-9-]{1,64}$/.test(request.documentId)
      || typeof request.source !== 'string'
    ) throw new Error('Invalid Tinymist preview request.')
    const entry = acquireService(
      previewServices,
      request.documentId,
      event.sender.id,
      () => new TinymistService(sendToWindows),
    )
    const startGeneration = ++entry.startGeneration
    entry.ready = false
    const runtimeBacked = !request.sourceFilePath
    const sourceFilePath = request.sourceFilePath
      ? registry.normalizeDocumentPath(request.sourceFilePath)
      : path.join(app.getPath('cache'), 'tedit', 'untitled', `${request.documentId}.typ`)
    const filePath = request.filePath
      ? registry.normalizeDocumentPath(request.filePath)
      : sourceFilePath
    if (!runtimeBacked && (!isAllowedPreviewRoot(sourceFilePath, filePath) || !registry.isAllowed(sourceFilePath))) {
      throw new Error('Tinymist can only inspect a discovered preview root and open source file.')
    }
    const memoryFiles = normalizeMemoryFiles(request.memoryFiles)
    if (runtimeBacked) {
      await fs.mkdir(path.dirname(sourceFilePath), { recursive: true })
      await fs.writeFile(sourceFilePath, request.source, 'utf8')
      memoryFiles.push({ filePath: sourceFilePath, source: request.source })
    }
    if (startGeneration !== entry.startGeneration) return
    const startRequest = { ...request, filePath, sourceFilePath, memoryFiles, runtimeBacked }
    if (!entry.service.resume(startRequest)) await entry.service.start(startRequest)
    if (startGeneration !== entry.startGeneration) return
    entry.ready = true
    if (entry.pendingUpdate) {
      entry.service.update(entry.pendingUpdate)
      entry.pendingUpdate = undefined
    }
  })

  onIpc('tinymist:update', (_event, request) => {
    const entry = previewServices.get(request?.documentId)
    if (!entry) return
    const update = {
      ...request,
      memoryFiles: normalizeMemoryFiles(request.memoryFiles),
    }
    if (!entry.ready) entry.pendingUpdate = update
    else entry.service.update(update)
  })
  onIpc('tinymist:locate', (_event, request) => previewServices.get(request?.documentId)?.service.locate(request))
  onIpc('tinymist:reveal-source', (_event, request) => previewServices.get(request?.documentId)?.service.revealSource(request))
  onIpc('tinymist:refresh', (_event, request) => previewServices.get(request?.documentId)?.service.refresh(request))
  onIpc('tinymist:stop', (event, request) => {
    releaseService(previewServices, request?.documentId, event.sender.id)
  })

  handleIpc('tinymist-lsp:start', async (event, request) => {
    if (
      typeof request?.documentId !== 'string'
      || !/^[A-Za-z0-9-]{1,64}$/.test(request.documentId)
      || !/^[A-Za-z0-9-]{1,64}$/.test(request.documentId)
      || typeof request.source !== 'string'
      || !Number.isSafeInteger(request.version)
      || !Number.isSafeInteger(request.sourceVersion)
    ) throw new Error('Invalid Tinymist language-server start request.')
    const entry = acquireService(
      lspServices,
      request.documentId,
      event.sender.id,
      () => new TinymistLspService(sendToWindows),
    )
    const startGeneration = ++entry.startGeneration
    entry.ready = false
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
    if (startGeneration !== entry.startGeneration) return
    const startRequest = {
      ...request,
      activeFilePath,
      filePath,
      source,
      version,
      activeVersion: request.sourceVersion,
      rootDiskBacked: !openRoot && filePath !== activeFilePath,
      openDocuments,
    }
    if (!await entry.service.resume(startRequest)) await entry.service.start(startRequest)
    if (startGeneration !== entry.startGeneration) return
    entry.ready = true
    if (entry.pendingSync) {
      await entry.service.syncDocuments(entry.pendingSync)
      entry.pendingSync = undefined
    }
  })
  handleIpc('tinymist-lsp:sync-documents', async (_event, request) => {
    const openDocuments = registry.normalizeLanguageServerDocuments(request.openDocuments)
    const entry = lspServices.get(request?.documentId)
    if (!entry) return
    const syncRequest = { ...request, openDocuments }
    if (!entry.ready) entry.pendingSync = syncRequest
    else await entry.service.syncDocuments(syncRequest)
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
    const service = lspServices.get(request.documentId)?.service
    if (!service) throw new Error('Tinymist language server is not running for this document.')
    return service.complete({ ...request, openDocuments })
  })
  handleIpc('tinymist-lsp:semantic-tokens', async (_event, request) => {
    if (
      typeof request?.documentId !== 'string'
      || typeof request.source !== 'string'
      || !Number.isSafeInteger(request.sourceVersion)
      || request.sourceVersion < 0
      || Buffer.byteLength(request.source) > 8 * 1024 * 1024
    ) throw new Error('Invalid Tinymist semantic-token request.')
    const openDocuments = registry.normalizeLanguageServerDocuments(request.openDocuments)
    const service = lspServices.get(request.documentId)?.service
    if (!service) return null
    return service.semanticTokens({ ...request, openDocuments })
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
      const service = lspServices.get(request.documentId)?.service
      if (!service) throw new Error('Tinymist language server is not running for this document.')
      return await service.compile({ ...request, previewFilePath, openDocuments })
    } catch (error) {
      logFailure('tinymist-compile', error, { documentId: request?.documentId })
      return { error: formatTinymistExportError(error) }
    }
  })
  onIpc('tinymist-lsp:stop', (event, request) => {
    releaseService(lspServices, request?.documentId, event.sender.id)
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
    const entries = [...previewServices.values(), ...lspServices.values()]
    previewServices.clear()
    lspServices.clear()
    for (const entry of entries) clearTimeout(entry.stopTimer)
    return Promise.all(entries.map((entry) => entry.service.stop()))
  }

  function stopForWebContents(webContentsId) {
    const stopped = []
    for (const services of [previewServices, lspServices]) {
      for (const [documentId, entry] of services) {
        if (entry.webContentsId !== webContentsId) continue
        services.delete(documentId)
        clearTimeout(entry.stopTimer)
        stopped.push(entry.service.stop())
      }
    }
    return Promise.all(stopped)
  }

  return { stop, stopForWebContents }
}

module.exports = { createTinymistIpcController }
