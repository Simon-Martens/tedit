import { useEffect, useState } from 'react'
import { createDocument } from '../lib/documents'
import { reportError } from '../lib/logging'
import type { EditorDocumentsController } from './useEditorDocuments'

export function useDesktopSession(editor: EditorDocumentsController) {
  const [restored, setRestored] = useState(() => !window.typstDesktop)
  const [persistenceEnabled, setPersistenceEnabled] = useState(() => !window.typstDesktop)
  const filePaths = editor.documents.flatMap(({ filePath }) => filePath ? [filePath] : [])
  const filePathsKey = filePaths.join('\0')
  const activeFilePath = (editor.documents.find(({ id }) => id === editor.activeId)
    ?? editor.documents[0])?.filePath

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!desktop) return
    let cancelled = false
    desktop.restoreSession().then((session) => {
      if (cancelled) return
      if (!session.documents.length) {
        setPersistenceEnabled(true)
        return
      }
      const restoredDocuments = session.documents.map((document) => createDocument({
        id: document.recoveryId,
        fileName: document.name,
        filePath: document.filePath,
        source: document.content,
        diskVersion: document.diskVersion,
        isDirty: document.isDirty,
        repoCommit: document.commit,
        repoName: document.repoName,
      }))
      editor.restoreDocuments(restoredDocuments, session.activeFilePath)
      setPersistenceEnabled(true)
    }).catch((error) => {
      if (!cancelled) console.error('Could not restore the tedit session.', error)
    }).finally(() => {
      if (!cancelled) setRestored(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!persistenceEnabled || !window.typstDesktop) return
    void window.typstDesktop.saveSession({
      filePaths,
      activeFilePath,
    }).catch((error) => reportError('session-save', error))
  }, [persistenceEnabled, filePathsKey, activeFilePath])

  return { restored, persistenceEnabled, filePaths, filePathsKey }
}
