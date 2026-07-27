const { app, BrowserWindow, dialog, ipcMain, Menu, session } = require('electron')
const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { promisify } = require('node:util')

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL)
const execFileAsync = promisify(execFile)
const allowedDocumentPaths = new Set()

// PDFium text rendering is unreliable with Electron's Vulkan path on Wayland.
if (process.platform === 'linux') app.commandLine.appendSwitch('disable-features', 'Vulkan')

async function getGitCommit(filePath) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', path.dirname(filePath), 'rev-parse', '--short=8', 'HEAD'],
      { timeout: 3000 },
    )
    return stdout.trim() || undefined
  } catch {
    return undefined
  }
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: '#11120f',
    title: 'Typst Edit',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

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
  allowedDocumentPaths.add(path.resolve(filePath))
  return {
    filePath,
    name: path.basename(filePath),
    content: await fs.readFile(filePath, 'utf8'),
    commit: await getGitCommit(filePath),
  }
})

ipcMain.handle('document:save', async (_event, request) => {
  let filePath = request.filePath ? path.resolve(request.filePath) : undefined

  if (filePath && !allowedDocumentPaths.has(filePath)) {
    throw new Error('Refusing to write a file that was not opened by Typst Edit.')
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
  allowedDocumentPaths.add(path.resolve(filePath))
  return {
    filePath,
    name: path.basename(filePath),
    commit: await getGitCommit(filePath),
  }
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
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
