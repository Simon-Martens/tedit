const path = require('node:path')
const { logFailure } = require('./logging.cjs')

function createWindowLifecycle({
  BrowserWindow,
  appEntryUrl,
  appIconPath,
  dialog,
  handleIpc,
  isDevelopment,
  onIpc,
  stopBibliography,
  stopPreviewDiscovery,
  trustedWebContentsIds,
}) {
  const windowCloseStates = new Map()

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
      stopBibliography(webContentsId)
      stopPreviewDiscovery(webContentsId)
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
      stopBibliography(webContentsId)
      stopPreviewDiscovery(webContentsId)
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

  return { createWindow }
}

module.exports = { createWindowLifecycle }
