const { logFailure } = require('./logging.cjs')

function createIpcSecurity({ appEntryUrl, ipcMain, trustedWebContentsIds }) {
  function assertTrustedIpc(event, channel) {
    const frame = event.senderFrame
    if (
      !trustedWebContentsIds.has(event.sender.id)
      || !frame
      || frame !== event.sender.mainFrame
      || frame.url !== appEntryUrl
    ) {
      throw new Error(`Rejected IPC ${channel} from ${frame?.url ?? 'an unavailable frame'}.`)
    }
  }

  function handleIpc(channel, listener) {
    ipcMain.handle(channel, async (event, ...args) => {
      try {
        assertTrustedIpc(event, channel)
        return await listener(event, ...args)
      } catch (error) {
        logFailure(`ipc:${channel}`, error)
        throw error
      }
    })
  }

  function onIpc(channel, listener, fallback) {
    ipcMain.on(channel, (event, ...args) => {
      try {
        assertTrustedIpc(event, channel)
        const result = listener(event, ...args)
        if (result && typeof result.then === 'function') {
          result.catch((error) => logFailure(`ipc:${channel}`, error))
        }
      } catch (error) {
        logFailure(`ipc:${channel}`, error)
        if (fallback !== undefined) event.returnValue = fallback
      }
    })
  }

  return { assertTrustedIpc, handleIpc, onIpc }
}

module.exports = { createIpcSecurity }
