const fs = require('node:fs/promises')
const path = require('node:path')
const { logFailure } = require('./logging.cjs')

const defaultSettings = {
  vimEnabled: false,
  showPreviewPosition: false,
  previewClickNavigationEnabled: true,
  canvasPreviewEnabled: false,
  autoScrollEnabled: true,
  lightThemeEnabled: false,
  foldingEnabled: true,
  autocompleteEnabled: true,
  semanticHighlightingEnabled: true,
  errorHighlightingEnabled: true,
  automaticErrorPopupEnabled: true,
  previewRenderBackoffMs: 180,
}

function createSettingsPersistence({ app, handleIpc }) {
  const settingsPath = path.join(app.getPath('userData'), 'settings.json')
  let settingsWrite = Promise.resolve()

  function normalizeSettings(settings) {
    return Object.fromEntries(Object.keys(defaultSettings).flatMap((key) => {
      const value = settings?.[key]
      if (typeof defaultSettings[key] === 'boolean' && typeof value === 'boolean') return [[key, value]]
      if (typeof defaultSettings[key] === 'number' && Number.isFinite(value)) {
        return [[key, Math.max(0, Math.min(5_000, Math.round(value)))]]
      }
      return []
    }))
  }

  async function readSettings() {
    try {
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf8'))
      return { ...defaultSettings, ...normalizeSettings(settings) }
    } catch (error) {
      if (error?.code === 'ENOENT') return { ...defaultSettings }
      if (error instanceof SyntaxError) {
        logFailure('settings-parse', error, { settingsPath })
        return { ...defaultSettings }
      }
      throw error
    }
  }

  handleIpc('settings:get', readSettings)
  handleIpc('settings:update', (_event, update) => {
    settingsWrite = settingsWrite.catch(() => undefined).then(async () => {
      const settings = { ...await readSettings(), ...normalizeSettings(update) }
      await fs.mkdir(path.dirname(settingsPath), { recursive: true })
      const temporaryPath = `${settingsPath}.tmp`
      await fs.writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
      await fs.rename(temporaryPath, settingsPath)
      return settings
    })
    return settingsWrite
  })

  return {
    pendingWrite: () => settingsWrite.catch((error) => logFailure('settings-shutdown', error)),
  }
}

module.exports = { createSettingsPersistence }
