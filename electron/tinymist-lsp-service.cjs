const { spawn } = require('node:child_process')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createMessageConnection } = require('vscode-jsonrpc/node')
const { resolveTinymistBinary } = require('./tinymist-binary.cjs')

class TinymistLspService {
  constructor(sendEvent) {
    this.sendEvent = sendEvent
    this.generation = 0
  }

  status(documentId, state, message) {
    this.sendEvent('tinymist-lsp:status', { documentId, state, message })
  }

  async start({ documentId, filePath, source, version }) {
    await this.stop()
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
        clearTimeout(this.diagnosticsTimer)
        const diagnosticVersion = params.version ?? this.version
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
      await connection.sendRequest('initialize', {
        processId: process.pid,
        clientInfo: { name: 'tedit', version: '0.1.0-alpha.1' },
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: path.basename(path.dirname(this.filePath)) }],
        capabilities: {
          workspace: { configuration: true, workspaceFolders: true },
          textDocument: {
            publishDiagnostics: { relatedInformation: true, versionSupport: true },
            synchronization: { didSave: true },
          },
        },
      })
      if (generation !== this.generation) return
      connection.sendNotification('initialized', {})
      connection.sendNotification('textDocument/didOpen', {
        textDocument: {
          uri: this.uri,
          languageId: 'typst',
          version: this.version,
          text: this.source,
        },
      })
      this.open = true
      this.status(documentId, 'ready', 'Tinymist language server ready.')
    } catch (error) {
      if (generation !== this.generation) return
      this.status(documentId, 'error', error instanceof Error ? error.message : String(error))
      await this.stop(false)
    }
  }

  update({ documentId, source, version }) {
    if (documentId !== this.documentId) return
    this.source = source
    this.version = version
    if (!this.connection || !this.open) return
    this.connection.sendNotification('textDocument/didChange', {
      textDocument: { uri: this.uri, version },
      contentChanges: [{ text: source }],
    })
  }

  async stop(incrementGeneration = true) {
    if (incrementGeneration) this.generation += 1
    const connection = this.connection
    const child = this.child
    if (connection && this.open) {
      connection.sendNotification('textDocument/didClose', { textDocument: { uri: this.uri } })
    }
    this.connection = undefined
    this.child = undefined
    this.documentId = undefined
    this.filePath = undefined
    this.uri = undefined
    this.open = false
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

module.exports = { TinymistLspService }
