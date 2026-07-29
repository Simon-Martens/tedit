const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('typstDesktop', {
  openDocument: () => ipcRenderer.invoke('document:open'),
  saveDocument: (request) => ipcRenderer.invoke('document:save', request),
  watchDocuments: (filePaths) => ipcRenderer.invoke('document:watch', filePaths),
  onDocumentChange: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('document:change', handler)
    return () => ipcRenderer.removeListener('document:change', handler)
  },
  resolveDocumentConflict: (request) => ipcRenderer.invoke('document:resolve-conflict', request),
  saveRecovery: (session) => ipcRenderer.invoke('recovery:save', session),
  clearRecovery: () => ipcRenderer.invoke('recovery:clear'),
  onAppCloseRequested: (listener) => {
    const handler = () => listener()
    ipcRenderer.on('app:request-close', handler)
    return () => ipcRenderer.removeListener('app:request-close', handler)
  },
  acknowledgeAppClose: () => ipcRenderer.send('app:acknowledge-close'),
  resolveAppClose: (request) => ipcRenderer.invoke('app:resolve-close', request),
  completeAppClose: (close) => ipcRenderer.send('app:complete-close', close),
  discoverPreviewRoots: (request) => ipcRenderer.invoke('document:discover-preview-roots', request),
  onPreviewRootsChanged: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('document:preview-roots', handler)
    return () => ipcRenderer.removeListener('document:preview-roots', handler)
  },
  stopPreviewRootDiscovery: () => ipcRenderer.send('document:stop-preview-root-discovery'),
  startSourceSync: (request) => ipcRenderer.invoke('tinymist:start', request),
  updateSourceSync: (request) => ipcRenderer.send('tinymist:update', request),
  locateSource: (request) => ipcRenderer.send('tinymist:locate', request),
  stopSourceSync: () => ipcRenderer.send('tinymist:stop'),
  onSourceJump: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('tinymist:jump', handler)
    return () => ipcRenderer.removeListener('tinymist:jump', handler)
  },
  onSourceSyncStatus: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('tinymist:status', handler)
    return () => ipcRenderer.removeListener('tinymist:status', handler)
  },
  startLanguageServer: (request) => ipcRenderer.invoke('tinymist-lsp:start', request),
  syncLanguageServerDocuments: (request) => ipcRenderer.invoke('tinymist-lsp:sync-documents', request),
  compileWithLanguageServer: (request) => ipcRenderer.invoke('tinymist-lsp:compile', request),
  stopLanguageServer: () => ipcRenderer.send('tinymist-lsp:stop'),
  onLanguageServerStatus: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('tinymist-lsp:status', handler)
    return () => ipcRenderer.removeListener('tinymist-lsp:status', handler)
  },
  onLanguageServerDiagnostics: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('tinymist-lsp:diagnostics', handler)
    return () => ipcRenderer.removeListener('tinymist-lsp:diagnostics', handler)
  },
  onLanguageServerDependencyChange: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('tinymist-lsp:dependency-change', handler)
    return () => ipcRenderer.removeListener('tinymist-lsp:dependency-change', handler)
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  restoreSession: () => ipcRenderer.invoke('session:restore'),
  saveSession: (session) => ipcRenderer.invoke('session:save', session),
  readClipboard: () => ipcRenderer.sendSync('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.sendSync('clipboard:write', text),
})
