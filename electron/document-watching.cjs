const nativeFs = require('node:fs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { logFailure } = require('./logging.cjs')

const maximumWatchedDocuments = 256
const maximumDocumentWatchDirectories = 256
const documentWatcherRetryDelays = [250, 500, 1000, 2000, 4000]

function createDocumentWatcher({ registry, sendToWindows }) {
  const documentWatchers = new Map()
  const watchedDocumentPaths = new Set()
  const documentWatchTimers = new Map()
  const documentWatcherRetryTimers = new Map()
  const documentInspectionGenerations = new Map()
  let documentWatchGeneration = 0
  let documentWatchRequestedDirectories = 0

  function documentWatchStatus(state, message) {
    return {
      state,
      message,
      watchedDirectories: documentWatchers.size,
      requestedDirectories: documentWatchRequestedDirectories,
    }
  }

  function publishDocumentWatchStatus(state, message) {
    const status = documentWatchStatus(state, message)
    sendToWindows('document:watch-status', status)
    return status
  }

  async function inspectWatchedDocument(filePath, generation, watchGeneration, retries = 3) {
    if (watchGeneration !== documentWatchGeneration || !watchedDocumentPaths.has(filePath)) return
    try {
      const content = await fs.readFile(filePath, 'utf8')
      if (
        watchGeneration !== documentWatchGeneration
        || !watchedDocumentPaths.has(filePath)
        || documentInspectionGenerations.get(filePath) !== generation
      ) return
      const diskVersion = registry.contentVersion(content)
      if (registry.getDiskVersion(filePath) === diskVersion) return
      registry.setDiskVersion(filePath, diskVersion)
      sendToWindows('document:change', { filePath, kind: 'changed', content, diskVersion })
    } catch (error) {
      if (
        watchGeneration !== documentWatchGeneration
        || !watchedDocumentPaths.has(filePath)
        || documentInspectionGenerations.get(filePath) !== generation
      ) return
      if (retries > 0) {
        const timer = setTimeout(() => {
          if (documentWatchTimers.get(filePath) === timer) documentWatchTimers.delete(filePath)
          void inspectWatchedDocument(filePath, generation, watchGeneration, retries - 1)
        }, 75)
        clearTimeout(documentWatchTimers.get(filePath))
        documentWatchTimers.set(filePath, timer)
        return
      }
      if (error?.code !== 'ENOENT') {
        logFailure('document-watch-read', error, { filePath })
        publishDocumentWatchStatus('degraded', `Could not inspect ${path.basename(filePath)}. External changes may be delayed.`)
        return
      }
      if (!registry.hasDiskVersion(filePath)) return
      registry.deleteDiskVersion(filePath)
      sendToWindows('document:change', { filePath, kind: 'deleted' })
    }
  }

  function scheduleDocumentInspection(filePath) {
    if (!watchedDocumentPaths.has(filePath)) return
    const watchGeneration = documentWatchGeneration
    const generation = (documentInspectionGenerations.get(filePath) ?? 0) + 1
    documentInspectionGenerations.set(filePath, generation)
    clearTimeout(documentWatchTimers.get(filePath))
    documentWatchTimers.set(filePath, setTimeout(() => {
      documentWatchTimers.delete(filePath)
      void inspectWatchedDocument(filePath, generation, watchGeneration)
    }, 100))
  }

  function scheduleDocumentWatcherRetry(directory, paths, generation, attempt) {
    if (generation !== documentWatchGeneration) return
    if (attempt >= documentWatcherRetryDelays.length) {
      publishDocumentWatchStatus('degraded', `Could not watch ${path.basename(directory)} after ${attempt} retries. External changes may be missed.`)
      return
    }
    publishDocumentWatchStatus('degraded', `File watching is degraded. Retrying ${path.basename(directory)}.`)
    const timer = setTimeout(() => {
      if (documentWatcherRetryTimers.get(directory) === timer) documentWatcherRetryTimers.delete(directory)
      installDocumentWatcher(directory, paths, generation, attempt + 1)
    }, documentWatcherRetryDelays[attempt])
    documentWatcherRetryTimers.set(directory, timer)
  }

  function installDocumentWatcher(directory, paths, generation, attempt = 0) {
    if (generation !== documentWatchGeneration) return false
    clearTimeout(documentWatcherRetryTimers.get(directory))
    documentWatcherRetryTimers.delete(directory)
    try {
      const watcher = nativeFs.watch(directory, (_eventType, filename) => {
        if (generation !== documentWatchGeneration || documentWatchers.get(directory) !== watcher) return
        if (!filename) {
          for (const filePath of paths) scheduleDocumentInspection(filePath)
          return
        }
        const changedPath = registry.normalizeDocumentPath(path.join(directory, filename.toString()))
        if (paths.has(changedPath)) scheduleDocumentInspection(changedPath)
      })
      watcher.on('error', (error) => {
        if (generation !== documentWatchGeneration || documentWatchers.get(directory) !== watcher) return
        logFailure('document-watcher', error, { directory, attempt })
        watcher.close()
        documentWatchers.delete(directory)
        scheduleDocumentWatcherRetry(directory, paths, generation, 0)
      })
      documentWatchers.set(directory, watcher)
      if (documentWatchers.size === documentWatchRequestedDirectories) {
        publishDocumentWatchStatus('ready', `Watching ${watchedDocumentPaths.size} open document${watchedDocumentPaths.size === 1 ? '' : 's'}.`)
      }
      return true
    } catch (error) {
      logFailure('document-watcher-create', error, { directory, attempt })
      scheduleDocumentWatcherRetry(directory, paths, generation, attempt)
      return false
    }
  }

  async function watchDocuments(filePaths) {
    const requestedPaths = new Set((Array.isArray(filePaths) ? filePaths : [])
      .filter((filePath) => typeof filePath === 'string')
      .map(registry.normalizeDocumentPath)
      .filter(registry.isAllowed))
    if (requestedPaths.size > maximumWatchedDocuments) {
      throw new Error(`Cannot watch more than ${maximumWatchedDocuments} open documents.`)
    }

    const directories = new Map()
    for (const filePath of requestedPaths) {
      const directory = path.dirname(filePath)
      const paths = directories.get(directory) ?? new Set()
      paths.add(filePath)
      directories.set(directory, paths)
    }
    if (directories.size > maximumDocumentWatchDirectories) {
      throw new Error(`Cannot watch documents in more than ${maximumDocumentWatchDirectories} directories.`)
    }
    const generation = ++documentWatchGeneration

    for (const filePath of requestedPaths) {
      if (!registry.hasDiskVersion(filePath)) {
        try {
          registry.setDiskVersion(filePath, registry.contentVersion(await fs.readFile(filePath, 'utf8')))
        } catch (error) {
          logFailure('document-watch-baseline', error, { filePath })
          continue
        }
      }
    }
    if (generation !== documentWatchGeneration) return documentWatchStatus('disabled', 'A newer file-watch configuration replaced this request.')

    clear()
    for (const filePath of requestedPaths) watchedDocumentPaths.add(filePath)
    documentWatchRequestedDirectories = directories.size

    if (!directories.size) return publishDocumentWatchStatus('disabled', 'No open files need filesystem watching.')
    let failed = false
    for (const [directory, paths] of directories) {
      if (!installDocumentWatcher(directory, paths, generation)) failed = true
    }
    return failed
      ? documentWatchStatus('degraded', 'Some document directories could not be watched. Retrying in the background.')
      : publishDocumentWatchStatus('ready', `Watching ${requestedPaths.size} open document${requestedPaths.size === 1 ? '' : 's'}.`)
  }

  function clear() {
    for (const watcher of documentWatchers.values()) watcher.close()
    documentWatchers.clear()
    for (const timer of documentWatchTimers.values()) clearTimeout(timer)
    documentWatchTimers.clear()
    for (const timer of documentWatcherRetryTimers.values()) clearTimeout(timer)
    documentWatcherRetryTimers.clear()
    documentInspectionGenerations.clear()
    watchedDocumentPaths.clear()
  }

  function stop() {
    clear()
    documentWatchGeneration += 1
  }

  return { stop, watchDocuments }
}

function registerDocumentWatchIpc({ handleIpc, watcher }) {
  handleIpc('document:watch', (_event, filePaths) => watcher.watchDocuments(filePaths))
}

module.exports = { createDocumentWatcher, registerDocumentWatchIpc }
