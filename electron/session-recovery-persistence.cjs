const fs = require('node:fs/promises')
const path = require('node:path')
const { logFailure } = require('./logging.cjs')

function createSessionRecoveryPersistence({ app, getGitMetadata, handleIpc, registry }) {
  const sessionPath = path.join(app.getPath('cache'), 'tedit', 'session.json')
  const recoveryPath = path.join(app.getPath('userData'), 'recovery.json')
  let sessionWrite = Promise.resolve()
  let recoveryWrite = Promise.resolve()

  function normalizeSession(value) {
    const filePaths = [...new Set((Array.isArray(value?.filePaths) ? value.filePaths : [])
      .filter((filePath) => typeof filePath === 'string')
      .map(registry.normalizeDocumentPath))]
    const activeFilePath = typeof value?.activeFilePath === 'string'
      ? registry.normalizeDocumentPath(value.activeFilePath)
      : undefined
    return {
      filePaths,
      activeFilePath: activeFilePath && filePaths.includes(activeFilePath) ? activeFilePath : undefined,
    }
  }

  async function readSession() {
    try {
      return normalizeSession(JSON.parse(await fs.readFile(sessionPath, 'utf8')))
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return normalizeSession({})
      throw error
    }
  }

  function normalizeRecovery(value) {
    const documents = (Array.isArray(value?.documents) ? value.documents : []).flatMap((document) => {
      if (typeof document?.name !== 'string' || typeof document.content !== 'string') return []
      return [{
        recoveryId: typeof document.recoveryId === 'string' ? document.recoveryId : undefined,
        filePath: typeof document.filePath === 'string'
          ? registry.normalizeDocumentPath(document.filePath)
          : undefined,
        name: document.name,
        content: document.content,
      }]
    })
    const activeFilePath = typeof value?.activeFilePath === 'string'
      ? registry.normalizeDocumentPath(value.activeFilePath)
      : undefined
    return { documents, activeFilePath }
  }

  async function readRecovery() {
    try {
      return normalizeRecovery(JSON.parse(await fs.readFile(recoveryPath, 'utf8')))
    } catch (error) {
      if (error?.code === 'ENOENT') return normalizeRecovery({})
      if (error instanceof SyntaxError) {
        logFailure('recovery-parse', error, { recoveryPath })
        return normalizeRecovery({})
      }
      throw error
    }
  }

  handleIpc('recovery:save', (_event, update) => {
    recoveryWrite = recoveryWrite.catch(() => undefined).then(async () => {
      const recovery = normalizeRecovery(update)
      await fs.mkdir(path.dirname(recoveryPath), { recursive: true })
      const temporaryPath = `${recoveryPath}.tmp`
      await fs.writeFile(temporaryPath, `${JSON.stringify(recovery, null, 2)}\n`, 'utf8')
      await fs.rename(temporaryPath, recoveryPath)
    })
    return recoveryWrite
  })

  handleIpc('recovery:clear', () => {
    recoveryWrite = recoveryWrite.catch(() => undefined).then(() => fs.rm(recoveryPath, { force: true }))
    return recoveryWrite
  })

  handleIpc('session:restore', async () => {
    const [stored, recovery] = await Promise.all([readSession(), readRecovery()])
    const restored = await Promise.all(stored.filePaths.map(async (filePath) => {
      try {
        const content = await fs.readFile(filePath, 'utf8')
        const gitMetadata = await getGitMetadata(filePath)
        const remembered = registry.rememberDocument(filePath, content)
        registry.setWorkspaceRoot(remembered.filePath, gitMetadata.workspaceRoot)
        return {
          ...remembered,
          name: path.basename(remembered.filePath),
          content,
          ...gitMetadata,
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          registry.markSessionPathUnavailable(filePath)
          logFailure('session-restore-document', error, { filePath })
        }
        return undefined
      }
    }))
    const documents = restored.filter(Boolean)
    for (const recovered of recovery.documents) {
      if (!recovered.filePath) {
        documents.push({ ...recovered, isDirty: true })
        continue
      }
      const existingIndex = documents.findIndex(({ filePath }) => filePath === recovered.filePath)
      if (existingIndex >= 0) {
        if (documents[existingIndex].content === recovered.content) continue
        documents[existingIndex] = {
          ...documents[existingIndex],
          name: recovered.name,
          content: recovered.content,
          isDirty: true,
        }
        continue
      }
      registry.authorizeRecoveredDocument(recovered.filePath)
      documents.push({ ...recovered, isDirty: true })
    }
    const preferredActivePath = recovery.activeFilePath ?? stored.activeFilePath
    return {
      documents,
      activeFilePath: documents.some(({ filePath }) => filePath === preferredActivePath)
        ? preferredActivePath
        : documents[0]?.filePath,
    }
  })

  handleIpc('session:save', (_event, update) => {
    sessionWrite = sessionWrite.catch(() => undefined).then(async () => {
      const requested = normalizeSession(update)
      const stored = normalizeSession({
        filePaths: [
          ...requested.filePaths.filter(registry.isAllowed),
          ...registry.getUnavailableSessionPaths(),
        ],
        activeFilePath: requested.activeFilePath,
      })
      await fs.mkdir(path.dirname(sessionPath), { recursive: true })
      const temporaryPath = `${sessionPath}.tmp`
      await fs.writeFile(temporaryPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
      await fs.rename(temporaryPath, sessionPath)
    })
    return sessionWrite
  })

  function pendingWrites() {
    return [
      sessionWrite.catch((error) => logFailure('session-shutdown', error)),
      recoveryWrite.catch((error) => logFailure('recovery-shutdown', error)),
    ]
  }

  return { pendingWrites }
}

module.exports = { createSessionRecoveryPersistence }
