import { useEffect, useRef, useState } from 'react'
import type {
  EditorDocument,
  LanguageServerDiagnostic,
  LanguageServerStatus,
} from '../types'

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
  updateDocument: (id: string, update: Partial<EditorDocument>) => void,
) {
  const [status, setStatus] = useState<LanguageServerStatus>(DISABLED_STATUS)
  const [retryGeneration, setRetryGeneration] = useState(0)
  const documentRef = useRef(document)
  const failedRevisionRef = useRef<number | undefined>(undefined)
  const updateRef = useRef(updateDocument)
  documentRef.current = document
  updateRef.current = updateDocument

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
    void desktop.startLanguageServer({
      documentId,
      filePath: document.filePath,
      source: document.source,
      version: document.sourceRevision,
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
      desktop.stopLanguageServer()
      updateRef.current(documentId, { languageServerDiagnostics: undefined })
    }
  }, [document?.id, document?.filePath, retryGeneration])

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
    window.typstDesktop.updateLanguageServer({
      documentId: document.id,
      source: document.source,
      version: document.sourceRevision,
    })
  }, [document?.id, document?.filePath, document?.sourceRevision, status.documentId, status.state])

  return status
}
