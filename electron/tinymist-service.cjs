const { spawn } = require('node:child_process')
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

function connectWebSocket(port, processHandle) {
  return new Promise((resolve, reject) => {
    let attempts = 0
    const connect = () => {
      if (processHandle.exitCode !== null) {
        reject(new Error('Tinymist exited before its preview service was ready.'))
        return
      }
      const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'http://localhost' })
      socket.binaryType = 'arraybuffer'
      socket.once('open', () => resolve(socket))
      socket.once('error', () => {
        socket.close()
        attempts += 1
        if (attempts >= 100) reject(new Error('Timed out connecting to Tinymist preview.'))
        else setTimeout(connect, 100)
      })
    }
    connect()
  })
}

class TinymistService {
  constructor(sendEvent) {
    this.sendEvent = sendEvent
    this.generation = 0
  }

  status(documentId, state, message) {
    this.sendEvent('tinymist:status', { documentId, state, message })
  }

  async start({ documentId, filePath, source }) {
    await this.stop()
    const generation = ++this.generation
    this.documentId = documentId
    this.filePath = path.resolve(filePath)
    this.source = source
    this.status(documentId, 'installing', 'Locating Tinymist...')

    try {
      const binary = await resolveTinymistBinary()
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
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.child = child
      let errorOutput = ''
      child.stderr.on('data', (chunk) => {
        errorOutput = `${errorOutput}${chunk}`.slice(-4000)
      })
      child.once('exit', (code) => {
        if (generation !== this.generation) return
        this.status(documentId, 'error', errorOutput.trim() || `Tinymist exited with code ${code}.`)
      })

      const [dataSocket, controlSocket] = await Promise.all([
        connectWebSocket(dataPort, child),
        connectWebSocket(controlPort, child),
      ])
      if (generation !== this.generation) {
        dataSocket.close()
        controlSocket.close()
        return
      }
      this.dataSocket = dataSocket
      this.controlSocket = controlSocket
      dataSocket.on('message', (data, isBinary) => this.handleDataMessage(data, isBinary, generation, documentId))
      controlSocket.on('message', (data) => this.handleControlMessage(data.toString(), generation, documentId))
      this.sendMemoryFiles('syncMemoryFiles')
      dataSocket.send('current')
      this.status(documentId, 'ready', 'Source synchronization ready.')
      this.sendLocate(this.latestLocate)
    } catch (error) {
      if (generation !== this.generation) return
      this.status(documentId, 'error', error instanceof Error ? error.message : String(error))
      await this.stop(false)
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
    if (message.event === 'syncEditorChanges') this.sendMemoryFiles('syncMemoryFiles')
    if (message.event === 'compileStatus') {
      if (message.kind === 'CompileSuccess') {
        this.status(this.documentId, 'ready', 'Source synchronization ready.')
      } else if (message.kind === 'CompileError') {
        this.status(this.documentId, 'error', 'Tinymist could not compile the current source.')
      } else {
        this.status(this.documentId, 'starting', 'Updating source positions...')
      }
    }
  }

  handleDataMessage(data, isBinary, generation, documentId) {
    if (generation !== this.generation || documentId !== this.documentId) return
    if (!isBinary) return
    const buffer = Buffer.from(data)
    if (buffer.length < 5 || buffer.subarray(0, 5).toString('utf8') !== 'jump,') return
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
    this.controlSocket.send(JSON.stringify({ event, files: { [this.filePath]: this.source } }))
  }

  update({ documentId, source }) {
    if (documentId !== this.documentId) return
    this.source = source
    this.sendMemoryFiles('updateMemoryFiles')
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
      filepath: this.filePath,
      line,
      character,
    }))
  }

  async stop(incrementGeneration = true) {
    if (incrementGeneration) this.generation += 1
    this.dataSocket?.close()
    this.controlSocket?.close()
    this.dataSocket = undefined
    this.controlSocket = undefined
    clearTimeout(this.locateSettleTimer)
    this.locateSettleTimer = undefined
    this.latestLocate = undefined
    const child = this.child
    this.child = undefined
    this.documentId = undefined
    this.filePath = undefined
    if (child && child.exitCode === null) {
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
  }
}

module.exports = { TinymistService }
