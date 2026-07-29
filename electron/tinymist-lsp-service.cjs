const { spawn } = require('node:child_process')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createMessageConnection } = require('vscode-jsonrpc/node')
const { resolveTinymistBinary } = require('./tinymist-binary.cjs')
const { version: appVersion } = require('../package.json')

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
    this.compileQueue = Promise.resolve()
    this.lifecycleQueue = Promise.resolve()
  }

  status(documentId, state, message) {
    this.sendEvent('tinymist-lsp:status', { documentId, state, message })
  }

  start(request) {
    const result = this.lifecycleQueue.then(() => this.startNow(request))
    this.lifecycleQueue = result.catch(() => undefined)
    return result
  }

  async startNow({ documentId, filePath, source, version }) {
    await this.stopNow()
    const generation = ++this.generation
    this.documentId = documentId
    this.filePath = path.resolve(filePath)
    this.uri = pathToFileURL(this.filePath).href
    this.source = source
    this.version = version
    this.status(documentId, 'installing', 'Locating Tinymist language server...')

    try {
      const binary = await resolveTinymistBinary()
      if (generation !== this.generation) return
      this.status(documentId, 'starting', 'Starting Tinymist language server...')
      const child = spawn(binary, ['lsp'], {
        cwd: path.dirname(this.filePath),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.child = child
      let errorOutput = ''
      child.stderr.on('data', (chunk) => {
        errorOutput = `${errorOutput}${chunk}`.slice(-4000)
      })
      child.once('exit', (code) => {
        if (generation !== this.generation) return
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
        if (generation !== this.generation || params.uri !== this.uri) return
        const diagnosticVersion = params.version ?? this.sentVersion
        clearTimeout(this.diagnosticsTimer)
        this.diagnosticsTimer = setTimeout(() => {
          if (generation !== this.generation || diagnosticVersion !== this.version) return
          this.sendEvent('tinymist-lsp:diagnostics', {
            documentId,
            version: diagnosticVersion,
            diagnostics: params.diagnostics,
          })
        }, 60)
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
            publishDiagnostics: { relatedInformation: true, versionSupport: true },
            synchronization: { didSave: true },
          },
        },
        initializationOptions: { exportPdf: 'never' },
      }), 10000, 'Timed out starting Tinymist language server.')
      if (generation !== this.generation) return
      await connection.sendNotification('initialized', {})
      if (generation !== this.generation) return
      const openedSource = this.source
      const openedVersion = this.version
      await connection.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri: this.uri,
          languageId: 'typst',
          version: openedVersion,
          text: openedSource,
        },
      })
      if (generation !== this.generation) return
      this.sentVersion = openedVersion
      this.open = true
      this.status(documentId, 'ready', 'Tinymist language server ready.')
    } catch (error) {
      if (generation !== this.generation) return
      this.status(documentId, 'error', error instanceof Error ? error.message : String(error))
      await this.stopNow(false)
    }
  }

  update({ documentId, source, version }) {
    if (documentId !== this.documentId) return
    if (version < this.version) return
    if (source === this.source && version === this.version) return
    this.source = source
    this.version = version
  }

  compile(request) {
    const result = this.compileQueue.then(() => this.compileNow(request))
    this.compileQueue = result.catch(() => undefined)
    return result
  }

  async compileNow({ documentId, source, version }) {
    if (documentId !== this.documentId || !this.connection || !this.open) {
      throw new Error('Tinymist language server is not ready for this document.')
    }
    if (version < this.version) {
      throw new Error('Tinymist compilation was superseded by a newer source revision.')
    }
    if (source !== this.source || version !== this.version) {
      this.update({ documentId, source, version })
    }
    if (this.sentVersion < version) {
      await this.connection.sendNotification('textDocument/didChange', {
        textDocument: { uri: this.uri, version },
        contentChanges: [{ text: source }],
      })
      this.sentVersion = version
    }
    if (documentId !== this.documentId || version !== this.version) {
      throw new Error('Tinymist compilation was superseded by a newer source revision.')
    }

    const started = Date.now()
    let result
    try {
      result = await withTimeout(
        this.connection.sendRequest('workspace/executeCommand', {
          command: 'tinymist.exportPdf',
          arguments: [this.filePath, {}, { write: false, open: false }],
        }),
        30000,
        'Timed out compiling the PDF with Tinymist.',
      )
    } catch (error) {
      if (error instanceof Error && error.message === 'Timed out compiling the PDF with Tinymist.') {
        this.status(documentId, 'error', error.message)
        void this.stop()
      }
      throw error
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
    const result = this.lifecycleQueue.then(() => this.stopNow())
    this.lifecycleQueue = result.catch(() => undefined)
    return result
  }

  async stopNow(incrementGeneration = true) {
    if (incrementGeneration) this.generation += 1
    const connection = this.connection
    const child = this.child
    const wasOpen = this.open
    this.open = false
    if (connection && wasOpen) {
      await connection.sendNotification(
        'textDocument/didClose',
        { textDocument: { uri: this.uri } },
      ).catch(() => undefined)
    }
    this.connection = undefined
    this.child = undefined
    this.documentId = undefined
    this.filePath = undefined
    this.uri = undefined
    this.sentVersion = -1
    clearTimeout(this.diagnosticsTimer)
    this.diagnosticsTimer = undefined
    connection?.dispose()
    if (child && child.exitCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve))
      child.kill()
      await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 500))])
      if (child.exitCode === null) child.kill('SIGKILL')
    }
  }
}

module.exports = { formatTinymistExportError, TinymistLspService }
