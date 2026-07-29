const { createHash } = require('node:crypto')
const path = require('node:path')

function createDocumentRegistry() {
  const allowedDocumentPaths = new Set()
  const diskVersions = new Map()
  const unavailableSessionPaths = new Set()
  const workspaceRootsByDocument = new Map()

  function normalizeDocumentPath(filePath) {
    return path.normalize(path.resolve(filePath))
  }

  function contentVersion(content) {
    return createHash('sha256').update(content).digest('hex')
  }

  function rememberDocument(filePath, content) {
    const normalizedPath = normalizeDocumentPath(filePath)
    const diskVersion = contentVersion(content)
    allowedDocumentPaths.add(normalizedPath)
    unavailableSessionPaths.delete(normalizedPath)
    if (!workspaceRootsByDocument.has(normalizedPath)) {
      workspaceRootsByDocument.set(normalizedPath, path.dirname(normalizedPath))
    }
    diskVersions.set(normalizedPath, diskVersion)
    return { filePath: normalizedPath, diskVersion }
  }

  function authorizeRecoveredDocument(filePath) {
    allowedDocumentPaths.add(filePath)
    workspaceRootsByDocument.set(filePath, path.dirname(filePath))
  }

  function normalizeLanguageServerDocuments(documents) {
    return (Array.isArray(documents) ? documents : []).flatMap((document) => {
      if (
        typeof document?.documentId !== 'string'
        || !document.filePath
        || typeof document.source !== 'string'
        || !Number.isSafeInteger(document.version)
        || !Number.isSafeInteger(document.sourceVersion)
      ) return []
      const filePath = normalizeDocumentPath(document.filePath)
      if (!allowedDocumentPaths.has(filePath)) return []
      return [{
        documentId: document.documentId,
        filePath,
        source: document.source,
        version: document.version,
        sourceVersion: document.sourceVersion,
      }]
    })
  }

  return {
    authorizeRecoveredDocument,
    contentVersion,
    deleteDiskVersion: (filePath) => diskVersions.delete(filePath),
    getDiskVersion: (filePath) => diskVersions.get(filePath),
    getUnavailableSessionPaths: () => [...unavailableSessionPaths],
    getWorkspaceRoot: (filePath) => workspaceRootsByDocument.get(filePath),
    hasDiskVersion: (filePath) => diskVersions.has(filePath),
    isAllowed: (filePath) => allowedDocumentPaths.has(filePath),
    markSessionPathUnavailable: (filePath) => unavailableSessionPaths.add(filePath),
    normalizeDocumentPath,
    normalizeLanguageServerDocuments,
    rememberDocument,
    setDiskVersion: (filePath, diskVersion) => diskVersions.set(filePath, diskVersion),
    setWorkspaceRoot: (filePath, workspaceRoot) => workspaceRootsByDocument.set(filePath, workspaceRoot),
  }
}

module.exports = { createDocumentRegistry }
