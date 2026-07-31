import { useEffect, useRef } from 'react'
import { formatError } from '../lib/documents'
import { reportError } from '../lib/logging'
import type { EditorDocument } from '../types'
import type { EditorDocumentsController } from './useEditorDocuments'

function recoveryDocuments(documents: EditorDocument[]) {
  return documents
    .filter((document) => document.isDirty || !document.filePath)
    .map((document) => ({
      recoveryId: document.id,
      filePath: document.filePath,
      name: document.fileName,
      content: document.source,
    }))
}

export function useDesktopRecovery(
  editor: EditorDocumentsController,
  persistenceEnabled: boolean,
  saveDesktopDocument: (document: EditorDocument) => Promise<boolean>,
  auxiliary?: {
    getDirtyNames(): string[]
    saveAll(): Promise<boolean>
    waitForIdle?(): Promise<void>
  },
) {
  const recoveryTimerRef = useRef<number | undefined>(undefined)
  const closingRef = useRef(false)
  const editorRef = useRef(editor)
  const saveDesktopDocumentRef = useRef(saveDesktopDocument)
  const auxiliaryRef = useRef(auxiliary)
  editorRef.current = editor
  saveDesktopDocumentRef.current = saveDesktopDocument
  auxiliaryRef.current = auxiliary
  const recoveryKey = editor.documents
    .filter((document) => document.isDirty || !document.filePath)
    .map((document) => `${document.id}\0${document.filePath ?? ''}\0${document.sourceRevision}`)
    .join('\u0001')

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!persistenceEnabled || !desktop || closingRef.current) return
    recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = undefined
      const documents = editor.getDocuments()
      void desktop.saveRecovery({
        documents: recoveryDocuments(documents),
        activeFilePath: documents.find(({ id }) => id === editor.activeId)?.filePath,
      }).catch((error) => reportError('recovery-save', error))
    }, 400)
    return () => {
      window.clearTimeout(recoveryTimerRef.current)
      recoveryTimerRef.current = undefined
    }
  }, [persistenceEnabled, recoveryKey, editor.activeId])

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!desktop) return
    return desktop.onAppCloseRequested(() => {
      void (async () => {
        const currentEditor = editorRef.current
        desktop.acknowledgeAppClose()
        closingRef.current = true
        window.clearTimeout(recoveryTimerRef.current)
        recoveryTimerRef.current = undefined
        await auxiliaryRef.current?.waitForIdle?.()
        const persistCurrentRecovery = async () => {
          const documents = currentEditor.getDocuments()
          await desktop.saveRecovery({
            documents: recoveryDocuments(documents),
            activeFilePath: documents.find(({ id }) => id === currentEditor.getActiveId())?.filePath,
          })
        }
        const cancelClose = async () => {
          closingRef.current = false
          await persistCurrentRecovery().catch((error) => reportError('recovery-save', error))
          desktop.completeAppClose(false)
        }
        const recoverable = currentEditor.getDocuments().filter((document) => document.isDirty || !document.filePath)
        const auxiliaryDirtyNames = auxiliaryRef.current?.getDirtyNames() ?? []
        if (!recoverable.length && !auxiliaryDirtyNames.length) {
          try {
            await desktop.clearRecovery()
            desktop.completeAppClose(true)
          } catch (error) {
            reportError('recovery-clear', error)
            await cancelClose()
          }
          return
        }
        const resolution = await desktop.resolveAppClose({
          dirtyNames: [...recoverable.map(({ fileName }) => fileName), ...auxiliaryDirtyNames],
        }).catch((error) => {
          reportError('close-resolution', error)
          return 'cancel' as const
        })
        if (resolution === 'cancel') {
          await cancelClose()
          return
        }
        if (resolution === 'save') {
          for (const document of recoverable) {
            if (!await saveDesktopDocumentRef.current(document)) {
              await cancelClose()
              return
            }
          }
          if (auxiliaryRef.current && !await auxiliaryRef.current.saveAll()) {
            await cancelClose()
            return
          }
          await new Promise((resolve) => window.setTimeout(resolve, 0))
          if (
            currentEditor.getDocuments().some((document) => document.isDirty || !document.filePath)
            || (auxiliaryRef.current?.getDirtyNames().length ?? 0) > 0
          ) {
            await cancelClose()
            return
          }
        }
        try {
          await desktop.clearRecovery()
          desktop.completeAppClose(true)
        } catch (error) {
          const current = currentEditor.getDocuments()[0]
          if (current) currentEditor.updateDocument(current.id, {
            compileState: 'error',
            messages: [`Could not clear recovery data: ${formatError(error)}`],
          })
          await cancelClose()
        }
      })()
    })
  }, [])
}
