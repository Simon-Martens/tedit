import { useEffect, useRef, useState } from 'react'
import { reportError } from '../lib/logging'
import type { DesktopFileChange, WatchHealthStatus } from '../types'
import type { EditorDocumentsController } from './useEditorDocuments'

interface DocumentWatchingOptions {
  editor: EditorDocumentsController
  sessionRestored: boolean
  sessionFilePaths: string[]
  sessionKey: string
}

const disabledStatus: WatchHealthStatus = {
  state: 'disabled',
  message: 'No open files need filesystem watching.',
  watchedDirectories: 0,
  requestedDirectories: 0,
}

export function useDocumentWatching({
  editor,
  sessionRestored,
  sessionFilePaths,
  sessionKey,
}: DocumentWatchingOptions) {
  const [status, setStatus] = useState<WatchHealthStatus>(disabledStatus)
  const [restartGeneration, setRestartGeneration] = useState(0)
  const requestRef = useRef(0)
  const conflictQueueRef = useRef(Promise.resolve())

  useEffect(() => {
    if (!sessionRestored || !window.typstDesktop) return
    const request = ++requestRef.current
    void window.typstDesktop.watchDocuments(sessionFilePaths)
      .then((nextStatus) => {
        if (request === requestRef.current) setStatus(nextStatus)
      })
      .catch((error) => {
        if (request !== requestRef.current) return
        reportError('document-watch', error)
        setStatus({
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
          watchedDirectories: 0,
          requestedDirectories: 0,
        })
      })
  }, [sessionRestored, sessionKey, restartGeneration])

  useEffect(() => window.typstDesktop?.onDocumentWatchStatus(setStatus), [])

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!desktop) return

    const applyDiskChange = (
      documentId: string,
      change: DesktopFileChange,
      expectedRevision: number,
      discardDirty = false,
    ) => {
      editor.transformDocuments((current) => current.map((document) => {
        if (document.id !== documentId) return document
        if (document.sourceRevision !== expectedRevision) return document
        if (change.kind === 'deleted') {
          return {
            ...document,
            diskVersion: undefined,
            isDirty: true,
            messages: [`${document.fileName} was deleted outside tedit. Saving will recreate it.`, ...document.messages.slice(0, 3)],
          }
        }
        if (change.content === document.source) {
          return { ...document, diskVersion: change.diskVersion, isDirty: false }
        }
        if (document.isDirty && !discardDirty) return document
        return {
          ...document,
          source: change.content ?? '',
          sourceRevision: document.sourceRevision + 1,
          diskVersion: change.diskVersion,
          isDirty: false,
          messages: [`Reloaded ${document.fileName} from disk.`, ...document.messages.slice(0, 3)],
        }
      }))
    }

    return desktop.onDocumentChange((change) => {
      const changedDocument = editor.getDocuments().find(({ filePath }) => filePath === change.filePath)
      if (!changedDocument) return
      if (change.kind === 'changed' && change.content === changedDocument.source) {
        applyDiskChange(changedDocument.id, change, changedDocument.sourceRevision)
        return
      }
      if (!changedDocument.isDirty && change.kind === 'changed') {
        applyDiskChange(changedDocument.id, change, changedDocument.sourceRevision)
        return
      }

      conflictQueueRef.current = conflictQueueRef.current.then(async () => {
        const current = editor.getDocuments().find(({ id }) => id === changedDocument.id)
        if (!current) return
        const resolution = await desktop.resolveDocumentConflict({
          name: current.fileName,
          deleted: change.kind === 'deleted',
        })
        if (resolution === 'reload') {
          applyDiskChange(current.id, change, current.sourceRevision, true)
        } else {
          editor.transformDocuments((documents) => documents.map((document) => document.id === current.id ? {
            ...document,
            diskVersion: change.diskVersion,
            isDirty: true,
            messages: [`Keeping editor changes for ${document.fileName}.`, ...document.messages.slice(0, 3)],
          } : document))
        }
      }).catch((error) => reportError('external-change-resolution', error))
    })
  }, [])

  return {
    status,
    restart: () => setRestartGeneration((current) => current + 1),
  }
}
