const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('typstDesktop', {
  openDocument: () => ipcRenderer.invoke('document:open'),
  saveDocument: (request) => ipcRenderer.invoke('document:save', request),
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
  updateLanguageServer: (request) => ipcRenderer.send('tinymist-lsp:update', request),
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
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (settings) => ipcRenderer.invoke('settings:update', settings),
  restoreSession: () => ipcRenderer.invoke('session:restore'),
  saveSession: (session) => ipcRenderer.invoke('session:save', session),
  readClipboard: () => ipcRenderer.sendSync('clipboard:read'),
  writeClipboard: (text) => ipcRenderer.sendSync('clipboard:write', text),
})
