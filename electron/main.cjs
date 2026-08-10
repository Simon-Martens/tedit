const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, session, shell } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { createBibliographyIpc } = require('./bibliography-ipc.cjs')
const { registerClipboardIpc } = require('./clipboard-ipc.cjs')
const { createDocumentFileIpc, getGitMetadata } = require('./document-file-ipc.cjs')
const { createDocumentRegistry } = require('./document-registry.cjs')
const { createDocumentWatcher, registerDocumentWatchIpc } = require('./document-watching.cjs')
const { createIpcSecurity } = require('./ipc-security.cjs')
const { installProcessFailureLogging, logFailure } = require('./logging.cjs')
const { registerPdfPrinting } = require('./pdf-printing.cjs')
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

// INFO: we log all uncauht faulures, always, very useful
installProcessFailureLogging()

app.setPath('userData', path.join(app.getPath('appData'), 'tedit'))
//
// BUG: sometimes it is faster on linux to disable hardware acc
if (process.env.TEDIT_DISABLE_HARDWARE_ACCELERATION === '1') app.disableHardwareAcceleration()

const isDevelopment = !app.isPackaged && Boolean(process.env.VITE_DEV_SERVER_URL)
const trustedWebContentsIds = new Set()

// INFO: We have a server to dynamically serve interface comonents in dev mode, so relaods can happen faster using the power of vite.
// Bundled, the index.html and everything si bundled with the application. No web server is neccessary. 
const appEntryUrl = isDevelopment
  ? new URL(process.env.VITE_DEV_SERVER_URL).href
  : pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href
const appIconPath = isDevelopment
  ? path.join(__dirname, '..', 'build', 'icon.png')
  : path.join(process.resourcesPath, 'icon.png')

// INFO: tedit-docs:// our custom protocol for this app. This is only the REGISTRATION not the ACTIVATION OF THE HANDLER
// These are the Typst docs embedded in the program
registerDocumentationScheme(protocol)

// INFO: we have ONE tedit process -- settings, session, recovery, tinymist caches etc are unable to handle multiple windows/tedits
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  void Promise.resolve().then(startPrimaryInstance).catch((error) => {
    logFailure('startup', error)
    app.quit()
  })
}

function startPrimaryInstance() {
  const { handleIpc, onIpc } = createIpcSecurity({ appEntryUrl, ipcMain, trustedWebContentsIds })

  // INFO: this is one of the most important application-specific types. It tracks documents, document roots etc
  const registry = createDocumentRegistry()

  // INFO: simple -- we just broadcast every single event to every window (simple -- we dont have many windows)
  const sendToWindows = (channel, payload) => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, payload)
  }
  const watcher = createDocumentWatcher({ registry, sendToWindows })
  // IPCs: settings:get and settings:update
  const settingsPersistence = createSettingsPersistence({ app, handleIpc })
  // INFO: Session storage, sores open documents, and state currently: focused document, open documents
  // (recovery:save, recovery:clear, session: restore, session:save). On opening we just call registry.rememberDocument() and it's all remembered.
  const sessionRecoveryPersistence = createSessionRecoveryPersistence({
    app,
    getGitMetadata,
    handleIpc,
    registry,
  })
  // INFO: Both of these return a pendingWrite() function, that allows for finishing of writing sessions/settings when the editor closes

  // INFO: We discover available previews in the document root; we do it in a worker because of FS access
  // (document:discover-preview-roots, document:stop-preview-root-discovery)
  const previewDiscovery = createPreviewDiscovery({
    handleIpc,
    onIpc,
    registry,
    workerPath: path.join(__dirname, 'preview-root-discovery-worker.cjs'),
  })


  // bibliography:discover, bibliography:create-default ,bibliography:save, bibliography:stop
  // INFO: Requires previewDiscovery; to see if root discovery is allowed at all
  const bibliographyIpc = createBibliographyIpc({
    handleIpc,
    isAllowedPreviewRoot: previewDiscovery.isAllowedPreviewRoot,
    onIpc,
    registry,
  })

  // INFO: Our TinyMist controller, finally
  // - Preview Generation
  //  tinymist:start, tinymist:update, tinymist:locate, tinymist:reveal-source, tinymist:refresh, tinymist:stop
  // - Document Diagnostics
  // tinymist-lsp:start, tinymist-lsp:sync-documents, tinymist-lsp:complete, tinymist-lsp:semantic-tokens, tinymist-lsp:compile, tinymist-lsp:stop
  // - Autocompletion
  // - Highlighting
  // - PDF Export
  // - Preview-To-Source and Source-To-Preview Nav
	// We have essentially two TinyMist Sevices: TinymistService for Preview and PDF process and TinymistLspService for LSP features
  const tinymistController = createTinymistIpcController({
    app,
    handleIpc,
    isAllowedPreviewRoot: previewDiscovery.isAllowedPreviewRoot,
    onIpc,
    registry,
    sendToWindows,
  })

  // INFO: the lifecycle of our windows. Manages dialoges for unsaved docs. Waits for file writes before closing, shutdown tinymist etc..
  // app:resolve-close, app:acknowledge-close, app:complete-close
  // CREATES THE WINDOW
  const windowLifecycle = createWindowLifecycle({
    BrowserWindow,
    appEntryUrl,
    appIconPath,
    dialog,
    handleIpc,
    isDevelopment,
    net,
    onIpc,
    stopBibliography: bibliographyIpc.revokeForWebContents,
    stopPreviewDiscovery: previewDiscovery.stopForWebContents,
    stopTinymist: tinymistController.stopForWebContents,
    trustedWebContentsIds,
  })

  // document:open, document:save, document:delete, document:resolve-conflict
  // INFo: does all the work on opening, saving, deleting a file
  // resolve-confict is shown when  adocument was changed outside of tedit
  createDocumentFileIpc({ BrowserWindow, dialog, handleIpc, registry, shell })
  // INFO: we connect the prev created renderer to the watcher. Provides document: watch
  registerDocumentWatchIpc({ handleIpc, watcher })

  registerClipboardIpc({ clipboard, onIpc })

	// pdf:print
	// INFO: naive validation of pdf print data -- max 256 MB -- temporary file -- sandboxed browser window + chromium print API
  registerPdfPrinting({ app, BrowserWindow, handleIpc })
	// INFO: When getting a second window open request we foxus the first instance
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.focus()
  })

	// Let's go, here we start it all
  async function startApplication() {
    await app.whenReady()
		// INFO: disables electrons default app menu -- not really applicable on MacOS
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

		// See: runtime-security.cjs
    configurePermissions({
      appEntryUrl,
      isDevelopment,
      onDevelopmentNetworkChange: windowLifecycle.scheduleDevelopmentRecovery,
      session,
      trustedWebContentsIds,
    })

		// INFO: Now we register the Typst documentation handler (above was jsut the scheme registation)
    configureDocumentationProtocol({ isDevelopment, net, protocol, resourcesPath: process.resourcesPath })

		// INFO: here we create the winow, that was configured above in the windowLifecycle
    windowLifecycle.createWindow()

		// INFO: activate very important on MacOS, because tedit remains active there in the doc
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) windowLifecycle.createWindow()
    })
  }

  let shutdownPromise
  let shutdownComplete = false

  function stopWindowServices() {
    watcher.stop()
    bibliographyIpc.stopAll()
    previewDiscovery.stopAll()
  }

  function prepareShutdown() {
    if (shutdownPromise) return shutdownPromise
    stopWindowServices()
    const [sessionWrite, recoveryWrite] = sessionRecoveryPersistence.pendingWrites()
    const operations = [
      ['tinymist', Promise.resolve().then(() => tinymistController.stop())],
      ['settings', Promise.resolve().then(() => settingsPersistence.pendingWrite())],
      ['session', sessionWrite],
      ['recovery', recoveryWrite],
    ]
    shutdownPromise = Promise.allSettled(operations.map(([, operation]) => operation)).then((results) => {
      results.forEach((result, index) => {
        if (result.status === 'rejected') logFailure('shutdown', result.reason, { operation: operations[index][0] })
      })
      shutdownComplete = true
    })
    return shutdownPromise
  }

  // INFO: some shutdown management when clicking the X button or closing the window
  app.on('window-all-closed', () => {
    if (process.platform === 'darwin') {
      stopWindowServices()
      return
    }
    void prepareShutdown().then(() => app.quit())
  })

  // Idk why we only do this in this case (it handles OS shutdown etc)??
  app.on('will-quit', (event) => {
    if (shutdownComplete) return
    event.preventDefault()
    void prepareShutdown().then(() => app.quit())
  })

  return startApplication()
}
