const fs = require('node:fs')
const path = require('node:path')
const { parentPort, workerData } = require('node:worker_threads')

const ignoredDirectories = new Set(['.git', 'dist', 'node_modules', 'release', 'target'])
const maximumFiles = 10000
const maximumDepth = 40

function collectTypstFiles(directory, files, directories, depth = 0) {
  if (files.length >= maximumFiles || depth > maximumDepth) return
  let entries
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch (error) {
    console.warn(`[tedit:preview-discovery] Could not read directory ${directory}: ${error.message}`)
    return
  }
  directories.push(directory)
  for (const entry of entries) {
    if (files.length >= maximumFiles) return
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        collectTypstFiles(entryPath, files, directories, depth + 1)
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
  collectTypstFiles(rootDirectory, files, directories)
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
  return { candidates, directories }
}

let watchers = []
let refreshTimer

function refresh() {
  const { candidates, directories } = discover()
  parentPort.postMessage(candidates)
  for (const watcher of watchers) watcher.close()
  watchers = directories.flatMap((directory) => {
    try {
      const watcher = fs.watch(directory, scheduleRefresh)
      watcher.on('error', scheduleRefresh)
      return [watcher]
    } catch (error) {
      console.warn(`[tedit:preview-discovery] Could not watch ${directory}: ${error.message}`)
      return []
    }
  })
}

function scheduleRefresh() {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(refresh, 120)
}

refresh()
