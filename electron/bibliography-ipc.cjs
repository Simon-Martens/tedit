const { createHmac, randomBytes } = require('node:crypto')
const nativeFs = require('node:fs')
const fs = require('node:fs/promises')
const path = require('node:path')
const { logFailure } = require('./logging.cjs')

const maximumReferences = 64
const maximumDocuments = 256
const maximumSourceBytes = 2 * 1024 * 1024
const maximumTotalSourceBytes = 8 * 1024 * 1024
const maximumBibliographyBytes = 16 * 1024 * 1024
const readRetryDelays = [50, 100, 200]

function isWithin(root, target) {
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
}

function skipTrivia(source, start) {
  let offset = start
  while (offset < source.length) {
    if (/\s/.test(source[offset])) {
      offset += 1
    } else if (source.startsWith('//', offset)) {
      const newline = source.indexOf('\n', offset + 2)
      offset = newline < 0 ? source.length : newline + 1
    } else if (source.startsWith('/*', offset)) {
      let depth = 1
      offset += 2
      while (offset < source.length && depth > 0) {
        if (source.startsWith('/*', offset)) {
          depth += 1
          offset += 2
        } else if (source.startsWith('*/', offset)) {
          depth -= 1
          offset += 2
        } else {
          offset += 1
        }
      }
      if (depth) return source.length
    } else {
      break
    }
  }
  return offset
}

function readString(source, start) {
  if (source[start] !== '"') return undefined
  let value = ''
  for (let offset = start + 1; offset < source.length; offset += 1) {
    const character = source[offset]
    if (character === '"') return { value, end: offset + 1 }
    if (character === '\n' || character === '\r') return undefined
    if (character !== '\\') {
      value += character
      continue
    }
    offset += 1
    if (offset >= source.length) return undefined
    const escaped = source[offset]
    const escapes = { '"': '"', '\\': '\\', n: '\n', r: '\r', t: '\t' }
    if (!(escaped in escapes)) return undefined
    value += escapes[escaped]
  }
  return undefined
}

function parseLiteralList(source, start, closing) {
  const values = []
  let offset = skipTrivia(source, start)
  let needsValue = true
  while (offset < source.length) {
    if (source[offset] === closing) {
      if (needsValue && values.length) return undefined
      return { values, end: offset + 1 }
    }
    if (!needsValue) {
      if (source[offset] !== ',') return undefined
      needsValue = true
      offset = skipTrivia(source, offset + 1)
      if (source[offset] === closing) return { values, end: offset + 1 }
      continue
    }
    let item
    if (source[offset] === '"') item = readString(source, offset)
    else if (source[offset] === '(') item = parseLiteralList(source, offset + 1, ')')
    if (!item) return undefined
    values.push(...('value' in item ? [item.value] : item.values))
    offset = skipTrivia(source, item.end)
    needsValue = false
  }
  return undefined
}

function parseBibliographyArgument(source, start) {
  const offset = skipTrivia(source, start)
  if (source[offset] === '"') {
    const item = readString(source, offset)
    return item && { values: [item.value], end: item.end }
  }
  if (source[offset] === '(') return parseLiteralList(source, offset + 1, ')')
  return undefined
}

function discoverBibliographyLiterals(source) {
  const references = []
  let offset = 0
  let blockCommentDepth = 0
  while (offset < source.length) {
    if (blockCommentDepth) {
      if (source.startsWith('/*', offset)) {
        blockCommentDepth += 1
        offset += 2
      } else if (source.startsWith('*/', offset)) {
        blockCommentDepth -= 1
        offset += 2
      } else {
        offset += 1
      }
      continue
    }
    if (source.startsWith('//', offset)) {
      const newline = source.indexOf('\n', offset + 2)
      offset = newline < 0 ? source.length : newline + 1
      continue
    }
    if (source.startsWith('/*', offset)) {
      blockCommentDepth = 1
      offset += 2
      continue
    }
    if (source[offset] === '"') {
      const string = readString(source, offset)
      offset = string?.end ?? source.length
      continue
    }
    if (source[offset] === '`') {
      let delimiterLength = 1
      while (source[offset + delimiterLength] === '`') delimiterLength += 1
      const delimiter = '`'.repeat(delimiterLength)
      const end = source.indexOf(delimiter, offset + delimiterLength)
      offset = end < 0 ? source.length : end + delimiterLength
      continue
    }
    if (source.startsWith('#bibliography', offset)) {
      const before = offset === 0 ? '' : source[offset - 1]
      const afterName = offset + '#bibliography'.length
      if ((!before || !/[\w-]/.test(before)) && !/[\w-]/.test(source[afterName] ?? '')) {
        const open = skipTrivia(source, afterName)
        if (source[open] === '(') {
          const call = parseBibliographyArgument(source, open + 1)
          if (call?.values.length) references.push(...call.values)
          if (call) {
            offset = call.end
            continue
          }
        }
      }
    }
    offset += 1
  }
  return references
}

function createBibliographyIpc({ handleIpc, isAllowedPreviewRoot, onIpc, registry }) {
  const sessions = new Map()
  const discoveryGenerations = new Map()
  const pendingDocuments = new Map()
  const senderSecrets = new Map()
  const saveQueues = new Map()

  function stopForWebContents(webContentsId, documentId) {
    const session = sessions.get(webContentsId)
    const pendingDocumentId = pendingDocuments.get(webContentsId)
    if (
      documentId !== undefined
      && session?.documentId !== documentId
      && pendingDocumentId !== documentId
    ) return
    discoveryGenerations.set(webContentsId, (discoveryGenerations.get(webContentsId) ?? 0) + 1)
    pendingDocuments.delete(webContentsId)
    if (session && (documentId === undefined || session.documentId === documentId)) {
      sessions.delete(webContentsId)
      session.active = false
      for (const watcher of session.watchers.values()) watcher.close()
      for (const timer of session.timers.values()) clearTimeout(timer)
      session.watchers.clear()
      session.timers.clear()
    }
  }

  function stopAll() {
    for (const webContentsId of [...sessions.keys()]) stopForWebContents(webContentsId)
    pendingDocuments.clear()
    senderSecrets.clear()
  }

  function revokeForWebContents(webContentsId) {
    stopForWebContents(webContentsId)
    senderSecrets.delete(webContentsId)
  }

  function queueSave(filePath, operation) {
    const previous = saveQueues.get(filePath) ?? Promise.resolve()
    const queued = previous.catch(() => undefined).then(operation)
    const tracked = queued.finally(() => {
      if (saveQueues.get(filePath) === tracked) saveQueues.delete(filePath)
    })
    saveQueues.set(filePath, tracked)
    return tracked
  }

  async function canonicalWorkspaceRoot(rootFilePath) {
    const configuredRoot = registry.getWorkspaceRoot(rootFilePath)
    if (!configuredRoot) throw new Error('The document has no authorized workspace root.')
    const canonicalRoot = await fs.realpath(registry.normalizeDocumentPath(configuredRoot))
    const stat = await fs.stat(canonicalRoot)
    if (!stat.isDirectory()) throw new Error('The authorized workspace root is not a directory.')
    return canonicalRoot
  }

  async function resolveTarget(workspaceRoot, containingFilePath, reference) {
    if (
      typeof reference !== 'string'
      || reference.includes('\0')
      || path.isAbsolute(reference)
      || path.extname(reference).toLowerCase() !== '.bib'
    ) throw new Error('Bibliography references must be relative .bib file paths.')

    const requestedPath = path.resolve(path.dirname(containingFilePath), reference)
    if (!isWithin(workspaceRoot, requestedPath)) throw new Error('Bibliography reference escapes the workspace root.')
    let targetStat
    try {
      targetStat = await fs.lstat(requestedPath)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (targetStat?.isSymbolicLink()) throw new Error('Symbolic-link bibliography files are not allowed.')
    if (targetStat && !targetStat.isFile()) throw new Error('Bibliography targets must be regular files.')

    if (targetStat) {
      const canonicalPath = await fs.realpath(requestedPath)
      if (!isWithin(workspaceRoot, canonicalPath)) throw new Error('Bibliography reference escapes the workspace root.')
      return { filePath: canonicalPath, exists: true, mode: targetStat.mode & 0o777 }
    }

    const canonicalParent = await fs.realpath(path.dirname(requestedPath))
    if (!isWithin(workspaceRoot, canonicalParent)) throw new Error('Bibliography reference escapes the workspace root.')
    const filePath = path.join(canonicalParent, path.basename(requestedPath))
    if (!isWithin(workspaceRoot, filePath)) throw new Error('Bibliography reference escapes the workspace root.')
    return { filePath, exists: false }
  }

  async function readLimitedUtf8(filePath) {
    const handle = await fs.open(filePath, 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile()) throw new Error('Bibliography targets must be regular files.')
      if (stat.size > maximumBibliographyBytes) throw new Error('Bibliography file exceeds the size limit.')
      const buffer = Buffer.alloc(stat.size)
      let offset = 0
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
        if (!bytesRead) break
        offset += bytesRead
      }
      if (offset !== buffer.length) throw new Error('Bibliography file changed while being read.')
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    } finally {
      await handle.close()
    }
  }

  function publicSnapshot(entry, content, diskVersion) {
    return {
      id: entry.id,
      filePath: entry.filePath,
      name: entry.name,
      content,
      diskVersion,
      exists: true,
    }
  }

  function conflictSnapshot(entry, kind, content, diskVersion, exists) {
    entry.exists = exists
    entry.diskVersion = diskVersion
    return {
      conflict: {
        id: entry.id,
        filePath: entry.filePath,
        name: entry.name,
        kind,
        ...(content === undefined ? {} : { content }),
        ...(diskVersion === undefined ? {} : { diskVersion }),
        exists,
      },
    }
  }

  function publish(session, entry, kind, content, diskVersion) {
    if (!session.active || session.sender.isDestroyed()) return
    session.sender.send('bibliography:change', {
      documentId: session.documentId,
      id: entry.id,
      filePath: entry.filePath,
      name: entry.name,
      kind,
      ...(content === undefined ? {} : { content }),
      ...(diskVersion === undefined ? {} : { diskVersion }),
      exists: kind !== 'deleted',
    })
  }

  async function inspectEntry(session, entry, attempt = 0) {
    if (!session.active || sessions.get(session.sender.id) !== session) return
    if (entry.saving) {
      scheduleInspection(session, entry)
      return
    }
    const generation = entry.watchGeneration
    try {
      const resolved = await resolveTarget(session.workspaceRoot, entry.filePath, path.basename(entry.filePath))
      if (!resolved.exists) {
        if (entry.exists) {
          entry.exists = false
          entry.diskVersion = undefined
          publish(session, entry, 'deleted')
        }
        return
      }
      const content = await readLimitedUtf8(entry.filePath)
      const diskVersion = registry.contentVersion(content)
      if (entry.saving || entry.watchGeneration !== generation) {
        scheduleInspection(session, entry)
        return
      }
      if (entry.exists && entry.diskVersion === diskVersion) return
      entry.exists = true
      entry.diskVersion = diskVersion
      publish(session, entry, 'changed', content, diskVersion)
    } catch (error) {
      if (attempt < readRetryDelays.length) {
        const timer = setTimeout(() => {
          if (session.timers.get(entry.filePath) === timer) session.timers.delete(entry.filePath)
          void inspectEntry(session, entry, attempt + 1)
        }, readRetryDelays[attempt])
        clearTimeout(session.timers.get(entry.filePath))
        session.timers.set(entry.filePath, timer)
        return
      }
      logFailure('bibliography-watch-read', error, { filePath: entry.filePath })
    }
  }

  function scheduleInspection(session, entry) {
    clearTimeout(session.timers.get(entry.filePath))
    session.timers.set(entry.filePath, setTimeout(() => {
      session.timers.delete(entry.filePath)
      void inspectEntry(session, entry)
    }, 100))
  }

  function installWatchers(session) {
    const entriesByDirectory = new Map()
    for (const entry of session.entriesById.values()) {
      const directory = path.dirname(entry.filePath)
      const entries = entriesByDirectory.get(directory) ?? new Map()
      entries.set(path.basename(entry.filePath), entry)
      entriesByDirectory.set(directory, entries)
    }
    for (const [directory, entries] of entriesByDirectory) {
      const watcher = nativeFs.watch(directory, (_eventType, filename) => {
        if (!session.active || sessions.get(session.sender.id) !== session) return
        if (!filename) {
          for (const entry of entries.values()) scheduleInspection(session, entry)
          return
        }
        const entry = entries.get(filename.toString())
        if (entry) scheduleInspection(session, entry)
      })
      watcher.on('error', (error) => logFailure('bibliography-watcher', error, { directory }))
      session.watchers.set(directory, watcher)
    }
  }

  handleIpc('bibliography:discover', async (event, request) => {
    stopForWebContents(event.sender.id)
    if (
      typeof request?.documentId !== 'string'
      || !/^[A-Za-z0-9-]{1,64}$/.test(request.documentId)
      || typeof request.sourceFilePath !== 'string'
      || typeof request.rootFilePath !== 'string'
      || !Array.isArray(request.documents)
      || request.documents.length > maximumDocuments
      || (request.retainedFiles !== undefined && (
        !Array.isArray(request.retainedFiles)
        || request.retainedFiles.length > maximumReferences
        || request.retainedFiles.some((file) => (
          typeof file?.id !== 'string' || typeof file.filePath !== 'string'
        ))
      ))
    ) throw new Error('Invalid bibliography discovery request.')
    const discoveryGeneration = discoveryGenerations.get(event.sender.id)
    pendingDocuments.set(event.sender.id, request.documentId)

    const sourceFilePath = registry.normalizeDocumentPath(request.sourceFilePath)
    const rootFilePath = registry.normalizeDocumentPath(request.rootFilePath)
    if (!registry.isAllowed(sourceFilePath)) throw new Error('The source document is not authorized.')
    if (!registry.isAllowed(rootFilePath) && !isAllowedPreviewRoot(sourceFilePath, rootFilePath)) {
      throw new Error('The root document is not authorized.')
    }
    const documents = []
    let totalSourceBytes = 0
    for (const document of request.documents) {
      if (typeof document?.filePath !== 'string' || typeof document.source !== 'string') {
        throw new Error('Invalid bibliography source document.')
      }
      const filePath = registry.normalizeDocumentPath(document.filePath)
      if (!registry.isAllowed(filePath)) throw new Error('A bibliography source document is not authorized.')
      const sourceBytes = Buffer.byteLength(document.source)
      totalSourceBytes += sourceBytes
      if (sourceBytes > maximumSourceBytes || totalSourceBytes > maximumTotalSourceBytes) {
        throw new Error('Bibliography source exceeds the size limit.')
      }
      documents.push({ filePath, source: document.source })
    }

    if (!documents.some(({ filePath }) => filePath === rootFilePath)) {
      const rootSource = await readLimitedUtf8(rootFilePath)
      const sourceBytes = Buffer.byteLength(rootSource)
      totalSourceBytes += sourceBytes
      if (sourceBytes > maximumSourceBytes || totalSourceBytes > maximumTotalSourceBytes) {
        throw new Error('Bibliography source exceeds the size limit.')
      }
      documents.push({ filePath: rootFilePath, source: rootSource })
    }

    const workspaceRoot = await canonicalWorkspaceRoot(sourceFilePath)
    const sourceContainingPath = await fs.realpath(sourceFilePath)
    const defaultBibliography = await resolveTarget(workspaceRoot, sourceContainingPath, 'bibliography.bib')
    const targets = new Map()
    let referenceCount = 0
    for (const document of documents) {
      const containingPath = await fs.realpath(document.filePath)
      if (!isWithin(workspaceRoot, containingPath)) throw new Error('A source document is outside the workspace root.')
      for (const reference of discoverBibliographyLiterals(document.source)) {
        referenceCount += 1
        if (referenceCount > maximumReferences) throw new Error(`Cannot discover more than ${maximumReferences} bibliography references.`)
        const target = await resolveTarget(workspaceRoot, containingPath, reference)
        targets.set(target.filePath, target)
      }
    }

    const session = {
      active: true,
      documentId: request.documentId,
      entriesById: new Map(),
      sender: event.sender,
      timers: new Map(),
      watchers: new Map(),
      workspaceRoot,
    }
    let senderSecret = senderSecrets.get(event.sender.id)
    if (!senderSecret) {
      senderSecret = randomBytes(32)
      senderSecrets.set(event.sender.id, senderSecret)
    }
    const files = []
    for (const target of targets.values()) {
      const id = createHmac('sha256', senderSecret)
        .update(request.documentId)
        .update('\0')
        .update(target.filePath)
        .digest('base64url')
      const entry = {
        id,
        filePath: target.filePath,
        name: path.basename(target.filePath),
        exists: target.exists,
        diskVersion: undefined,
        saving: false,
        watchGeneration: 0,
      }
      let content = ''
      if (target.exists) {
        content = await readLimitedUtf8(target.filePath)
        entry.diskVersion = registry.contentVersion(content)
      }
      session.entriesById.set(id, entry)
      files.push({
        id,
        filePath: entry.filePath,
        name: entry.name,
        relativePath: path.relative(workspaceRoot, entry.filePath),
        content,
        ...(entry.diskVersion === undefined ? {} : { diskVersion: entry.diskVersion }),
        exists: entry.exists,
      })
    }
    for (const retained of request.retainedFiles ?? []) {
      if (session.entriesById.has(retained.id)) continue
      if (session.entriesById.size >= maximumReferences) {
        throw new Error(`Cannot retain more than ${maximumReferences} bibliography files.`)
      }
      const retainedPath = registry.normalizeDocumentPath(retained.filePath)
      const expectedId = createHmac('sha256', senderSecret)
        .update(request.documentId)
        .update('\0')
        .update(retainedPath)
        .digest('base64url')
      if (retained.id !== expectedId) throw new Error('Invalid retained bibliography identifier.')
      const reference = path.relative(path.dirname(sourceContainingPath), retainedPath)
      const target = await resolveTarget(workspaceRoot, sourceContainingPath, reference)
      if (target.filePath !== retainedPath) throw new Error('Invalid retained bibliography path.')
      const entry = {
        id: retained.id,
        filePath: target.filePath,
        name: path.basename(target.filePath),
        exists: target.exists,
        diskVersion: undefined,
        saving: false,
        watchGeneration: 0,
      }
      let content = ''
      if (target.exists) {
        content = await readLimitedUtf8(target.filePath)
        entry.diskVersion = registry.contentVersion(content)
      }
      session.entriesById.set(entry.id, entry)
      files.push({
        id: entry.id,
        filePath: entry.filePath,
        name: entry.name,
        relativePath: path.relative(workspaceRoot, entry.filePath),
        content,
        ...(entry.diskVersion === undefined ? {} : { diskVersion: entry.diskVersion }),
        exists: entry.exists,
      })
    }
    if (
      discoveryGenerations.get(event.sender.id) !== discoveryGeneration
      || pendingDocuments.get(event.sender.id) !== request.documentId
    ) throw new Error('Bibliography discovery was replaced by a newer request.')
    pendingDocuments.delete(event.sender.id)
    sessions.set(event.sender.id, session)
    try {
      installWatchers(session)
    } catch (error) {
      stopForWebContents(event.sender.id)
      throw error
    }
    return {
      documentId: request.documentId,
      files,
      defaultBibliographyExists: defaultBibliography.exists,
    }
  })

  handleIpc('bibliography:create-default', async (event, request) => {
    if (
      typeof request?.documentId !== 'string'
      || !/^[A-Za-z0-9-]{1,64}$/.test(request.documentId)
      || typeof request.sourceFilePath !== 'string'
    ) throw new Error('Invalid bibliography creation request.')
    const sourceFilePath = registry.normalizeDocumentPath(request.sourceFilePath)
    if (!registry.isAllowed(sourceFilePath)) throw new Error('The source document is not authorized.')
    const workspaceRoot = await canonicalWorkspaceRoot(sourceFilePath)
    const containingFilePath = await fs.realpath(sourceFilePath)
    const target = await resolveTarget(workspaceRoot, containingFilePath, 'bibliography.bib')
    await queueSave(target.filePath, async () => {
      const senderDestroyed = () => event.sender.isDestroyed?.() ?? false
      if (senderDestroyed()) throw new Error('Bibliography creation was cancelled.')
      const checkedTarget = await resolveTarget(workspaceRoot, containingFilePath, 'bibliography.bib')
      if (checkedTarget.exists) return
      const handle = await fs.open(checkedTarget.filePath, 'wx', 0o600)
      await handle.close()
      if (senderDestroyed()) {
        await fs.rm(checkedTarget.filePath, { force: true })
        throw new Error('Bibliography creation was cancelled.')
      }
    })
    return { reference: 'bibliography.bib', filePath: target.filePath }
  })

  handleIpc('bibliography:save', async (event, request) => {
    if (
      typeof request?.documentId !== 'string'
      || typeof request.id !== 'string'
      || typeof request.content !== 'string'
      || Buffer.byteLength(request.content) > maximumBibliographyBytes
      || ('expectedDiskVersion' in request
        && request.expectedDiskVersion !== null
        && typeof request.expectedDiskVersion !== 'string')
    ) throw new Error('Invalid bibliography save request.')
    const session = sessions.get(event.sender.id)
    if (!session?.active || session.documentId !== request.documentId) throw new Error('No active bibliography session exists.')
    const entry = session.entriesById.get(request.id)
    if (!entry) throw new Error('Unknown bibliography file identifier.')

    return queueSave(entry.filePath, async () => {
      entry.saving = true
      entry.watchGeneration = (entry.watchGeneration ?? 0) + 1
      clearTimeout(session.timers.get(entry.filePath))
      session.timers.delete(entry.filePath)
      try {
      if (!session.active || sessions.get(event.sender.id) !== session) throw new Error('The bibliography session was revoked.')
      const target = await resolveTarget(session.workspaceRoot, entry.filePath, path.basename(entry.filePath))
      let diskContent
      let diskVersion
      if (target.exists) {
        diskContent = await readLimitedUtf8(entry.filePath)
        diskVersion = registry.contentVersion(diskContent)
      }
      if ('expectedDiskVersion' in request) {
        const changed = target.exists && (request.expectedDiskVersion === null || request.expectedDiskVersion !== diskVersion)
        const deleted = !target.exists && request.expectedDiskVersion !== null
        if (changed || deleted) {
          return conflictSnapshot(entry, deleted ? 'deleted' : 'changed', diskContent, diskVersion, target.exists)
        }
      }

      const temporaryPath = path.join(path.dirname(entry.filePath), `.tedit-bib-${process.pid}-${randomBytes(8).toString('hex')}.tmp`)
      let handle
      try {
        handle = await fs.open(temporaryPath, 'wx', target.mode ?? 0o600)
        await handle.writeFile(request.content, 'utf8')
        await handle.sync()
        await handle.close()
        handle = undefined
        const checkedTarget = await resolveTarget(session.workspaceRoot, entry.filePath, path.basename(entry.filePath))
        if (checkedTarget.exists !== target.exists) {
          const checkedContent = checkedTarget.exists ? await readLimitedUtf8(entry.filePath) : undefined
          const checkedVersion = checkedContent === undefined ? undefined : registry.contentVersion(checkedContent)
          return conflictSnapshot(
            entry,
            checkedTarget.exists ? 'changed' : 'deleted',
            checkedContent,
            checkedVersion,
            checkedTarget.exists,
          )
        }
        if (checkedTarget.exists) {
          const checkedContent = await readLimitedUtf8(entry.filePath)
          const checkedVersion = registry.contentVersion(checkedContent)
          if (checkedVersion !== diskVersion) return conflictSnapshot(entry, 'changed', checkedContent, checkedVersion, true)
        }
        if (!session.active || sessions.get(event.sender.id) !== session) throw new Error('The bibliography session was revoked.')
        await fs.rename(temporaryPath, entry.filePath)
      } finally {
        if (handle) await handle.close().catch(() => undefined)
        await fs.rm(temporaryPath, { force: true }).catch((error) => {
          logFailure('bibliography-save-cleanup', error, { temporaryPath })
        })
      }
      const savedVersion = registry.contentVersion(request.content)
      entry.exists = true
      entry.diskVersion = savedVersion
      return publicSnapshot(entry, request.content, savedVersion)
      } finally {
        entry.saving = false
      }
    })
  })

  onIpc('bibliography:stop', (event, request) => {
    if (typeof request?.documentId !== 'string') return
    stopForWebContents(event.sender.id, request.documentId)
  })

  return { revokeForWebContents, stopAll, stopForWebContents }
}

module.exports = { createBibliographyIpc }
