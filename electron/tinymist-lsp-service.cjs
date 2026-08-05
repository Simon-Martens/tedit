const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { CancellationTokenSource, createMessageConnection } = require('vscode-jsonrpc/node')
const { resolveTinymistBinary } = require('./tinymist-binary.cjs')
const { version: appVersion } = require('../package.json')

const SEMANTIC_TOKEN_TYPES = [
  'comment', 'string', 'keyword', 'operator', 'number', 'function', 'decorator', 'type', 'namespace',
  'bool', 'punct', 'escape', 'link', 'raw', 'label', 'ref', 'heading', 'marker', 'term', 'delim',
  'pol', 'error', 'text',
]
const SEMANTIC_TOKEN_MODIFIERS = ['strong', 'emph', 'math', 'readonly', 'static', 'defaultLibrary']

function withTimeout(promise, milliseconds, message) {
  let timeout
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(message)), milliseconds)
    }),
  ]).finally(() => clearTimeout(timeout))
}

function formatTinymistExportError(error) {
  const message = error instanceof Error ? error.message : String(error)
  const marker = 'document is not available for export:'
  const markerIndex = message.indexOf(marker)
  if (markerIndex === -1) return message

  const diagnostic = message.slice(markerIndex + marker.length).trim()
  if (!diagnostic.startsWith('"') || !diagnostic.endsWith('"')) return diagnostic
  try {
    return JSON.parse(diagnostic)
  } catch {
    return diagnostic.slice(1, -1)
  }
}

class TinymistLspService {
  constructor(sendEvent) {
    this.sendEvent = sendEvent
    this.generation = 0
    this.sentVersion = -1
    this.operationQueue = Promise.resolve()
    this.compileGeneration = 0
    this.lifecycleGeneration = 0
    this.openDocuments = new Map()
    this.pendingSync = undefined
    this.syncInFlight = undefined
    this.syncDrainPromise = undefined
    this.pendingCompile = undefined
    this.compileDrainPromise = undefined
    this.exportCancellation = undefined
    this.completionGeneration = 0
    this.completionCancellation = undefined
    this.semanticTokensGeneration = 0
    this.semanticTokensCancellation = undefined
  }

  status(documentId, state, message) {
    if (state === 'error') console.error(`[tedit:tinymist-lsp] ${message}`)
    this.sendEvent('tinymist-lsp:status', { documentId, state, message })
  }

  start(request) {
    this.cancelPendingWork()
    const lifecycleGeneration = ++this.lifecycleGeneration
    this.cancelCurrentOperation()
    const result = this.operationQueue.then(() => {
      if (lifecycleGeneration !== this.lifecycleGeneration) return
      return this.startNow(request)
    })
    this.operationQueue = result.catch(() => undefined)
    return result
  }

  async resume(request) {
    if (
      request.documentId !== this.documentId
      || path.resolve(request.filePath) !== this.filePath
      || path.resolve(request.activeFilePath) !== this.activeFilePath
      || !this.connection
      || !this.open
    ) return false
    this.activeVersion = request.activeVersion
    await this.syncDocuments(request)
    this.status(request.documentId, 'ready', 'Tinymist language server ready.')
    return true
  }

  async startNow({
    documentId,
    filePath,
    activeFilePath,
    source,
    version,
    activeVersion,
    rootDiskBacked = false,
    openDocuments = [],
  }) {
    await this.stopNow()
    const generation = ++this.generation
    this.documentId = documentId
    this.filePath = path.resolve(filePath)
    this.uri = pathToFileURL(this.filePath).href
    this.activeFilePath = path.resolve(activeFilePath)
    this.activeUri = pathToFileURL(this.activeFilePath).href
    this.source = source
    this.version = version
    this.activeVersion = activeVersion
    this.rootDiskBacked = rootDiskBacked
    this.status(documentId, 'installing', 'Locating Tinymist language server...')
    let spawnError

    try {
      const binary = await resolveTinymistBinary((message) => {
        if (generation === this.generation) this.status(documentId, 'installing', message)
      })
      if (generation !== this.generation) return
      this.status(documentId, 'starting', 'Starting Tinymist language server...')
      const child = spawn(binary, ['lsp'], {
        cwd: path.dirname(this.filePath),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.child = child
      let errorOutput = ''
      child.once('error', (error) => {
        if (generation !== this.generation || child.teditExpectedExit) return
        errorOutput = `${errorOutput}${error.message}`.slice(-4000)
        spawnError = error
        this.connection?.dispose()
      })
      child.stderr.on('data', (chunk) => {
        errorOutput = `${errorOutput}${chunk}`.slice(-4000)
      })
      child.once('exit', (code) => {
        if (generation !== this.generation || child.teditExpectedExit) return
        this.connection = undefined
        this.status(documentId, 'error', errorOutput.trim() || `Tinymist language server exited with code ${code}.`)
      })

      const connection = createMessageConnection(child.stdout, child.stdin)
      this.connection = connection
      connection.onRequest('workspace/configuration', (params) => params.items.map(() => ({})))
      connection.onRequest('workspace/workspaceFolders', () => [{
        uri: pathToFileURL(path.dirname(this.filePath)).href,
        name: path.basename(path.dirname(this.filePath)),
      }])
      connection.onRequest('client/registerCapability', () => null)
      connection.onRequest('client/unregisterCapability', () => null)
      connection.onRequest('window/workDoneProgress/create', () => null)
      connection.onRequest('workspace/applyEdit', () => ({ applied: false }))
      connection.onNotification('textDocument/publishDiagnostics', (params) => {
        if (generation !== this.generation || params.uri !== this.activeUri) return
        const activeDocument = this.openDocuments.get(this.activeUri)
        const diagnosticVersion = params.version ?? activeDocument?.version
        if (!activeDocument || diagnosticVersion !== activeDocument.version) return
        const sourceVersion = activeDocument.sourceVersion ?? activeDocument.version
        const clientVersion = activeDocument.clientVersion ?? activeDocument.version
        const emitDiagnostics = () => {
          const currentDocument = this.openDocuments.get(this.activeUri)
          if (
            generation !== this.generation
            || diagnosticVersion !== currentDocument?.version
            || sourceVersion !== (currentDocument.sourceVersion ?? currentDocument.version)
            || clientVersion !== (currentDocument.clientVersion ?? currentDocument.version)
          ) return
          this.sendEvent('tinymist-lsp:diagnostics', {
            documentId,
            sourceVersion,
            clientVersion,
            diagnostics: params.diagnostics,
          })
        }
        clearTimeout(this.diagnosticsTimer)
        if (!params.diagnostics.length) {
          this.diagnosticsTimer = undefined
          emitDiagnostics()
        } else {
          this.diagnosticsTimer = setTimeout(emitDiagnostics, 60)
        }
      })
      connection.listen()

      const rootUri = pathToFileURL(path.dirname(this.filePath)).href
      await withTimeout(connection.sendRequest('initialize', {
        processId: process.pid,
        clientInfo: { name: 'tedit', version: appVersion },
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: path.basename(path.dirname(this.filePath)) }],
        capabilities: {
          workspace: { configuration: true, workspaceFolders: true },
          textDocument: {
            completion: {
              completionItem: {
                documentationFormat: ['markdown', 'plaintext'],
                insertReplaceSupport: true,
                snippetSupport: true,
              },
              completionList: {
                itemDefaults: ['commitCharacters', 'editRange', 'insertTextFormat', 'insertTextMode', 'data'],
              },
            },
            semanticTokens: {
              dynamicRegistration: false,
              requests: { full: true },
              tokenTypes: SEMANTIC_TOKEN_TYPES,
              tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
              formats: ['relative'],
              overlappingTokenSupport: false,
              multilineTokenSupport: false,
              augmentsSyntaxTokens: true,
            },
            publishDiagnostics: { relatedInformation: true, versionSupport: true },
            synchronization: { didSave: true },
          },
        },
        initializationOptions: { exportPdf: 'never' },
      }), 30_000, 'Timed out starting Tinymist language server.')
      if (generation !== this.generation) return
      await connection.sendNotification('initialized', {})
      if (generation !== this.generation) return
      const documents = new Map(openDocuments.map((document) => [path.resolve(document.filePath), {
        ...document,
        filePath: path.resolve(document.filePath),
      }]))
      documents.set(this.filePath, {
        documentId,
        filePath: this.filePath,
        source: this.source,
        version: this.version,
        sourceVersion: this.activeVersion,
        clientVersion: this.version,
      })
      const orderedDocuments = [
        ...[...documents.values()].filter((document) => document.filePath !== this.filePath),
        documents.get(this.filePath),
      ].filter(Boolean)
      for (const document of orderedDocuments) {
        const uri = pathToFileURL(document.filePath).href
        await connection.sendNotification('textDocument/didOpen', {
          textDocument: {
            uri,
            languageId: 'typst',
            version: document.version,
            text: document.source,
          },
        })
        this.openDocuments.set(uri, document)
      }
      if (generation !== this.generation) return
      this.sentVersion = this.version
      this.open = true
      this.status(documentId, 'ready', 'Tinymist language server ready.')
    } catch (error) {
      if (generation !== this.generation) return
      const effectiveError = spawnError ?? error
      const message = effectiveError instanceof Error ? effectiveError.message : String(effectiveError)
      this.status(documentId, 'error', spawnError ? `Could not start Tinymist language server: ${message}` : message)
      this.cancelCurrentOperation()
    }
  }

  update({ documentId, source, version }) {
    if (documentId !== this.documentId) return
    if (version < this.version) return
    if (source === this.source && version === this.version) return
    this.source = source
    this.version = version
  }

  syncDocuments(request) {
    const baselineDocuments = this.pendingSync?.openDocuments ?? this.syncInFlight?.openDocuments
    let documentsChanged
    if (baselineDocuments) {
      const baselineByPath = new Map(baselineDocuments.map((document) => [path.resolve(document.filePath), document]))
      documentsChanged = baselineByPath.size !== (request.openDocuments?.length ?? 0)
        || (request.openDocuments ?? []).some((document) => {
          const baseline = baselineByPath.get(path.resolve(document.filePath))
          return !baseline || baseline.version !== document.version || baseline.source !== document.source
        })
    } else {
      const requestedUris = new Set()
      documentsChanged = false
      for (const document of request.openDocuments ?? []) {
        const uri = pathToFileURL(path.resolve(document.filePath)).href
        requestedUris.add(uri)
        const current = this.openDocuments.get(uri)
        if (!current || current.version !== document.version || current.source !== document.source) {
          documentsChanged = true
        }
      }
      for (const uri of this.openDocuments.keys()) {
        if (uri !== this.uri && !requestedUris.has(uri)) documentsChanged = true
      }
    }
    if (!documentsChanged) return this.syncDrainPromise ?? Promise.resolve()
    this.compileGeneration += 1
    this.exportCancellation?.cancel()
    if (this.pendingCompile) {
      this.pendingCompile.resolve({ cancelled: true })
      this.pendingCompile = undefined
    }
    this.pendingSync = request
    this.scheduleSyncDrain()
    return this.syncDrainPromise
  }

  scheduleSyncDrain() {
    if (this.syncDrainPromise) return
    const drain = this.operationQueue.then(() => this.drainSyncDocuments())
    this.operationQueue = drain.catch(() => undefined)
    this.syncDrainPromise = drain.finally(() => {
      this.syncDrainPromise = undefined
      if (this.pendingSync) this.scheduleSyncDrain()
    })
  }

  async drainSyncDocuments() {
    while (this.pendingSync) {
      const request = this.pendingSync
      this.pendingSync = undefined
      this.syncInFlight = request
      try {
        await this.syncDocumentsNow(request)
      } finally {
        if (this.syncInFlight === request) this.syncInFlight = undefined
      }
    }
  }

  async syncDocumentsNow({ documentId, openDocuments = [] }, emitDependencyChange = true) {
    if (documentId !== this.documentId || !this.connection || !this.open) return
    let dependenciesChanged = false
    const nextDocuments = new Map(openDocuments.map((document) => {
      const filePath = path.resolve(document.filePath)
      const uri = pathToFileURL(filePath).href
      const current = this.openDocuments.get(uri)
      const version = current && document.version <= current.version
        ? current.source === document.source ? current.version : current.version + 1
        : document.version
      return [uri, {
        ...document,
        filePath,
        version,
        clientVersion: document.clientVersion ?? document.version,
      }]
    }))
    const requestedRoot = nextDocuments.get(this.uri)
    if (requestedRoot) {
      this.source = requestedRoot.source
      this.version = requestedRoot.version
      this.rootDiskBacked = false
    } else {
      this.rootDiskBacked = this.filePath !== this.activeFilePath
      nextDocuments.set(this.uri, {
        documentId: this.documentId,
        filePath: this.filePath,
        source: this.source,
        version: this.version,
        sourceVersion: this.activeVersion,
        clientVersion: this.version,
      })
    }

    for (const [uri, current] of this.openDocuments) {
      if (nextDocuments.has(uri)) continue
      await this.connection.sendNotification('textDocument/didClose', {
        textDocument: { uri },
      })
      this.openDocuments.delete(uri)
      if (uri !== this.uri && uri !== this.activeUri) dependenciesChanged = true
    }

    for (const [uri, next] of nextDocuments) {
      const current = this.openDocuments.get(uri)
      if (!current) {
        await this.connection.sendNotification('textDocument/didOpen', {
          textDocument: {
            uri,
            languageId: 'typst',
            version: next.version,
            text: next.source,
          },
        })
        if (uri !== this.uri && uri !== this.activeUri) dependenciesChanged = true
      } else if (current.version !== next.version || current.source !== next.source) {
        const sourceChanged = current.source !== next.source
          || (current.sourceVersion ?? current.version) !== (next.sourceVersion ?? next.version)
        await this.connection.sendNotification('textDocument/didChange', {
          textDocument: { uri, version: next.version },
          contentChanges: [{ text: next.source }],
        })
        if (uri === this.uri) {
          this.source = next.source
          this.version = next.version
          this.sentVersion = next.version
        } else if (uri !== this.activeUri) {
          dependenciesChanged = dependenciesChanged || sourceChanged
        }
      }
      this.openDocuments.set(uri, next)
      if (uri === this.activeUri) this.activeVersion = next.sourceVersion ?? next.version
    }
    if (emitDependencyChange && dependenciesChanged) {
      this.sendEvent('tinymist-lsp:dependency-change', { documentId })
    }
  }

  compile(request) {
    const compileGeneration = ++this.compileGeneration
    this.exportCancellation?.cancel()
    if (this.pendingCompile) this.pendingCompile.resolve({ cancelled: true })
    const result = new Promise((resolve, reject) => {
      this.pendingCompile = { request, compileGeneration, resolve, reject }
    })
    this.scheduleCompileDrain()
    return result
  }

  async complete({ documentId, line, character, triggerCharacter, source, sourceVersion, openDocuments = [] }) {
    const completionGeneration = ++this.completionGeneration
    this.completionCancellation?.cancel()
    const activeDocumentOpen = openDocuments.some((document) => path.resolve(document.filePath) === this.activeFilePath)
    const currentActiveDocument = this.openDocuments.get(this.activeUri)
    const completionDocuments = activeDocumentOpen ? openDocuments : [...openDocuments, {
      documentId,
      filePath: this.activeFilePath,
      source,
      version: currentActiveDocument?.version ?? sourceVersion,
      sourceVersion,
      clientVersion: currentActiveDocument?.clientVersion ?? sourceVersion,
    }]
    await this.syncDocuments({ documentId, openDocuments: completionDocuments })
    if (
      completionGeneration !== this.completionGeneration
      || documentId !== this.documentId
      || !this.connection
      || !this.open
    ) return null
    const cancellation = new CancellationTokenSource()
    this.completionCancellation = cancellation
    try {
      return await this.connection.sendRequest('textDocument/completion', {
        textDocument: { uri: this.activeUri },
        position: { line, character },
        context: {
          triggerKind: triggerCharacter ? 2 : 1,
          ...(triggerCharacter ? { triggerCharacter } : {}),
        },
      }, cancellation.token)
    } catch (error) {
      if (completionGeneration !== this.completionGeneration || cancellation.token.isCancellationRequested) return null
      throw error
    } finally {
      if (this.completionCancellation === cancellation) this.completionCancellation = undefined
      cancellation.dispose()
    }
  }

  async semanticTokens({ documentId, source, sourceVersion, openDocuments = [] }) {
    const semanticTokensGeneration = ++this.semanticTokensGeneration
    this.semanticTokensCancellation?.cancel()
    const activeDocumentOpen = openDocuments.some((document) => path.resolve(document.filePath) === this.activeFilePath)
    const currentActiveDocument = this.openDocuments.get(this.activeUri)
    const semanticDocuments = activeDocumentOpen ? openDocuments : [...openDocuments, {
      documentId,
      filePath: this.activeFilePath,
      source,
      version: currentActiveDocument?.version ?? sourceVersion,
      sourceVersion,
      clientVersion: currentActiveDocument?.clientVersion ?? sourceVersion,
    }]
    await this.syncDocuments({ documentId, openDocuments: semanticDocuments })
    if (
      semanticTokensGeneration !== this.semanticTokensGeneration
      || documentId !== this.documentId
      || !this.connection
      || !this.open
    ) return null
    const cancellation = new CancellationTokenSource()
    this.semanticTokensCancellation = cancellation
    try {
      return await this.connection.sendRequest('textDocument/semanticTokens/full', {
        textDocument: { uri: this.activeUri },
      }, cancellation.token)
    } catch (error) {
      if (semanticTokensGeneration !== this.semanticTokensGeneration || cancellation.token.isCancellationRequested) return null
      throw error
    } finally {
      if (this.semanticTokensCancellation === cancellation) this.semanticTokensCancellation = undefined
      cancellation.dispose()
    }
  }

  scheduleCompileDrain() {
    if (this.compileDrainPromise) return
    const drain = this.operationQueue.then(() => this.drainCompiles())
    this.operationQueue = drain.catch(() => undefined)
    this.compileDrainPromise = drain.finally(() => {
      this.compileDrainPromise = undefined
      if (this.pendingCompile) this.scheduleCompileDrain()
    })
  }

  async drainCompiles() {
    while (this.pendingCompile) {
      const job = this.pendingCompile
      this.pendingCompile = undefined
      try {
        const result = await this.compileNow(job.request, job.compileGeneration)
        if (job.compileGeneration === this.compileGeneration) job.resolve(result)
        else job.resolve({ cancelled: true })
      } catch (error) {
        if (job.compileGeneration !== this.compileGeneration) job.resolve({ cancelled: true })
        else job.reject(error)
      }
    }
  }

  async compileNow({ documentId, source, version, previewFilePath, openDocuments = [] }, compileGeneration) {
    if (compileGeneration !== this.compileGeneration) {
      throw new Error('Tinymist compilation was superseded by a newer request.')
    }
    if (documentId !== this.documentId || !this.connection || !this.open) {
      throw new Error('Tinymist language server is not ready for this document.')
    }
    const compileDocuments = this.activeUri === this.uri
      && !openDocuments.some((document) => path.resolve(document.filePath) === this.activeFilePath)
      ? [...openDocuments, {
        documentId,
        filePath: this.activeFilePath,
        source,
        version,
        sourceVersion: version,
        clientVersion: version,
      }]
      : openDocuments
    await this.syncDocumentsNow({ documentId, openDocuments: compileDocuments }, false)
    if (version < this.activeVersion) {
      throw new Error('Tinymist compilation was superseded by a newer source revision.')
    }
    if (this.rootDiskBacked) {
      const source = await fs.readFile(this.filePath, 'utf8')
      if (source !== this.source) {
        this.version += 1
        this.source = source
        await this.connection.sendNotification('textDocument/didChange', {
          textDocument: { uri: this.uri, version: this.version },
          contentChanges: [{ text: source }],
        })
        this.sentVersion = this.version
        const rootDocument = this.openDocuments.get(this.uri)
        if (rootDocument) this.openDocuments.set(this.uri, { ...rootDocument, source, version: this.version })
      }
    }
    if (documentId !== this.documentId || version !== this.activeVersion) {
      throw new Error('Tinymist compilation was superseded by a newer source revision.')
    }
    if (this.sentVersion < this.version) {
      await this.connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: this.uri, version: this.version },
        contentChanges: [{ text: this.source }],
      })
      this.sentVersion = this.version
    }

    const started = Date.now()
    const exportPath = previewFilePath ? path.resolve(previewFilePath) : this.filePath
    if (exportPath !== this.filePath) {
      throw new Error('The requested preview root does not match the active Tinymist project.')
    }
    if (compileGeneration !== this.compileGeneration) {
      throw new Error('Tinymist compilation was superseded by a newer request.')
    }
    let result
    const cancellation = new CancellationTokenSource()
    this.exportCancellation = cancellation
    try {
      result = await withTimeout(
        this.connection.sendRequest('workspace/executeCommand', {
          command: 'tinymist.exportPdf',
          arguments: [exportPath, {}, { write: false, open: false }],
        }, cancellation.token),
        30000,
        'Timed out compiling the PDF with Tinymist.',
      )
    } catch (error) {
      if (error instanceof Error && error.message === 'Timed out compiling the PDF with Tinymist.') {
        this.status(documentId, 'error', error.message)
        void this.stop()
      }
      throw error
    } finally {
      if (this.exportCancellation === cancellation) this.exportCancellation = undefined
      cancellation.dispose()
    }
    if (compileGeneration !== this.compileGeneration) {
      throw new Error('Tinymist compilation was superseded by a newer request.')
    }
    if (!result?.data) throw new Error('Tinymist did not return PDF data.')
    const pdf = Buffer.from(result.data, 'base64')
    return {
      version,
      durationMs: Date.now() - started,
      pdf: pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength),
    }
  }

  stop() {
    this.cancelPendingWork()
    const lifecycleGeneration = ++this.lifecycleGeneration
    this.cancelCurrentOperation()
    const result = this.operationQueue.then(() => {
      if (lifecycleGeneration !== this.lifecycleGeneration) return
      return this.stopNow()
    })
    this.operationQueue = result.catch(() => undefined)
    return result
  }

  cancelPendingWork() {
    this.compileGeneration += 1
    this.pendingSync = undefined
    this.syncInFlight = undefined
    this.exportCancellation?.cancel()
    this.completionGeneration += 1
    this.completionCancellation?.cancel()
    this.completionCancellation = undefined
    this.semanticTokensGeneration += 1
    this.semanticTokensCancellation?.cancel()
    this.semanticTokensCancellation = undefined
    if (this.pendingCompile) {
      this.pendingCompile.resolve({ cancelled: true })
      this.pendingCompile = undefined
    }
  }

  cancelCurrentOperation() {
    this.generation += 1
    this.open = false
    clearTimeout(this.diagnosticsTimer)
    this.diagnosticsTimer = undefined
    const connection = this.connection
    const child = this.child
    this.connection = undefined
    this.child = undefined
    connection?.dispose()
    if (child && child.exitCode === null) {
      child.teditExpectedExit = true
      child.kill()
      const forceTimer = setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 500)
      forceTimer.unref?.()
    }
  }

  async stopNow(incrementGeneration = true) {
    if (incrementGeneration) this.generation += 1
    const connection = this.connection
    const child = this.child
    const openDocuments = this.openDocuments
    this.open = false
    if (connection) {
      for (const uri of openDocuments.keys()) {
        await connection.sendNotification('textDocument/didClose', {
          textDocument: { uri },
        }).catch(() => undefined)
      }
    }
    this.connection = undefined
    this.child = undefined
    this.documentId = undefined
    this.filePath = undefined
    this.uri = undefined
    this.activeFilePath = undefined
    this.activeUri = undefined
    this.activeVersion = undefined
    this.rootDiskBacked = false
    this.sentVersion = -1
    this.openDocuments = new Map()
    clearTimeout(this.diagnosticsTimer)
    this.diagnosticsTimer = undefined
    connection?.dispose()
    if (child && child.exitCode === null) {
      child.teditExpectedExit = true
      const exited = new Promise((resolve) => child.once('exit', resolve))
      child.kill()
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 500))])
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }
}

module.exports = { formatTinymistExportError, TinymistLspService }
