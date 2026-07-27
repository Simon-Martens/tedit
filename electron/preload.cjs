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
})
