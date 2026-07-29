const fs = require('node:fs')
const path = require('node:path')
const { parentPort, workerData } = require('node:worker_threads')

const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'release', 'target'])
const maximumFiles = 10000
const maximumDepth = 40
const maximumDirectories = 1000
const maximumWatchers = 512
const watcherRetryDelays = [250, 500, 1000, 2000, 4000]

function collectTypstFiles(directory, files, directories, limits, depth = 0) {
  if (files.length >= maximumFiles) {
    limits.add(`file limit (${maximumFiles})`)
    return
  }
  if (directories.length >= maximumDirectories) {
    limits.add(`directory limit (${maximumDirectories})`)
    return
  }
  if (depth > maximumDepth) {
    limits.add(`depth limit (${maximumDepth})`)
    return
  }
  let entries
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    console.warn(`[tedit:preview-discovery] Could not read directory ${directory}: ${error.message}`)
    limits.add('unreadable directories')
    return
  }
  directories.push(directory)
  for (const entry of entries) {
    if (files.length >= maximumFiles) {
      limits.add(`file limit (${maximumFiles})`)
      return
    }
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        collectTypstFiles(entryPath, files, directories, limits, depth + 1)
      }
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.typ')) {
      files.push(path.resolve(entryPath))
    }
  }
}

function staticDependencies(filePath, source) {
  const dependencies = new Set()
  let index = 0
  while (index < source.length) {
    if (source.startsWith('//', index)) {
      index = source.indexOf('\n', index + 2)
      if (index < 0) break
      continue
    }
    if (source.startsWith('/*', index)) {
      let depth = 1
      index += 2
      while (index < source.length && depth) {
        if (source.startsWith('/*', index)) {
          depth += 1
          index += 2
        } else if (source.startsWith('*/', index)) {
          depth -= 1
          index += 2
        } else {
          index += 1
        }
      }
      continue
    }
    if (source[index] === '"') {
      index += 1
      while (index < source.length) {
        if (source[index] === '\\') index += 2
        else if (source[index++] === '"') break
      }
      continue
    }
    if (!/[A-Za-z]/.test(source[index])) {
      index += 1
      continue
    }
    const wordStart = index
    while (/[A-Za-z]/.test(source[index] ?? '')) index += 1
    const word = source.slice(wordStart, index)
    if (word !== 'include' && word !== 'import') continue
    while (/\s/.test(source[index] ?? '')) index += 1
    if (source[index] !== '"') continue
    const stringStart = index
    index += 1
    while (index < source.length) {
      if (source[index] === '\\') index += 2
      else if (source[index++] === '"') break
    }
    let relativePath
    try {
      relativePath = JSON.parse(source.slice(stringStart, index))
    } catch {
      continue
    }
    if (!relativePath.startsWith('@')) {
      dependencies.add(path.resolve(path.dirname(filePath), relativePath))
    }
  }
  return dependencies
}

function discover() {
  const currentFilePath = path.resolve(workerData.filePath)
  const rootDirectory = path.resolve(workerData.rootDirectory ?? path.dirname(currentFilePath))
  const buffers = new Map((workerData.openDocuments ?? []).map((document) => [
    path.resolve(document.filePath),
    document.source,
  ]))
  const files = []
  const directories = []
  const limits = new Set()
  collectTypstFiles(rootDirectory, files, directories, limits)
  if (!files.includes(currentFilePath)) files.push(currentFilePath)
  const fileSet = new Set(files)
  const reverseDependencies = new Map()

  for (const filePath of files) {
    let source = buffers.get(filePath)
    if (source === undefined) {
      try {
        source = fs.readFileSync(filePath, 'utf8')
      } catch (error) {
        console.warn(`[tedit:preview-discovery] Could not read ${filePath}: ${error.message}`)
        continue
      }
    }
    for (const dependency of staticDependencies(filePath, source)) {
      if (!fileSet.has(dependency)) continue
      const parents = reverseDependencies.get(dependency) ?? new Set()
      parents.add(filePath)
      reverseDependencies.set(dependency, parents)
    }
  }

  const roots = new Set([currentFilePath])
  const pending = [currentFilePath]
  while (pending.length) {
    const dependency = pending.shift()
    for (const parent of reverseDependencies.get(dependency) ?? []) {
      if (roots.has(parent)) continue
      roots.add(parent)
      pending.push(parent)
    }
  }

  const rootName = path.basename(rootDirectory)
  const candidates = [...roots].map((filePath) => {
    const relativePath = path.relative(rootDirectory, filePath) || path.basename(filePath)
    return {
      filePath,
      name: path.basename(filePath),
      relativePath: [rootName, ...relativePath.split(path.sep)].join('/'),
    }
  }).sort((left, right) => {
    if (left.filePath === currentFilePath) return -1
    if (right.filePath === currentFilePath) return 1
    return left.relativePath.localeCompare(right.relativePath)
  })
  return { candidates, directories, limits }
}

const watchers = new Map()
const watcherRetryTimers = new Map()
let refreshTimer
let maximumRefreshTimer
let currentCandidates = []
let currentLimits = new Set()
let requestedWatcherCount = 0
let discoveredDirectoryCount = 0

function status() {
  const missingWatchers = Math.max(0, requestedWatcherCount - watchers.size)
  const limitations = [...currentLimits]
  if (missingWatchers) limitations.push(`${missingWatchers} unavailable watcher${missingWatchers === 1 ? '' : 's'}`)
  const degraded = limitations.length > 0
  return {
    state: degraded ? 'degraded' : 'ready',
    message: degraded
      ? `Preview-root discovery is partial: ${limitations.join(', ')}.`
      : `Watching ${watchers.size} director${watchers.size === 1 ? 'y' : 'ies'} for preview roots.`,
    watchedDirectories: watchers.size,
    requestedDirectories: discoveredDirectoryCount,
    truncated: currentLimits.size > 0,
  }
}

function postUpdate() {
  parentPort.postMessage({ type: 'result', roots: currentCandidates, status: status() })
}

function scheduleWatcherRetry(directory, attempt) {
  if (attempt >= watcherRetryDelays.length || watcherRetryTimers.has(directory)) {
    postUpdate()
    return
  }
  const timer = setTimeout(() => {
    watcherRetryTimers.delete(directory)
    installWatcher(directory, attempt + 1)
  }, watcherRetryDelays[attempt])
  watcherRetryTimers.set(directory, timer)
  postUpdate()
}

function installWatcher(directory, attempt = 0) {
  try {
    const watcher = fs.watch(directory, scheduleRefresh)
    watcher.on('error', (error) => {
      if (watchers.get(directory) !== watcher) return
      console.warn(`[tedit:preview-discovery] Watcher failed for ${directory}: ${error.message}`)
      watcher.close()
      watchers.delete(directory)
      scheduleWatcherRetry(directory, 0)
    })
    watchers.set(directory, watcher)
    if (attempt > 0) postUpdate()
  } catch (error) {
    console.warn(`[tedit:preview-discovery] Could not watch ${directory}: ${error.message}`)
    scheduleWatcherRetry(directory, attempt)
  }
}

function refresh() {
  clearTimeout(refreshTimer)
  clearTimeout(maximumRefreshTimer)
  refreshTimer = undefined
  maximumRefreshTimer = undefined
  const { candidates, directories, limits } = discover()
  for (const watcher of watchers.values()) watcher.close()
  watchers.clear()
  for (const timer of watcherRetryTimers.values()) clearTimeout(timer)
  watcherRetryTimers.clear()
  currentCandidates = candidates
  currentLimits = limits
  const watchedDirectories = directories.slice(0, maximumWatchers)
  if (directories.length > maximumWatchers) currentLimits.add(`watcher limit (${maximumWatchers})`)
  requestedWatcherCount = watchedDirectories.length
  discoveredDirectoryCount = directories.length
  for (const directory of watchedDirectories) installWatcher(directory)
  postUpdate()
}

function scheduleRefresh() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(refresh, 120)
  if (!maximumRefreshTimer) maximumRefreshTimer = setTimeout(refresh, 1500)
}

refresh()
