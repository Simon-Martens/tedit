const path = require('node:path')
const { logFailure } = require('./logging.cjs')

function createWindowLifecycle({
  BrowserWindow,
  appEntryUrl,
  appIconPath,
  dialog,
  handleIpc,
  isDevelopment,
  net,
  onIpc,
  stopBibliography,
  stopPreviewDiscovery,
  stopTinymist,
  trustedWebContentsIds,
}) {
  const windowCloseStates = new Map()
  const DEVELOPMENT_RECOVERY_SETTLE_MS = 800
  const DEVELOPMENT_RECOVERY_RETRY_MS = 1_500

  function retryDevelopmentRecovery(window, state) {
    if (window.isDestroyed()) return
    clearTimeout(state.recoveryTimer)
    state.recoveryTimer = setTimeout(() => {
      state.recoveryTimer = undefined
      void recoverDevelopmentWindow(window, state)
    }, DEVELOPMENT_RECOVERY_RETRY_MS)
  }

  function scheduleDevelopmentRecovery(webContentsId) {
    if (!isDevelopment) return false
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.id === webContentsId)
    const state = window ? windowCloseStates.get(window.id) : undefined
    if (!window || !state || window.isDestroyed()) return false
    state.recoveryErrors += 1
    state.lastRecoveryErrorAt = Date.now()
    if (state.recoveryProbing || state.recoveryReloading) return true
    clearTimeout(state.recoveryTimer)
    state.recoveryTimer = setTimeout(() => {
      state.recoveryTimer = undefined
      void recoverDevelopmentWindow(window, state)
    }, DEVELOPMENT_RECOVERY_SETTLE_MS)
    return true
  }

  async function recoverDevelopmentWindow(window, state) {
    if (window.isDestroyed() || state.recoveryProbing || state.recoveryReloading) return
    if (state.pending) {
      retryDevelopmentRecovery(window, state)
      return
    }
    const quietFor = Date.now() - state.lastRecoveryErrorAt
    if (quietFor < DEVELOPMENT_RECOVERY_SETTLE_MS) {
      clearTimeout(state.recoveryTimer)
      state.recoveryTimer = setTimeout(() => {
        state.recoveryTimer = undefined
        void recoverDevelopmentWindow(window, state)
      }, DEVELOPMENT_RECOVERY_SETTLE_MS - quietFor)
      return
    }
    state.recoveryProbing = true
    try {
      const rendererIsHealthy = (timeoutMs) => {
        let timeout
        return Promise.race([
          window.webContents.executeJavaScript(
            "Boolean(document.querySelector('.app-shell'))",
            true,
          ).catch(() => false),
          new Promise((resolve) => {
            timeout = setTimeout(() => resolve(false), timeoutMs)
          }),
        ]).finally(() => clearTimeout(timeout))
      }
      const rendererHealthy = await rendererIsHealthy(1_500)
      if (rendererHealthy) {
        const errorCount = state.recoveryErrors
        state.recoveryErrors = 0
        console.warn(`[tedit:development-recovery] Ignored ${errorCount} transient Vite request failures after a network change.`)
        return
      }
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 2_000)
      let response
      try {
        response = await net.fetch(appEntryUrl, {
          cache: 'no-store',
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }
      if (!response.ok) throw new Error(`Vite returned ${response.status}.`)
      if (window.isDestroyed()) return
      if (await rendererIsHealthy(500)) {
        const errorCount = state.recoveryErrors
        state.recoveryErrors = 0
        console.warn(`[tedit:development-recovery] Renderer recovered after ${errorCount} transient Vite request failures.`)
        return
      }
      if (state.pending) {
        retryDevelopmentRecovery(window, state)
        return
      }
      state.recoveryReloading = true
      const errorCount = state.recoveryErrors
      await window.loadURL(appEntryUrl)
      state.recoveryErrors = 0
      console.warn(`[tedit:development-recovery] Reloaded after ${errorCount} requests failed during a network change.`)
    } catch (error) {
      if (window.isDestroyed()) return
      if (state.recoveryReloading) logFailure('development-recovery', error, { url: appEntryUrl })
      retryDevelopmentRecovery(window, state)
    } finally {
      state.recoveryProbing = false
      state.recoveryReloading = false
      if (state.closeAfterRecovery && !window.isDestroyed()) {
        state.closeAfterRecovery = false
        window.close()
      }
    }
  }

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

	// INFO: here the main window is created
	// We disable direct calling of node internals, activate the sandbox, we run preload code and webiste code in different contexts
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

		// INFO: we add this to be able to validate messsages (if they come from our window or not)
    trustedWebContentsIds.add(window.webContents.id)
    const webContentsId = window.webContents.id
    const closeState = {
      approved: false,
      pending: false,
      timeout: undefined,
      recoveryErrors: 0,
      lastRecoveryErrorAt: 0,
      recoveryProbing: false,
      recoveryReloading: false,
      recoveryTimer: undefined,
      closeAfterRecovery: false,
    }
    windowCloseStates.set(window.id, closeState)

    window.on('close', (event) => {
      if (closeState.approved) return
      event.preventDefault()
      if (closeState.recoveryReloading) {
        closeState.closeAfterRecovery = true
        return
      }
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
      clearTimeout(closeState.recoveryTimer)
      windowCloseStates.delete(window.id)
      trustedWebContentsIds.delete(webContentsId)
      stopBibliography(webContentsId)
      stopPreviewDiscovery(webContentsId)
      void stopTinymist(webContentsId).catch((error) => logFailure('tinymist-window-cleanup', error))
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

		// IMPORTANT: we do not allow navigating away from our tedit window or the doc or the pdf
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
      if (isDevelopment && isMainFrame && [-21, -102, -105, -106, -118].includes(code) && url === appEntryUrl) {
        scheduleDevelopmentRecovery(webContentsId)
        return
      }
      if (code !== -3) logFailure('load', new Error(description), { code, url, isMainFrame })
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      logFailure('renderer-gone', new Error(details.reason), details)
      stopBibliography(webContentsId)
      stopPreviewDiscovery(webContentsId)
      void stopTinymist(webContentsId).catch((error) => logFailure('tinymist-renderer-cleanup', error))
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

  return { createWindow, scheduleDevelopmentRecovery }
}

module.exports = { createWindowLifecycle }
