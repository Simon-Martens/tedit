const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, session } = require('electron')
const { execFile } = require('node:child_process')
const { createHash } = require('node:crypto')
const nativeFs = require('node:fs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { promisify } = require('node:util')
const { Worker } = require('node:worker_threads')
const { TinymistService } = require('./tinymist-service.cjs')
const { formatTinymistExportError, TinymistLspService } = require('./tinymist-lsp-service.cjs')

app.setPath('userData', path.join(app.getPath('appData'), 'tedit'))

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL)
const appEntryUrl = isDevelopment
  ? new URL(process.env.VITE_DEV_SERVER_URL).href
  : pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href
const appIconPath = isDevelopment
  ? path.join(__dirname, '..', 'build', 'icon.png')
  : path.join(process.resourcesPath, 'icon.png')
const execFileAsync = promisify(execFile)
const allowedDocumentPaths = new Set()
const previewRootsBySource = new Map()
const workspaceRootsByDocument = new Map()
const previewDiscoveryWorkers = new Map()
const windowCloseStates = new Map()
const diskVersions = new Map()
const documentWatchers = new Map()
const watchedDocumentPaths = new Set()
const documentWatchTimers = new Map()
const documentWatcherRetryTimers = new Map()
const documentInspectionGenerations = new Map()
const documentSaveQueues = new Map()
const unavailableSessionPaths = new Set()
const trustedWebContentsIds = new Set()
const defaultSettings = {
  vimEnabled: false,
  showPreviewPosition: false,
  autoScrollEnabled: true,
  lightThemeEnabled: false,
  foldingEnabled: true,
}
const settingsPath = path.join(app.getPath('userData'), 'settings.json')
const sessionPath = path.join(app.getPath('cache'), 'tedit', 'session.json')
const recoveryPath = path.join(app.getPath('userData'), 'recovery.json')
let settingsWrite = Promise.resolve()
let sessionWrite = Promise.resolve()
let recoveryWrite = Promise.resolve()
let tinymistLspStartGeneration = 0
let documentWatchGeneration = 0
let documentWatchRequestedDirectories = 0
const maximumWatchedDocuments = 256
const maximumDocumentWatchDirectories = 256
const documentWatcherRetryDelays = [250, 500, 1000, 2000, 4000]
const tinymist = new TinymistService((channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload)
})
const tinymistLsp = new TinymistLspService((channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload)
})

function formatFailure(error) {
  if (error instanceof Error) return error.stack || error.message
  return String(error)
}

function logFailure(scope, error, details) {
  const suffix = details ? ` ${JSON.stringify(details)}` : ''
  console.error(`[tedit:${scope}]${suffix}\n${formatFailure(error)}`)
}

process.on('uncaughtExceptionMonitor', (error, origin) => logFailure('uncaught-exception', error, { origin }))
process.on('unhandledRejection', (error) => logFailure('unhandled-rejection', error))

function assertTrustedIpc(event, channel) {
  const frame = event.senderFrame
  if (
    !trustedWebContentsIds.has(event.sender.id)
    || !frame
    || frame !== event.sender.mainFrame
    || frame.url !== appEntryUrl
  ) {
    throw new Error(`Rejected IPC ${channel} from ${frame?.url ?? 'an unavailable frame'}.`)
  }
}

function handleIpc(channel, listener) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      assertTrustedIpc(event, channel)
      return await listener(event, ...args)
    } catch (error) {
      logFailure(`ipc:${channel}`, error)
      throw error
    }
  })
}

function onIpc(channel, listener, fallback) {
  ipcMain.on(channel, (event, ...args) => {
    try {
      assertTrustedIpc(event, channel)
      const result = listener(event, ...args)
      if (result && typeof result.then === 'function') {
        result.catch((error) => logFailure(`ipc:${channel}`, error))
      }
    } catch (error) {
      logFailure(`ipc:${channel}`, error)
      if (fallback !== undefined) event.returnValue = fallback
    }
  })
}

function normalizeDocumentPath(filePath) {
  return path.normalize(path.resolve(filePath))
}

function normalizeLanguageServerDocuments(documents) {
  return (Array.isArray(documents) ? documents : []).flatMap((document) => {
    if (
      typeof document?.documentId !== 'string'
      || !document.filePath
      || typeof document.source !== 'string'
      || !Number.isSafeInteger(document.version)
    ) return []
    const filePath = normalizeDocumentPath(document.filePath)
    if (!allowedDocumentPaths.has(filePath)) return []
    return [{
      documentId: document.documentId,
      filePath,
      source: document.source,
      version: document.version,
    }]
  })
}

function contentVersion(content) {
  return createHash('sha256').update(content).digest('hex')
}

function rememberDocument(filePath, content) {
  const normalizedPath = normalizeDocumentPath(filePath)
  const diskVersion = contentVersion(content)
  allowedDocumentPaths.add(normalizedPath)
  unavailableSessionPaths.delete(normalizedPath)
  if (!workspaceRootsByDocument.has(normalizedPath)) {
    workspaceRootsByDocument.set(normalizedPath, path.dirname(normalizedPath))
  }
  diskVersions.set(normalizedPath, diskVersion)
  return { filePath: normalizedPath, diskVersion }
}

function sendToWindows(channel, payload) {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload)
}

function documentWatchStatus(state, message) {
  return {
    state,
    message,
    watchedDirectories: documentWatchers.size,
    requestedDirectories: documentWatchRequestedDirectories,
  }
}

function publishDocumentWatchStatus(state, message) {
  const status = documentWatchStatus(state, message)
  sendToWindows('document:watch-status', status)
  return status
}

async function inspectWatchedDocument(filePath, generation, watchGeneration, retries = 3) {
  if (watchGeneration !== documentWatchGeneration || !watchedDocumentPaths.has(filePath)) return
  try {
    const content = await fs.readFile(filePath, 'utf8')
    if (
      watchGeneration !== documentWatchGeneration
      || !watchedDocumentPaths.has(filePath)
      || documentInspectionGenerations.get(filePath) !== generation
    ) return
    const diskVersion = contentVersion(content)
    if (diskVersions.get(filePath) === diskVersion) return
    diskVersions.set(filePath, diskVersion)
    sendToWindows('document:change', { filePath, kind: 'changed', content, diskVersion })
  } catch (error) {
    if (
      watchGeneration !== documentWatchGeneration
      || !watchedDocumentPaths.has(filePath)
      || documentInspectionGenerations.get(filePath) !== generation
    ) return
    if (retries > 0) {
      const timer = setTimeout(() => {
        if (documentWatchTimers.get(filePath) === timer) documentWatchTimers.delete(filePath)
        void inspectWatchedDocument(filePath, generation, watchGeneration, retries - 1)
      }, 75)
      clearTimeout(documentWatchTimers.get(filePath))
      documentWatchTimers.set(filePath, timer)
      return
    }
    if (error?.code !== 'ENOENT') {
      logFailure('document-watch-read', error, { filePath })
      publishDocumentWatchStatus('degraded', `Could not inspect ${path.basename(filePath)}. External changes may be delayed.`)
      return
    }
    if (!diskVersions.has(filePath)) return
    diskVersions.delete(filePath)
    sendToWindows('document:change', { filePath, kind: 'deleted' })
  }
}

function scheduleDocumentInspection(filePath) {
  if (!watchedDocumentPaths.has(filePath)) return
  const watchGeneration = documentWatchGeneration
  const generation = (documentInspectionGenerations.get(filePath) ?? 0) + 1
  documentInspectionGenerations.set(filePath, generation)
  clearTimeout(documentWatchTimers.get(filePath))
  documentWatchTimers.set(filePath, setTimeout(() => {
    documentWatchTimers.delete(filePath)
    void inspectWatchedDocument(filePath, generation, watchGeneration)
  }, 100))
}

function installDocumentWatcher(directory, paths, generation, attempt = 0) {
  if (generation !== documentWatchGeneration) return false
  clearTimeout(documentWatcherRetryTimers.get(directory))
  documentWatcherRetryTimers.delete(directory)
  try {
    const watcher = nativeFs.watch(directory, (_eventType, filename) => {
      if (generation !== documentWatchGeneration || documentWatchers.get(directory) !== watcher) return
      if (!filename) {
        for (const filePath of paths) scheduleDocumentInspection(filePath)
        return
      }
      const changedPath = normalizeDocumentPath(path.join(directory, filename.toString()))
      if (paths.has(changedPath)) scheduleDocumentInspection(changedPath)
    })
    watcher.on('error', (error) => {
      if (generation !== documentWatchGeneration || documentWatchers.get(directory) !== watcher) return
      logFailure('document-watcher', error, { directory, attempt })
      watcher.close()
      documentWatchers.delete(directory)
      scheduleDocumentWatcherRetry(directory, paths, generation, 0)
    })
    documentWatchers.set(directory, watcher)
    if (documentWatchers.size === documentWatchRequestedDirectories) {
      publishDocumentWatchStatus('ready', `Watching ${watchedDocumentPaths.size} open document${watchedDocumentPaths.size === 1 ? '' : 's'}.`)
    }
    return true
  } catch (error) {
    logFailure('document-watcher-create', error, { directory, attempt })
    scheduleDocumentWatcherRetry(directory, paths, generation, attempt)
    return false
  }
}

function scheduleDocumentWatcherRetry(directory, paths, generation, attempt) {
  if (generation !== documentWatchGeneration) return
  if (attempt >= documentWatcherRetryDelays.length) {
    publishDocumentWatchStatus('degraded', `Could not watch ${path.basename(directory)} after ${attempt} retries. External changes may be missed.`)
    return
  }
  publishDocumentWatchStatus('degraded', `File watching is degraded. Retrying ${path.basename(directory)}.`)
  const timer = setTimeout(() => {
    if (documentWatcherRetryTimers.get(directory) === timer) documentWatcherRetryTimers.delete(directory)
    installDocumentWatcher(directory, paths, generation, attempt + 1)
  }, documentWatcherRetryDelays[attempt])
  documentWatcherRetryTimers.set(directory, timer)
}

async function watchDocuments(filePaths) {
  const requestedPaths = new Set((Array.isArray(filePaths) ? filePaths : [])
    .filter((filePath) => typeof filePath === 'string')
    .map(normalizeDocumentPath)
    .filter((filePath) => allowedDocumentPaths.has(filePath)))
  if (requestedPaths.size > maximumWatchedDocuments) {
    throw new Error(`Cannot watch more than ${maximumWatchedDocuments} open documents.`)
  }

  const directories = new Map()
  for (const filePath of requestedPaths) {
    const directory = path.dirname(filePath)
    const paths = directories.get(directory) ?? new Set()
    paths.add(filePath)
    directories.set(directory, paths)
  }
  if (directories.size > maximumDocumentWatchDirectories) {
    throw new Error(`Cannot watch documents in more than ${maximumDocumentWatchDirectories} directories.`)
  }
  const generation = ++documentWatchGeneration

  for (const filePath of requestedPaths) {
    if (!diskVersions.has(filePath)) {
      try {
        diskVersions.set(filePath, contentVersion(await fs.readFile(filePath, 'utf8')))
      } catch (error) {
        logFailure('document-watch-baseline', error, { filePath })
        continue
      }
    }
  }
  if (generation !== documentWatchGeneration) return documentWatchStatus('disabled', 'A newer file-watch configuration replaced this request.')

  for (const watcher of documentWatchers.values()) watcher.close()
  documentWatchers.clear()
  for (const timer of documentWatchTimers.values()) clearTimeout(timer)
  documentWatchTimers.clear()
  for (const timer of documentWatcherRetryTimers.values()) clearTimeout(timer)
  documentWatcherRetryTimers.clear()
  documentInspectionGenerations.clear()
  watchedDocumentPaths.clear()
  for (const filePath of requestedPaths) watchedDocumentPaths.add(filePath)
  documentWatchRequestedDirectories = directories.size

  if (!directories.size) return publishDocumentWatchStatus('disabled', 'No open files need filesystem watching.')
  let failed = false
  for (const [directory, paths] of directories) {
    if (!installDocumentWatcher(directory, paths, generation)) failed = true
  }
  return failed
    ? documentWatchStatus('degraded', 'Some document directories could not be watched. Retrying in the background.')
    : publishDocumentWatchStatus('ready', `Watching ${requestedPaths.size} open document${requestedPaths.size === 1 ? '' : 's'}.`)
}

function queueDocumentSave(filePath, save) {
  const previous = documentSaveQueues.get(filePath) ?? Promise.resolve()
  const queued = previous.catch(() => undefined).then(save)
  const tracked = queued.finally(() => {
    if (documentSaveQueues.get(filePath) === tracked) documentSaveQueues.delete(filePath)
  })
  documentSaveQueues.set(filePath, tracked)
  return tracked
}

protocol.registerSchemesAsPrivileged([{
  scheme: 'tedit-docs',
  privileges: { standard: true, secure: true, supportFetchAPI: true },
}])

function configureDocumentationProtocol() {
  const docsRoot = path.resolve(isDevelopment
    ? path.join(__dirname, '..', 'resources', 'typst-docs', 'site')
    : path.join(process.resourcesPath, 'typst-docs', 'site'))
  protocol.handle('tedit-docs', async (request) => {
    const url = new URL(request.url)
    if (url.protocol !== 'tedit-docs:' || url.hostname !== 'docs') {
      logFailure('docs-protocol', new Error(`Rejected documentation URL ${request.url}.`))
      return new Response('Forbidden', { status: 403 })
    }
    let relativePath
    try {
      relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    } catch (error) {
      logFailure('docs-decode', error, { url: request.url })
      return new Response('Bad request', { status: 400 })
    }
    let filePath = path.resolve(docsRoot, relativePath || 'index.html')
    if (filePath !== docsRoot && !filePath.startsWith(`${docsRoot}${path.sep}`)) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      const stats = await fs.stat(filePath)
      if (stats.isDirectory()) filePath = path.join(filePath, 'index.html')
    } catch (error) {
      if (!path.extname(filePath)) filePath = path.join(filePath, 'index.html')
      else logFailure('docs-stat', error, { filePath })
    }
    try {
      const response = await net.fetch(pathToFileURL(filePath).href)
      const headers = new Headers(response.headers)
      headers.set(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
      )
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    } catch (error) {
      logFailure('docs-protocol', error, { filePath })
      return new Response('Documentation unavailable', { status: 500 })
    }
  })
}

// PDFium text rendering is unreliable with Electron's Vulkan path on Wayland.
if (process.platform === 'linux') app.commandLine.appendSwitch('disable-features', 'Vulkan')

function normalizeSettings(settings) {
  return Object.fromEntries(Object.keys(defaultSettings).flatMap((key) => (
    typeof settings?.[key] === 'boolean' ? [[key, settings[key]]] : []
  )))
}

async function readSettings() {
  try {
    const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
    return { ...defaultSettings, ...normalizeSettings(settings) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { ...defaultSettings }
    if (error instanceof SyntaxError) {
      logFailure('settings-parse', error, { settingsPath })
      return { ...defaultSettings }
    }
    throw error
  }
}

handleIpc('settings:get', readSettings)
handleIpc('settings:update', (_event, update) => {
  settingsWrite = settingsWrite.catch(() => undefined).then(async () => {
    const settings = { ...await readSettings(), ...normalizeSettings(update) }
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    const temporaryPath = `${settingsPath}.tmp`
    await fs.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    await fs.rename(temporaryPath, settingsPath)
    return settings
  })
  return settingsWrite
})

onIpc('clipboard:read', (event) => {
  event.returnValue = clipboard.readText()
}, '')
onIpc('clipboard:write', (event, text) => {
  clipboard.writeText(typeof text === 'string' ? text : '')
  event.returnValue = undefined
}, null)

handleIpc('app:resolve-close', async (event, request) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const dirtyNames = (Array.isArray(request?.dirtyNames) ? request.dirtyNames : [])
    .filter((name) => typeof name === 'string')
    .slice(0, 20)
  const options = {
    type: 'warning',
    title: 'Unsaved documents',
    message: dirtyNames.length === 1
      ? `${dirtyNames[0]} has unsaved changes.`
      : `${dirtyNames.length} documents have unsaved changes.`,
    detail: dirtyNames.length > 1 ? dirtyNames.join('\n') : 'Choose what to do before closing tedit.',
    buttons: ['Save All', 'Discard Changes', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  }
  const result = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options)
  return ['save', 'discard', 'cancel'][result.response] ?? 'cancel'
})

onIpc('app:acknowledge-close', (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const state = owner ? windowCloseStates.get(owner.id) : undefined
  if (!state?.pending) return
  clearTimeout(state.timeout)
  state.timeout = undefined
})

onIpc('app:complete-close', (event, close) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  if (!owner) return
  const state = windowCloseStates.get(owner.id)
  if (!state) return
  clearTimeout(state.timeout)
  state.timeout = undefined
  state.pending = false
  if (!close) return
  state.approved = true
  owner.close()
})

async function getGitMetadata(filePath) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', path.dirname(filePath), 'rev-parse', '--show-toplevel', '--short=8', 'HEAD'],
      { timeout: 3000 },
    )
    const [root, commit] = stdout.trim().split(/\r?\n/)
    return { repoName: path.basename(root), commit: commit || undefined, workspaceRoot: root }
  } catch {
    return { workspaceRoot: path.dirname(filePath) }
  }
}

function normalizeSession(value) {
  const filePaths = [...new Set((Array.isArray(value?.filePaths) ? value.filePaths : [])
    .filter((filePath) => typeof filePath === 'string')
    .map(normalizeDocumentPath))]
  const activeFilePath = typeof value?.activeFilePath === 'string'
    ? normalizeDocumentPath(value.activeFilePath)
    : undefined
  return {
    filePaths,
    activeFilePath: activeFilePath && filePaths.includes(activeFilePath) ? activeFilePath : undefined,
  }
}

async function readSession() {
  try {
    return normalizeSession(JSON.parse(await fs.readFile(sessionPath, 'utf8')))
  } catch (error) {
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return normalizeSession({})
    throw error
  }
}

function normalizeRecovery(value) {
  const documents = (Array.isArray(value?.documents) ? value.documents : []).flatMap((document) => {
    if (
      typeof document?.name !== 'string'
      || typeof document.content !== 'string'
    ) return []
    return [{
      recoveryId: typeof document.recoveryId === 'string' ? document.recoveryId : undefined,
      filePath: typeof document.filePath === 'string'
        ? normalizeDocumentPath(document.filePath)
        : undefined,
      name: document.name,
      content: document.content,
    }]
  })
  const activeFilePath = typeof value?.activeFilePath === 'string'
    ? normalizeDocumentPath(value.activeFilePath)
    : undefined
  return { documents, activeFilePath }
}

async function readRecovery() {
  try {
    return normalizeRecovery(JSON.parse(await fs.readFile(recoveryPath, 'utf8')))
  } catch (error) {
    if (error?.code === 'ENOENT') return normalizeRecovery({})
    if (error instanceof SyntaxError) {
      logFailure('recovery-parse', error, { recoveryPath })
      return normalizeRecovery({})
    }
    throw error
  }
}

handleIpc('recovery:save', (_event, update) => {
  recoveryWrite = recoveryWrite.catch(() => undefined).then(async () => {
    const recovery = normalizeRecovery(update)
    await fs.mkdir(path.dirname(recoveryPath), { recursive: true })
    const temporaryPath = `${recoveryPath}.tmp`
    await fs.writeFile(temporaryPath, `${JSON.stringify(recovery, null, 2)}\n`, 'utf8')
    await fs.rename(temporaryPath, recoveryPath)
  })
  return recoveryWrite
})

handleIpc('recovery:clear', () => {
  recoveryWrite = recoveryWrite.catch(() => undefined).then(() => fs.rm(recoveryPath, { force: true }))
  return recoveryWrite
})

handleIpc('session:restore', async () => {
  const [stored, recovery] = await Promise.all([readSession(), readRecovery()])
  const restored = await Promise.all(stored.filePaths.map(async (filePath) => {
    try {
      const content = await fs.readFile(filePath, 'utf8')
      const gitMetadata = await getGitMetadata(filePath)
      const remembered = rememberDocument(filePath, content)
      workspaceRootsByDocument.set(remembered.filePath, gitMetadata.workspaceRoot)
      return {
        ...remembered,
        name: path.basename(remembered.filePath),
        content,
        ...gitMetadata,
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        unavailableSessionPaths.add(filePath)
        logFailure('session-restore-document', error, { filePath })
      }
      return undefined
    }
  }))
  const documents = restored.filter(Boolean)
  for (const recovered of recovery.documents) {
    if (!recovered.filePath) {
      documents.push({ ...recovered, isDirty: true })
      continue
    }
    const existingIndex = documents.findIndex(({ filePath }) => filePath === recovered.filePath)
    if (existingIndex >= 0) {
      if (documents[existingIndex].content === recovered.content) continue
      documents[existingIndex] = {
        ...documents[existingIndex],
        name: recovered.name,
        content: recovered.content,
        isDirty: true,
      }
      continue
    }
    allowedDocumentPaths.add(recovered.filePath)
    workspaceRootsByDocument.set(recovered.filePath, path.dirname(recovered.filePath))
    documents.push({ ...recovered, isDirty: true })
  }
  const preferredActivePath = recovery.activeFilePath ?? stored.activeFilePath
  return {
    documents,
    activeFilePath: documents.some(({ filePath }) => filePath === preferredActivePath)
      ? preferredActivePath
      : documents[0]?.filePath,
  }
})

handleIpc('session:save', (_event, update) => {
  sessionWrite = sessionWrite.catch(() => undefined).then(async () => {
    const requested = normalizeSession(update)
    const stored = normalizeSession({
      filePaths: [
        ...requested.filePaths.filter((filePath) => allowedDocumentPaths.has(filePath)),
        ...unavailableSessionPaths,
      ],
      activeFilePath: requested.activeFilePath,
    })
    await fs.mkdir(path.dirname(sessionPath), { recursive: true })
    const temporaryPath = `${sessionPath}.tmp`
    await fs.writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
    await fs.rename(temporaryPath, sessionPath)
  })
  return sessionWrite
})

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#11120f',
    icon: appIconPath,
    title: 'tedit',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  trustedWebContentsIds.add(window.webContents.id)
  const webContentsId = window.webContents.id
  const closeState = { approved: false, pending: false, timeout: undefined }
  windowCloseStates.set(window.id, closeState)

  window.on('close', (event) => {
    if (closeState.approved) return
    event.preventDefault()
    if (closeState.pending) return
    closeState.pending = true
    window.webContents.send('app:request-close')
    closeState.timeout = setTimeout(async () => {
      if (window.isDestroyed() || !closeState.pending) return
      try {
        const result = await dialog.showMessageBox(window, {
          type: 'warning',
          title: 'tedit is not responding',
          message: 'The editor did not respond to the close request.',
          buttons: ['Cancel', 'Close Anyway'],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        })
        closeState.pending = false
        if (result.response === 1) {
          closeState.approved = true
          window.close()
        }
      } catch (error) {
        closeState.pending = false
        logFailure('close-timeout-dialog', error)
      }
    }, 8000)
  })
  window.once('closed', () => {
    clearTimeout(closeState.timeout)
    windowCloseStates.delete(window.id)
    trustedWebContentsIds.delete(webContentsId)
    const worker = previewDiscoveryWorkers.get(webContentsId)
    if (worker) void worker.terminate()
    previewDiscoveryWorkers.delete(webContentsId)
  })

  window.once('ready-to-show', () => window.show())
  const isDocumentationUrl = (value) => {
    try {
      const url = new URL(value)
      return url.protocol === 'tedit-docs:' && url.hostname === 'docs'
    } catch {
      return false
    }
  }
  const blockUnexpectedNavigation = (details) => {
    const allowed = details.isMainFrame
      ? details.url === appEntryUrl
      : isDocumentationUrl(details.url) || details.url === 'about:srcdoc'
    if (allowed) return
    details.preventDefault()
    logFailure('navigation', new Error(`Blocked navigation to ${details.url}.`))
  }
  window.webContents.on('will-frame-navigate', blockUnexpectedNavigation)
  window.webContents.on('will-redirect', blockUnexpectedNavigation)
  window.webContents.setWindowOpenHandler(({ url }) => {
    logFailure('window-open', new Error(`Blocked new window for ${url}.`))
    return { action: 'deny' }
  })
  window.webContents.on('console-message', (details) => {
    if (details.level !== 'warning' && details.level !== 'error') return
    const logger = details.level === 'error' ? console.error : console.warn
    logger(`[tedit:renderer] ${details.message} (${details.sourceId || 'unknown'}:${details.lineNumber || 0})`)
  })
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    logFailure('preload', error, { preloadPath })
  })
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    if (code !== -3) logFailure('load', new Error(description), { code, url, isMainFrame })
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    logFailure('renderer-gone', new Error(details.reason), details)
    const worker = previewDiscoveryWorkers.get(webContentsId)
    if (worker) void worker.terminate()
    previewDiscoveryWorkers.delete(webContentsId)
  })
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || (!input.control && !input.meta)) return
    const command = input.key.toLowerCase()
    if (command === 'c') window.webContents.copy()
    else if (command === 'x') window.webContents.cut()
    else if (command === 'v') window.webContents.paste()
    else return
    event.preventDefault()
  })

  const load = isDevelopment
    ? window.loadURL(appEntryUrl)
    : window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  void load.catch((error) => logFailure('window-load', error, { url: appEntryUrl }))
}

function isAppOrigin(webContents, origin) {
  if (!webContents || !trustedWebContentsIds.has(webContents.id)) return false
  try {
    const url = new URL(origin)
    return isDevelopment
      ? url.origin === new URL(appEntryUrl).origin
      : url.protocol === 'file:'
  } catch {
    return false
  }
}

function configurePermissions() {
  const appSession = session.defaultSession
  appSession.webRequest.onErrorOccurred((details) => {
    if (trustedWebContentsIds.has(details.webContentsId)) {
      logFailure('network', new Error(details.error), {
        method: details.method,
        resourceType: details.resourceType,
        url: details.url,
      })
    }
  })
  appSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission === 'local-fonts' || permission === 'localFonts') {
      return isAppOrigin(webContents, requestingOrigin)
    }
    return false
  })
  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'local-fonts' || permission === 'localFonts') {
      const origin = details.requestingUrl || webContents.getURL()
      callback(isAppOrigin(webContents, origin))
      return
    }
    callback(false)
  })
}

handleIpc('document:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open Typst document',
    properties: ['openFile'],
    filters: [{ name: 'Typst documents', extensions: ['typ'] }],
  })

  if (result.canceled || !result.filePaths[0]) return null

  const filePath = normalizeDocumentPath(result.filePaths[0])
  const [content, gitMetadata] = await Promise.all([
    fs.readFile(filePath, 'utf8'),
    getGitMetadata(filePath),
  ])
  const remembered = rememberDocument(filePath, content)
  workspaceRootsByDocument.set(remembered.filePath, gitMetadata.workspaceRoot)
  return {
    ...remembered,
    name: path.basename(filePath),
    content,
    ...gitMetadata,
  }
})

handleIpc('document:save', async (_event, request) => {
  let filePath = request.filePath ? normalizeDocumentPath(request.filePath) : undefined
  const shouldValidateDiskVersion = Boolean(filePath)

  if (filePath && !allowedDocumentPaths.has(filePath)) {
    throw new Error('Refusing to write a file that was not opened by tedit.')
  }

  if (!filePath) {
    const result = await dialog.showSaveDialog({
      title: 'Save Typst document',
      defaultPath: request.name,
      filters: [{ name: 'Typst documents', extensions: ['typ'] }],
    })
    if (result.canceled || !result.filePath) return null
    filePath = normalizeDocumentPath(result.filePath.toLowerCase().endsWith('.typ')
      ? result.filePath
      : `${result.filePath}.typ`)
  }

  return queueDocumentSave(filePath, async () => {
    if (shouldValidateDiskVersion && 'expectedDiskVersion' in request) {
      try {
        const content = await fs.readFile(filePath, 'utf8')
        const diskVersion = contentVersion(content)
        if (request.expectedDiskVersion === null || diskVersion !== request.expectedDiskVersion) {
          diskVersions.set(filePath, diskVersion)
          return { filePath, kind: 'changed', content, diskVersion }
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error
        if (request.expectedDiskVersion !== null) return { filePath, kind: 'deleted' }
      }
    }

    const temporaryPath = `${filePath}.tedit-${process.pid}-${Date.now()}.tmp`
    try {
      await fs.writeFile(temporaryPath, request.content, 'utf8')
      await fs.rename(temporaryPath, filePath)
    } finally {
      await fs.rm(temporaryPath, { force: true }).catch((error) => {
        logFailure('document-save-cleanup', error, { temporaryPath })
      })
    }
    const remembered = rememberDocument(filePath, request.content)
    const gitMetadata = await getGitMetadata(filePath)
    workspaceRootsByDocument.set(remembered.filePath, gitMetadata.workspaceRoot)
    return {
      ...remembered,
      name: path.basename(filePath),
      ...gitMetadata,
    }
  })
})

handleIpc('document:watch', (_event, filePaths) => watchDocuments(filePaths))
handleIpc('document:resolve-conflict', async (event, request) => {
  const owner = BrowserWindow.fromWebContents(event.sender)
  const deleted = Boolean(request?.deleted)
  const options = {
    type: 'warning',
    title: deleted ? 'File deleted outside tedit' : 'File changed outside tedit',
    message: deleted
      ? `${request.name} was deleted outside tedit.`
      : `${request.name} changed on disk while you have unsaved edits.`,
    detail: deleted
      ? 'Keep the editor version to recreate it on the next save.'
      : 'Reloading discards your unsaved edits. Keeping them allows the next save to replace the disk version.',
    buttons: deleted ? ['Keep Editor Version'] : ['Reload from Disk', 'Keep My Changes'],
    defaultId: 0,
    cancelId: deleted ? 0 : 1,
    noLink: true,
  }
  const result = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options)
  return !deleted && result.response === 0 ? 'reload' : 'keep'
})

handleIpc('document:discover-preview-roots', async (event, request) => {
  const filePath = normalizeDocumentPath(request.filePath)
  if (!allowedDocumentPaths.has(filePath)) {
    throw new Error('Preview roots can only be discovered for a document opened by tedit.')
  }
  const openDocuments = (Array.isArray(request.openDocuments) ? request.openDocuments : [])
    .flatMap((document) => {
      if (!document?.filePath || typeof document.source !== 'string') return []
      const documentPath = normalizeDocumentPath(document.filePath)
      if (!allowedDocumentPaths.has(documentPath)) return []
      return [{ filePath: documentPath, source: document.source }]
    })
  previewDiscoveryWorkers.get(event.sender.id)?.terminate()
  const worker = new Worker(path.join(__dirname, 'preview-root-discovery-worker.cjs'), {
    workerData: {
      filePath,
      rootDirectory: workspaceRootsByDocument.get(filePath) ?? path.dirname(filePath),
      openDocuments,
    },
  })
  previewDiscoveryWorkers.set(event.sender.id, worker)

  const roots = await new Promise((resolve, reject) => {
    let settled = false
    let lastRoots = []
    const timeout = setTimeout(() => {
      if (settled || previewDiscoveryWorkers.get(event.sender.id) !== worker) return
      settled = true
      previewDiscoveryWorkers.delete(event.sender.id)
      void worker.terminate()
      reject(new Error('Preview-root discovery did not produce a result within 20 seconds.'))
    }, 20_000)
    worker.on('message', (result) => {
      if (previewDiscoveryWorkers.get(event.sender.id) !== worker) return
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
        result.roots.map((root) => normalizeDocumentPath(root.filePath)),
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
      const wasCurrent = previewDiscoveryWorkers.get(event.sender.id) === worker
      if (wasCurrent) {
        previewDiscoveryWorkers.delete(event.sender.id)
      }
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
  return roots
})
onIpc('document:stop-preview-root-discovery', (event) => {
  const worker = previewDiscoveryWorkers.get(event.sender.id)
  if (worker) void worker.terminate()
  previewDiscoveryWorkers.delete(event.sender.id)
})

function isAllowedPreviewRoot(sourceFilePath, previewFilePath) {
  return sourceFilePath === previewFilePath
    || previewRootsBySource.get(sourceFilePath)?.has(previewFilePath)
}

handleIpc('tinymist:start', async (_event, request) => {
  const filePath = normalizeDocumentPath(request.filePath)
  const sourceFilePath = normalizeDocumentPath(request.sourceFilePath)
  if (!isAllowedPreviewRoot(sourceFilePath, filePath) || !allowedDocumentPaths.has(sourceFilePath)) {
    throw new Error('Tinymist can only inspect a discovered preview root and open source file.')
  }
  const memoryFiles = (Array.isArray(request.memoryFiles) ? request.memoryFiles : [])
    .flatMap((document) => {
      if (!document?.filePath || typeof document.source !== 'string') return []
      const documentPath = normalizeDocumentPath(document.filePath)
      if (!allowedDocumentPaths.has(documentPath)) return []
      return [{ filePath: documentPath, source: document.source }]
    })
  void tinymist.start({ ...request, filePath, sourceFilePath, memoryFiles })
})

onIpc('tinymist:update', (_event, request) => {
  const memoryFiles = (Array.isArray(request.memoryFiles) ? request.memoryFiles : [])
    .flatMap((document) => {
      if (!document?.filePath || typeof document.source !== 'string') return []
      const documentPath = normalizeDocumentPath(document.filePath)
      if (!allowedDocumentPaths.has(documentPath)) return []
      return [{ filePath: documentPath, source: document.source }]
    })
  tinymist.update({ ...request, memoryFiles })
})
onIpc('tinymist:locate', (_event, request) => tinymist.locate(request))
onIpc('tinymist:stop', () => tinymist.stop())

handleIpc('tinymist-lsp:start', async (_event, request) => {
  const startGeneration = ++tinymistLspStartGeneration
  if (
    typeof request?.documentId !== 'string'
    || !/^[A-Za-z0-9-]{1,64}$/.test(request.documentId)
    || typeof request.source !== 'string'
    || !Number.isSafeInteger(request.version)
  ) throw new Error('Invalid Tinymist language-server start request.')
  const activeFilePath = request.filePath
    ? normalizeDocumentPath(request.filePath)
    : path.join(app.getPath('cache'), 'tedit', 'untitled', `${request.documentId}.typ`)
  const filePath = request.previewFilePath
    ? normalizeDocumentPath(request.previewFilePath)
    : activeFilePath
  if (request.filePath && !allowedDocumentPaths.has(activeFilePath)) {
    throw new Error('Tinymist can only inspect a document opened by tedit.')
  }
  if (request.previewFilePath && !isAllowedPreviewRoot(activeFilePath, filePath)) {
    throw new Error('Tinymist can only compile a discovered preview root.')
  }
  if (!request.filePath) await fs.mkdir(path.dirname(activeFilePath), { recursive: true })
  const openDocuments = normalizeLanguageServerDocuments(request.openDocuments)
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
    activeVersion: request.version,
    rootDiskBacked: !openRoot && filePath !== activeFilePath,
    openDocuments,
  })
})
handleIpc('tinymist-lsp:sync-documents', async (_event, request) => {
  const openDocuments = normalizeLanguageServerDocuments(request.openDocuments)
  await tinymistLsp.syncDocuments({ ...request, openDocuments })
})
handleIpc('tinymist-lsp:compile', async (_event, request) => {
  try {
    if (
      typeof request?.documentId !== 'string'
      || typeof request.source !== 'string'
      || !Number.isSafeInteger(request.version)
    ) throw new Error('Invalid Tinymist compile request.')
    const previewFilePath = request.previewFilePath
      ? normalizeDocumentPath(request.previewFilePath)
      : undefined
    const openDocuments = normalizeLanguageServerDocuments(request.openDocuments)
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

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    configurePermissions()
    configureDocumentationProtocol()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch((error) => {
    logFailure('startup', error)
    app.quit()
  })
}

app.on('window-all-closed', () => {
  for (const watcher of documentWatchers.values()) watcher.close()
  documentWatchers.clear()
  for (const timer of documentWatchTimers.values()) clearTimeout(timer)
  documentWatchTimers.clear()
  for (const timer of documentWatcherRetryTimers.values()) clearTimeout(timer)
  documentWatcherRetryTimers.clear()
  watchedDocumentPaths.clear()
  documentInspectionGenerations.clear()
  documentWatchGeneration += 1
  for (const worker of previewDiscoveryWorkers.values()) void worker.terminate()
  previewDiscoveryWorkers.clear()
  void Promise.all([
    tinymist.stop(),
    tinymistLsp.stop(),
    settingsWrite.catch((error) => logFailure('settings-shutdown', error)),
    sessionWrite.catch((error) => logFailure('session-shutdown', error)),
    recoveryWrite.catch((error) => logFailure('recovery-shutdown', error)),
  ]).finally(() => {
    if (process.platform === 'linux') app.exit(0)
    else if (process.platform !== 'darwin') app.quit()
  })
})
