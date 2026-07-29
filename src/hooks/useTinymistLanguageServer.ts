import { useEffect, useRef, useState } from 'react'
import type {
  EditorDocument,
  LanguageServerDiagnostic,
  LanguageServerStatus,
} from '../types'
import { reportError } from '../lib/logging'
import { toLanguageServerDocuments } from '../lib/languageServerDocuments'

const DISABLED_STATUS: LanguageServerStatus = {
  documentId: '',
  state: 'disabled',
  message: 'Tinymist requires the desktop app.',
}

function toEditorDiagnostic(diagnostic: LanguageServerDiagnostic) {
  return {
    severity: diagnostic.severity === 1
      ? 'error' as const
      : diagnostic.severity === 2 ? 'warning' as const : 'info' as const,
    message: diagnostic.message,
    startLineNumber: diagnostic.range.start.line + 1,
    startColumn: diagnostic.range.start.character + 1,
    endLineNumber: diagnostic.range.end.line + 1,
    endColumn: diagnostic.range.end.character + 1,
  }
}

export function useTinymistLanguageServer(
  document: EditorDocument | undefined,
  documents: EditorDocument[],
  updateDocument: (id: string, update: Partial<EditorDocument>) => void,
) {
  const [status, setStatus] = useState<LanguageServerStatus>(DISABLED_STATUS)
  const [retryGeneration, setRetryGeneration] = useState(0)
  const documentRef = useRef(document)
  const failedRevisionRef = useRef<number | undefined>(undefined)
  const updateRef = useRef(updateDocument)
  documentRef.current = document
  updateRef.current = updateDocument
  const openDocuments = toLanguageServerDocuments(documents)
  const openDocumentsKey = openDocuments
    .map(({ documentId, filePath, version }) => `${documentId}\0${filePath}\0${version}`)
    .join('\u0001')

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!desktop || !document) {
      setStatus({ ...DISABLED_STATUS, documentId: document?.id ?? '' })
      if (document) updateRef.current(document.id, { languageServerDiagnostics: undefined })
      return
    }

    const documentId = document.id
    updateRef.current(documentId, { languageServerDiagnostics: undefined })
    setStatus({ documentId, state: 'starting', message: 'Starting Tinymist language server...' })
    const removeStatusListener = desktop.onLanguageServerStatus((nextStatus) => {
      if (nextStatus.documentId !== documentId) return
      setStatus(nextStatus)
      if (nextStatus.state === 'error') {
        failedRevisionRef.current = documentRef.current?.sourceRevision
        updateRef.current(documentId, { languageServerDiagnostics: undefined })
      } else if (nextStatus.state === 'ready') {
        failedRevisionRef.current = undefined
        const current = documentRef.current
        if (current?.id === documentId) {
          updateRef.current(documentId, {
            dependencyRevision: current.dependencyRevision + 1,
          })
        }
      }
    })
    const removeDiagnosticsListener = desktop.onLanguageServerDiagnostics((update) => {
      const current = documentRef.current
      if (
        update.documentId !== documentId
        || current?.id !== documentId
        || update.version !== current.sourceRevision
      ) return
      updateRef.current(documentId, {
        languageServerDiagnostics: update.diagnostics.map(toEditorDiagnostic),
      })
    })
    const removeDependencyListener = desktop.onLanguageServerDependencyChange((update) => {
      const current = documentRef.current
      if (update.documentId !== documentId || current?.id !== documentId) return
      updateRef.current(documentId, {
        dependencyRevision: current.dependencyRevision + 1,
      })
    })
    void desktop.startLanguageServer({
      documentId,
      filePath: document.filePath,
      previewFilePath: document.previewRootPath,
      source: document.source,
      version: document.sourceRevision,
      openDocuments,
    }).catch((error) => {
      setStatus({
        documentId,
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    })

    return () => {
      removeStatusListener()
      removeDiagnosticsListener()
      removeDependencyListener()
      desktop.stopLanguageServer()
      updateRef.current(documentId, { languageServerDiagnostics: undefined })
    }
  }, [document?.id, document?.filePath, document?.previewRootPath, retryGeneration])

  useEffect(() => {
    if (!window.typstDesktop || !document) return
    if (
      status.documentId === document.id
      && status.state === 'error'
      && failedRevisionRef.current !== document.sourceRevision
    ) {
      updateRef.current(document.id, {
        attemptedRevision: undefined,
        compileState: 'loading',
        messages: ['Restarting Tinymist...'],
      })
      setRetryGeneration((current) => current + 1)
      return
    }
    void window.typstDesktop.syncLanguageServerDocuments({
      documentId: document.id,
      openDocuments,
    }).catch((error) => reportError('tinymist-document-sync', error))
  }, [document?.id, document?.filePath, openDocumentsKey, status.documentId, status.state])

  return status
}
