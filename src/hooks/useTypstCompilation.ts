import { useEffect, useRef } from 'react'
import { formatError } from '../lib/documents'
import { toLanguageServerDocuments } from '../lib/languageServerDocuments'
import type { EditorDocument, LanguageServerStatus } from '../types'

export function useTypstCompilation(
  document: EditorDocument | undefined,
  documents: EditorDocument[],
  updateDocument: (id: string, update: Partial<EditorDocument>) => void,
  languageServerStatus: LanguageServerStatus,
) {
  const updateRef = useRef(updateDocument)
  const versionRef = useRef(0)
  updateRef.current = updateDocument
  const openDocumentsKey = documents
    .flatMap((openDocument) => openDocument.filePath
      ? [`${openDocument.filePath}\0${openDocument.sourceRevision}`]
      : [])
    .join('\u0001')

  useEffect(() => {
    if (!document) return
    if (
      document.attemptedRevision === document.sourceRevision
      && document.attemptedDependencyRevision === document.dependencyRevision
    ) return
    const desktop = window.typstDesktop
    if (!desktop) {
      updateRef.current(document.id, {
        attemptedRevision: document.sourceRevision,
        attemptedDependencyRevision: document.dependencyRevision,
        compileState: 'error',
        messages: ['PDF compilation requires the tedit desktop app.'],
      })
      return
    }
    if (languageServerStatus.documentId === document.id && languageServerStatus.state === 'error') {
      updateRef.current(document.id, {
        attemptedRevision: document.sourceRevision,
        attemptedDependencyRevision: document.dependencyRevision,
        compileState: 'error',
        messages: [languageServerStatus.message],
      })
      return
    }
    if (languageServerStatus.documentId !== document.id || languageServerStatus.state !== 'ready') return
    const version = ++versionRef.current

    const timeout = window.setTimeout(() => {
      updateRef.current(document.id, {
        compileState: 'compiling',
        diagnostics: [],
      })

      void (async () => {
        if (version !== versionRef.current) return

        try {
          const output = await desktop.compileWithLanguageServer({
            documentId: document.id,
            source: document.source,
            version: document.sourceRevision,
            previewFilePath: document.previewRootPath,
            openDocuments: toLanguageServerDocuments(documents),
          })
          if (version !== versionRef.current) return
          if ('cancelled' in output) return
          if ('error' in output) throw new Error(output.error)
          if (output.version !== document.sourceRevision) return

          const nextUrl = URL.createObjectURL(new Blob(
            [output.pdf],
            { type: 'application/pdf' },
          ))
          const elapsed = output.durationMs
          updateRef.current(document.id, {
            attemptedRevision: document.sourceRevision,
            attemptedDependencyRevision: document.dependencyRevision,
            compileState: 'success',
            compileDurationMs: elapsed,
            pdfUrl: nextUrl,
            compiledAt: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
            messages: [
              `Compiled ${document.previewRootPath?.split(/[\\/]/).pop() ?? document.fileName} in ${elapsed} ms`,
              'Compiled with Tinymist and available system fonts.',
              'PDF preview is up to date.',
            ],
            diagnostics: [],
          })
        } catch (error) {
          if (version !== versionRef.current) return
          updateRef.current(document.id, {
            attemptedRevision: document.sourceRevision,
            attemptedDependencyRevision: document.dependencyRevision,
            compileState: 'error',
            compileDurationMs: undefined,
            messages: [formatError(error)],
            diagnostics: [],
          })
        }
      })()
    }, 20)

    return () => {
      window.clearTimeout(timeout)
      versionRef.current += 1
    }
  }, [
    document?.id,
    document?.sourceRevision,
    document?.dependencyRevision,
    document?.previewRootPath,
    openDocumentsKey,
    languageServerStatus.documentId,
    languageServerStatus.message,
    languageServerStatus.state,
  ])
}
