const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('typstDesktop', {
  openDocument: () => ipcRenderer.invoke('document:open'),
  saveDocument: (request) => ipcRenderer.invoke('document:save', request),
  deleteDocument: (request) => ipcRenderer.invoke('document:delete', request),
  printPdf: (pdf) => ipcRenderer.invoke('pdf:print', pdf),
  watchDocuments: (filePaths) => ipcRenderer.invoke('document:watch', filePaths),
  onDocumentWatchStatus: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('document:watch-status', handler)
    return () => ipcRenderer.removeListener('document:watch-status', handler)
  },
  onDocumentChange: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('document:change', handler)
    return () => ipcRenderer.removeListener('document:change', handler)
  },
  resolveDocumentConflict: (request) => ipcRenderer.invoke('document:resolve-conflict', request),
  discoverBibliographies: (request) => ipcRenderer.invoke('bibliography:discover', request),
  createDefaultBibliography: (request) => ipcRenderer.invoke('bibliography:create-default', request),
  saveBibliography: (request) => ipcRenderer.invoke('bibliography:save', request),
  onBibliographyChange: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('bibliography:change', handler)
    return () => ipcRenderer.removeListener('bibliography:change', handler)
  },
  stopBibliographies: (request) => ipcRenderer.send('bibliography:stop', request),
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
  revealPreviewSource: (request) => ipcRenderer.send('tinymist:reveal-source', request),
  stopSourceSync: () => ipcRenderer.send('tinymist:stop'),
  onSourceJump: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('tinymist:jump', handler)
    return () => ipcRenderer.removeListener('tinymist:jump', handler)
  },
  onPreviewUpdate: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('tinymist:preview-update', handler)
    return () => ipcRenderer.removeListener('tinymist:preview-update', handler)
  },
  onPreviewSourceReveal: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('tinymist:source-reveal', handler)
    return () => ipcRenderer.removeListener('tinymist:source-reveal', handler)
  },
  onSourceSyncStatus: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('tinymist:status', handler)
    return () => ipcRenderer.removeListener('tinymist:status', handler)
  },
  onSourceDependencyChange: (listener) => {
    const handler = (_event, payload) => listener(payload)
    ipcRenderer.on('tinymist:dependency-change', handler)
    return () => ipcRenderer.removeListener('tinymist:dependency-change', handler)
  },
  startLanguageServer: (request) => ipcRenderer.invoke('tinymist-lsp:start', request),
  syncLanguageServerDocuments: (request) => ipcRenderer.invoke('tinymist-lsp:sync-documents', request),
  completeWithLanguageServer: (request) => ipcRenderer.invoke('tinymist-lsp:complete', request),
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
