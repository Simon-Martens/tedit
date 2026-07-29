const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, session } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createDocumentFileIpc, getGitMetadata } = require('./document-file-ipc.cjs')
const { createDocumentRegistry } = require('./document-registry.cjs')
const { createDocumentWatcher, registerDocumentWatchIpc } = require('./document-watching.cjs')
const { createIpcSecurity } = require('./ipc-security.cjs')
const { installProcessFailureLogging, logFailure } = require('./logging.cjs')
const { createPreviewDiscovery } = require('./preview-discovery.cjs')
const {
  configureDocumentationProtocol,
  configurePermissions,
  registerDocumentationScheme,
} = require('./runtime-security.cjs')
const { createSessionRecoveryPersistence } = require('./session-recovery-persistence.cjs')
const { createSettingsPersistence } = require('./settings-persistence.cjs')
const { createTinymistIpcController } = require('./tinymist-ipc-controller.cjs')
const { createWindowLifecycle } = require('./window-lifecycle.cjs')

app.setPath('userData', path.join(app.getPath('appData'), 'tedit'))

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL)
const appEntryUrl = isDevelopment
  ? new URL(process.env.VITE_DEV_SERVER_URL).href
  : pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href
const appIconPath = isDevelopment
  ? path.join(__dirname, '..', 'build', 'icon.png')
  : path.join(process.resourcesPath, 'icon.png')
const trustedWebContentsIds = new Set()

installProcessFailureLogging()
registerDocumentationScheme(protocol)

// PDFium text rendering is unreliable with Electron's Vulkan path on Wayland.
if (process.platform === 'linux') app.commandLine.appendSwitch('disable-features', 'Vulkan')

const { handleIpc, onIpc } = createIpcSecurity({ appEntryUrl, ipcMain, trustedWebContentsIds })
const registry = createDocumentRegistry()
const sendToWindows = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload)
}
const watcher = createDocumentWatcher({ registry, sendToWindows })
const settingsPersistence = createSettingsPersistence({ app, handleIpc })
const sessionRecoveryPersistence = createSessionRecoveryPersistence({
  app,
  getGitMetadata,
  handleIpc,
  registry,
})
const previewDiscovery = createPreviewDiscovery({
  handleIpc,
  onIpc,
  registry,
  workerPath: path.join(__dirname, 'preview-root-discovery-worker.cjs'),
})
const tinymistController = createTinymistIpcController({
  app,
  handleIpc,
  isAllowedPreviewRoot: previewDiscovery.isAllowedPreviewRoot,
  onIpc,
  registry,
  sendToWindows,
})
const windowLifecycle = createWindowLifecycle({
  BrowserWindow,
  appEntryUrl,
  appIconPath,
  dialog,
  handleIpc,
  isDevelopment,
  onIpc,
  stopPreviewDiscovery: previewDiscovery.stopForWebContents,
  trustedWebContentsIds,
})

createDocumentFileIpc({ BrowserWindow, dialog, handleIpc, registry })
registerDocumentWatchIpc({ handleIpc, watcher })

onIpc('clipboard:read', (event) => {
  event.returnValue = clipboard.readText()
}, '')
onIpc('clipboard:write', (event, text) => {
  clipboard.writeText(typeof text === 'string' ? text : '')
  event.returnValue = undefined
}, null)

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
    configurePermissions({ appEntryUrl, isDevelopment, session, trustedWebContentsIds })
    configureDocumentationProtocol({ isDevelopment, net, protocol, resourcesPath: process.resourcesPath })
    windowLifecycle.createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) windowLifecycle.createWindow()
    })
  }).catch((error) => {
    logFailure('startup', error)
    app.quit()
  })
}

app.on('window-all-closed', () => {
  watcher.stop()
  previewDiscovery.stopAll()
  void Promise.all([
    tinymistController.stop(),
    settingsPersistence.pendingWrite(),
    ...sessionRecoveryPersistence.pendingWrites(),
  ]).finally(() => {
    if (process.platform === 'linux') app.exit(0)
    else if (process.platform !== 'darwin') app.quit()
  })
})
