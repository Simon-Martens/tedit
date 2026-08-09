function registerClipboardIpc({ clipboard, onIpc }) {
  // TODO: this is syncronous
  onIpc('clipboard:read', (event) => {
    event.returnValue = clipboard.readText()
  }, '')
  onIpc('clipboard:write', (event, text) => {
    clipboard.writeText(typeof text === 'string' ? text : '')
    event.returnValue = undefined
  }, null)
}

module.exports = { registerClipboardIpc }
