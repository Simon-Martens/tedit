const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { promisify } = require('node:util')
const { TinymistService } = require('./tinymist-service.cjs')
const { TinymistLspService } = require('./tinymist-lsp-service.cjs')

app.setPath('userData', path.join(app.getPath('appData'), 'tedit'))

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL)
const execFileAsync = promisify(execFile)
const allowedDocumentPaths = new Set()
const defaultSettings = {
  vimEnabled: false,
  showPreviewPosition: false,
  autoScrollEnabled: true,
  lightThemeEnabled: false,
  foldingEnabled: true,
}
const settingsPath = path.join(app.getPath('userData'), 'settings.json')
const sessionPath = path.join(app.getPath('cache'), 'tedit', 'session.json')
let settingsWrite = Promise.resolve()
let sessionWrite = Promise.resolve()
const tinymist = new TinymistService((channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload)
})
const tinymistLsp = new TinymistLspService((channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload)
})

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
    if (error?.code === 'ENOENT' || error instanceof SyntaxError) return { ...defaultSettings }
    throw error
  }
}

ipcMain.handle('settings:get', readSettings)
ipcMain.handle('settings:update', (_event, update) => {
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

ipcMain.on('clipboard:read', (event) => {
  event.returnValue = clipboard.readText()
})
ipcMain.on('clipboard:write', (event, text) => {
  clipboard.writeText(typeof text === 'string' ? text : '')
  event.returnValue = undefined
})

async function getGitMetadata(filePath) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', path.dirname(filePath), 'rev-parse', '--show-toplevel', '--short=8', 'HEAD'],
      { timeout: 3000 },
    )
    const [root, commit] = stdout.trim().split(/\r?\n/)
    return { repoName: path.basename(root), commit: commit || undefined }
  } catch {
    return {}
  }
}

function normalizeSession(value) {
  const filePaths = [...new Set((Array.isArray(value?.filePaths) ? value.filePaths : [])
    .filter((filePath) => typeof filePath === 'string')
    .map((filePath) => path.resolve(filePath)))]
  const activeFilePath = typeof value?.activeFilePath === 'string'
    ? path.resolve(value.activeFilePath)
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

ipcMain.handle('session:restore', async () => {
  const stored = await readSession()
  const restored = await Promise.all(stored.filePaths.map(async (filePath) => {
    try {
      const content = await fs.readFile(filePath, 'utf8')
      const gitMetadata = await getGitMetadata(filePath)
      allowedDocumentPaths.add(filePath)
      return {
        filePath,
        name: path.basename(filePath),
        content,
        ...gitMetadata,
      }
    } catch {
      return undefined
    }
  }))
  const documents = restored.filter(Boolean)
  return {
    documents,
    activeFilePath: documents.some(({ filePath }) => filePath === stored.activeFilePath)
      ? stored.activeFilePath
      : documents[0]?.filePath,
  }
})

ipcMain.handle('session:save', (_event, update) => {
  sessionWrite = sessionWrite.catch(() => undefined).then(async () => {
    const requested = normalizeSession(update)
    const stored = normalizeSession({
      filePaths: requested.filePaths.filter((filePath) => allowedDocumentPaths.has(filePath)),
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
    title: 'tedit',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || (!input.control && !input.meta)) return
    const command = input.key.toLowerCase()
    if (command === 'c') window.webContents.copy()
    else if (command === 'x') window.webContents.cut()
    else if (command === 'v') window.webContents.paste()
    else return
    event.preventDefault()
  })

  if (isDevelopment) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }
}

function isAppOrigin(origin) {
  try {
    const url = new URL(origin)
    return url.protocol === 'file:' || (
      url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    )
  } catch {
    return false
  }
}

function configurePermissions() {
  const appSession = session.defaultSession
  appSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (permission === 'local-fonts' || permission === 'localFonts') {
      return isAppOrigin(requestingOrigin)
    }
    return false
  })
  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'local-fonts' || permission === 'localFonts') {
      const origin = details.requestingUrl || webContents.getURL()
      callback(isAppOrigin(origin))
      return
    }
    callback(false)
  })
}

ipcMain.handle('document:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open Typst document',
    properties: ['openFile'],
    filters: [{ name: 'Typst documents', extensions: ['typ'] }],
  })

  if (result.canceled || !result.filePaths[0]) return null

  const filePath = result.filePaths[0]
  const [content, gitMetadata] = await Promise.all([
    fs.readFile(filePath, 'utf8'),
    getGitMetadata(filePath),
  ])
  allowedDocumentPaths.add(path.resolve(filePath))
  return {
    filePath,
    name: path.basename(filePath),
    content,
    ...gitMetadata,
  }
})

ipcMain.handle('document:save', async (_event, request) => {
  let filePath = request.filePath ? path.resolve(request.filePath) : undefined

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
    filePath = result.filePath.toLowerCase().endsWith('.typ')
      ? result.filePath
      : `${result.filePath}.typ`
  }

  await fs.writeFile(filePath, request.content, 'utf8')
  const gitMetadata = await getGitMetadata(filePath)
  allowedDocumentPaths.add(path.resolve(filePath))
  return {
    filePath,
    name: path.basename(filePath),
    ...gitMetadata,
  }
})

ipcMain.handle('tinymist:start', async (_event, request) => {
  const filePath = path.resolve(request.filePath)
  if (!allowedDocumentPaths.has(filePath)) {
    throw new Error('Tinymist can only inspect a document opened by tedit.')
  }
  void tinymist.start({ ...request, filePath })
})

ipcMain.on('tinymist:update', (_event, request) => tinymist.update(request))
ipcMain.on('tinymist:locate', (_event, request) => tinymist.locate(request))
ipcMain.on('tinymist:stop', () => void tinymist.stop())

ipcMain.handle('tinymist-lsp:start', async (_event, request) => {
  const filePath = path.resolve(request.filePath)
  if (!allowedDocumentPaths.has(filePath)) {
    throw new Error('Tinymist can only inspect a document opened by tedit.')
  }
  void tinymistLsp.start({ ...request, filePath })
})
ipcMain.on('tinymist-lsp:update', (_event, request) => tinymistLsp.update(request))
ipcMain.on('tinymist-lsp:stop', () => void tinymistLsp.stop())

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
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  void Promise.all([tinymist.stop(), tinymistLsp.stop()]).finally(() => {
    if (process.platform === 'linux') app.exit(0)
    else if (process.platform !== 'darwin') app.quit()
  })
})
