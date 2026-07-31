const { spawn } = require('node:child_process')
const fs = require('node:fs/promises')
const net = require('node:net')
const path = require('node:path')
const WebSocket = require('ws')
const { resolveTinymistBinary } = require('./tinymist-binary.cjs')

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(address.port))
    })
  })
}

function connectWebSocket(port, processHandle, isCancelled) {
  return new Promise((resolve, reject) => {
    let attempts = 0
    let retryTimer
    const connect = () => {
      if (isCancelled() || processHandle.exitCode !== null) {
        reject(new Error('Tinymist exited before its preview service was ready.'))
        return
      }
      const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'http://localhost' })
      socket.binaryType = 'arraybuffer'
      const onError = () => {
        socket.close()
        attempts += 1
        if (attempts >= 300) reject(new Error('Timed out connecting to Tinymist preview.'))
        else retryTimer = setTimeout(connect, 100)
      }
      socket.once('open', () => {
        socket.removeListener('error', onError)
        clearTimeout(retryTimer)
        resolve(socket)
      })
      socket.once('error', onError)
    }
    connect()
  })
}

class TinymistService {
  constructor(sendEvent) {
    this.sendEvent = sendEvent
    this.generation = 0
    this.operationQueue = Promise.resolve()
    this.lifecycleGeneration = 0
  }

  status(documentId, state, message) {
    if (state === 'error') console.error(`[tedit:tinymist-preview] ${message}`)
    this.sendEvent('tinymist:status', { documentId, state, message })
  }

  start(request) {
    const lifecycleGeneration = ++this.lifecycleGeneration
    this.cancelCurrentOperation()
    const result = this.operationQueue.then(() => {
      if (lifecycleGeneration !== this.lifecycleGeneration) return
      return this.startNow(request)
    })
    this.operationQueue = result.catch(() => undefined)
    return result
  }

  resume({ documentId, filePath, sourceFilePath, source, memoryFiles = [] }) {
    if (
      documentId !== this.documentId
      || path.resolve(filePath) !== this.filePath
      || path.resolve(sourceFilePath) !== this.sourceFilePath
      || this.dataSocket?.readyState !== WebSocket.OPEN
      || this.controlSocket?.readyState !== WebSocket.OPEN
    ) return false
    this.update({ documentId, source, memoryFiles })
    this.dataSocket.send('current')
    this.status(documentId, 'ready', 'Source synchronization ready.')
    return true
  }

  refresh({ documentId }) {
    if (documentId === this.documentId && this.dataSocket?.readyState === WebSocket.OPEN) {
      this.dataSocket.send('current')
    }
  }

  async startNow({ documentId, filePath, sourceFilePath, memoryFiles = [], runtimeBacked = false }) {
    await this.stopNow()
    const generation = ++this.generation
    this.documentId = documentId
    this.filePath = path.resolve(filePath)
    this.sourceFilePath = path.resolve(sourceFilePath)
    this.runtimeBacked = runtimeBacked
    this.memoryFiles = new Map(memoryFiles.map((file) => [path.resolve(file.filePath), file.source]))
    this.status(documentId, 'installing', 'Locating Tinymist...')
    let spawnError

    try {
      const binary = await resolveTinymistBinary((message) => {
        if (generation === this.generation) this.status(documentId, 'installing', message)
      })
      if (generation !== this.generation) return
      this.status(documentId, 'starting', 'Starting source synchronization...')
      const [dataPort, controlPort] = await Promise.all([getFreePort(), getFreePort()])
      const args = [
        'preview', this.filePath,
        '--data-plane-host', `127.0.0.1:${dataPort}`,
        '--control-plane-host', `127.0.0.1:${controlPort}`,
        '--no-open',
      ]
      const child = spawn(binary, args, {
        cwd: path.dirname(this.filePath),
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true,
      })
      this.child = child
      let errorOutput = ''
      child.once('error', (error) => {
        if (generation !== this.generation || child.teditExpectedExit) return
        errorOutput = `${errorOutput}${error.message}`.slice(-4000)
        spawnError = error
      })
      child.stderr.on('data', (chunk) => {
        errorOutput = `${errorOutput}${chunk}`.slice(-4000)
      })
      child.once('exit', (code) => {
        if (generation !== this.generation || child.teditExpectedExit) return
        this.status(documentId, 'error', errorOutput.trim() || `Tinymist exited with code ${code}.`)
      })

      const acquiredSockets = []
      let dataSocket
      let controlSocket
      try {
        dataSocket = await connectWebSocket(dataPort, child, () => generation !== this.generation)
        acquiredSockets.push(dataSocket)
        controlSocket = await connectWebSocket(controlPort, child, () => generation !== this.generation)
        acquiredSockets.push(controlSocket)
      } catch (error) {
        for (const socket of acquiredSockets) socket.close()
        throw error
      }
      if (generation !== this.generation) {
        dataSocket.close()
        controlSocket.close()
        return
      }
      this.dataSocket = dataSocket
      this.controlSocket = controlSocket
      dataSocket.on('message', (data, isBinary) => this.handleDataMessage(data, isBinary, generation, documentId))
      controlSocket.on('message', (data) => this.handleControlMessage(data.toString(), generation, documentId))
      this.markMemoryUpdatePending()
      this.sendMemoryFiles('syncMemoryFiles')
      dataSocket.send('current')
      this.status(documentId, 'ready', 'Source synchronization ready.')
      this.sendLocate(this.latestLocate)
    } catch (error) {
      if (generation !== this.generation) return
      const effectiveError = spawnError ?? error
      const message = effectiveError instanceof Error ? effectiveError.message : String(effectiveError)
      this.status(documentId, 'error', spawnError ? `Could not start Tinymist preview: ${message}` : message)
      await this.stopNow()
    }
  }

  handleControlMessage(text, generation, documentId) {
    if (generation !== this.generation || documentId !== this.documentId) return
    let message
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    if (message.event === 'syncEditorChanges') {
      this.markMemoryUpdatePending()
      this.sendMemoryFiles('syncMemoryFiles')
    }
    if (message.event === 'compileStatus') {
      if (message.kind === 'CompileSuccess') {
        this.status(this.documentId, 'ready', 'Source synchronization ready.')
      } else if (message.kind === 'CompileError') {
        this.status(this.documentId, 'error', 'Tinymist could not compile the current source.')
      } else {
        this.status(this.documentId, 'starting', 'Updating source positions...')
      }
      if (message.kind === 'CompileSuccess' || message.kind === 'CompileError') {
        if (this.memoryUpdatePending) {
          clearTimeout(this.memoryUpdateSettleTimer)
          this.memoryUpdateSettleTimer = setTimeout(() => {
            this.memoryUpdatePending = false
            this.memoryUpdateSettleTimer = undefined
          }, 180)
        } else {
          this.sendEvent('tinymist:dependency-change', { documentId: this.documentId })
        }
      }
    }
    if (
      message.event === 'editorScrollTo'
      && this.previewRevealRequests > 0
      && Array.isArray(message.start)
      && Array.isArray(message.end)
    ) {
      this.previewRevealRequests -= 1
      if (this.previewRevealRequests > 0) return
      clearTimeout(this.previewRevealTimer)
      this.previewRevealTimer = undefined
      this.sendEvent('tinymist:source-reveal', {
        documentId,
        filePath: this.runtimeBacked ? undefined : message.filepath,
        start: { line: message.start[0], character: message.start[1] },
        end: { line: message.end[0], character: message.end[1] },
      })
    }
  }

  handleDataMessage(data, isBinary, generation, documentId) {
    if (generation !== this.generation || documentId !== this.documentId) return
    if (!isBinary) return
    const buffer = Buffer.from(data)
    const comma = buffer.indexOf(0x2c)
    if (comma < 0) return
    const event = buffer.subarray(0, comma).toString('utf8')
    if (event === 'new' || event === 'diff-v1') {
      this.sendEvent('tinymist:preview-update', {
        documentId,
        kind: event,
        data: new Uint8Array(buffer.buffer, buffer.byteOffset + comma + 1, buffer.length - comma - 1),
      })
      return
    }
    if (event !== 'jump') return
    const positions = buffer.toString('utf8').slice(5).split(',').map((entry) => {
      const [page, x, y] = entry.trim().split(/\s+/).map(Number)
      return { page, x, y }
    }).filter((position) => position.page > 0 && Number.isFinite(position.x) && Number.isFinite(position.y))
    if (this.latestLocate) {
      this.sendEvent('tinymist:jump', { documentId, requestId: this.latestLocate.requestId, positions })
    }
  }

  sendMemoryFiles(event) {
    if (this.controlSocket?.readyState !== WebSocket.OPEN || !this.filePath) return
    this.controlSocket.send(JSON.stringify({ event, files: Object.fromEntries(this.memoryFiles) }))
  }

  markMemoryUpdatePending() {
    this.memoryUpdatePending = true
    clearTimeout(this.memoryUpdateSettleTimer)
    this.memoryUpdateSettleTimer = undefined
  }

  update({ documentId, source, memoryFiles = [] }) {
    if (documentId !== this.documentId) return
    this.memoryFiles = new Map(memoryFiles.map((file) => [path.resolve(file.filePath), file.source]))
    if (this.runtimeBacked && typeof source === 'string') this.memoryFiles.set(this.sourceFilePath, source)
    this.markMemoryUpdatePending()
    this.sendMemoryFiles('updateMemoryFiles')
  }

  revealSource({ documentId, page, x, y }) {
    if (
      documentId !== this.documentId
      || this.dataSocket?.readyState !== WebSocket.OPEN
      || !Number.isSafeInteger(page)
      || page < 1
      || !Number.isFinite(x)
      || !Number.isFinite(y)
    ) return
    this.previewRevealRequests = (this.previewRevealRequests ?? 0) + 1
    clearTimeout(this.previewRevealTimer)
    this.previewRevealTimer = setTimeout(() => {
      this.previewRevealRequests = 0
      this.previewRevealTimer = undefined
    }, 2_000)
    this.dataSocket.send(`src-point ${JSON.stringify({ page_no: page, x, y })}`)
  }

  locate({ documentId, requestId, line, character }) {
    if (documentId !== this.documentId) return
    this.latestLocate = { documentId, requestId, line, character }
    this.sendLocate(this.latestLocate)
    clearTimeout(this.locateSettleTimer)
    this.locateSettleTimer = setTimeout(() => {
      if (this.latestLocate?.requestId === requestId) this.sendLocate(this.latestLocate)
    }, 80)
  }

  sendLocate(location) {
    if (!location || this.controlSocket?.readyState !== WebSocket.OPEN) return
    const { line, character } = location
    this.controlSocket.send(JSON.stringify({
      event: 'panelScrollTo',
      filepath: this.sourceFilePath,
      line,
      character,
    }))
  }

  stop() {
    const lifecycleGeneration = ++this.lifecycleGeneration
    this.cancelCurrentOperation()
    const result = this.operationQueue.then(() => {
      if (lifecycleGeneration !== this.lifecycleGeneration) return
      return this.stopNow()
    })
    this.operationQueue = result.catch(() => undefined)
    return result
  }

  cancelCurrentOperation() {
    this.generation += 1
    this.dataSocket?.close()
    this.controlSocket?.close()
    this.dataSocket = undefined
    this.controlSocket = undefined
    clearTimeout(this.locateSettleTimer)
    this.locateSettleTimer = undefined
    clearTimeout(this.memoryUpdateSettleTimer)
    this.memoryUpdateSettleTimer = undefined
    clearTimeout(this.previewRevealTimer)
    this.previewRevealTimer = undefined
    this.previewRevealRequests = 0
    this.memoryUpdatePending = false
    const child = this.child
    this.child = undefined
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
    this.dataSocket?.close()
    this.controlSocket?.close()
    this.dataSocket = undefined
    this.controlSocket = undefined
    clearTimeout(this.locateSettleTimer)
    this.locateSettleTimer = undefined
    clearTimeout(this.memoryUpdateSettleTimer)
    this.memoryUpdateSettleTimer = undefined
    clearTimeout(this.previewRevealTimer)
    this.previewRevealTimer = undefined
    this.previewRevealRequests = 0
    this.latestLocate = undefined
    const child = this.child
    const runtimeSourceFilePath = this.runtimeBacked ? this.sourceFilePath : undefined
    this.child = undefined
    this.documentId = undefined
    this.filePath = undefined
    this.sourceFilePath = undefined
    this.runtimeBacked = false
    this.memoryFiles = new Map()
    this.memoryUpdatePending = false
    if (child && child.exitCode === null) {
      child.teditExpectedExit = true
      const exited = new Promise((resolve) => child.once('exit', resolve))
      child.kill()
      let timeout
      await Promise.race([
        exited,
        new Promise((resolve) => {
          timeout = setTimeout(resolve, 500)
        }),
      ])
      clearTimeout(timeout)
      if (child.exitCode === null) child.kill('SIGKILL')
    }
    if (runtimeSourceFilePath) {
      await fs.rm(runtimeSourceFilePath, { force: true }).catch((error) => {
        console.error(`[tedit:tinymist-preview] Could not remove temporary source: ${error.message}`)
      })
    }
  }
}

module.exports = { TinymistService }
