import { useEffect, useRef } from 'react'
import { formatError } from '../lib/documents'
import { toLanguageServerDocuments } from '../lib/languageServerDocuments'
import type { EditorDocument, LanguageServerStatus } from '../types'

const PDF_COMPILE_SETTLE_MS = 500
const PDF_COMPILE_IDLE_TIMEOUT_MS = 1_000

export function useTypstCompilation(
  document: EditorDocument | undefined,
  documents: EditorDocument[],
  updateDocument: (id: string, update: Partial<EditorDocument>) => void,
  languageServerStatus: LanguageServerStatus,
  includeHtml: boolean,
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
    const compileTarget = includeHtml ? 'html' : 'pdf'
    if (document.compileTarget === compileTarget && (includeHtml
      ? document.htmlAttemptedRevision === document.sourceRevision
        && document.htmlAttemptedDependencyRevision === document.dependencyRevision
      : document.pdfAttemptedRevision === document.sourceRevision
        && document.pdfAttemptedDependencyRevision === document.dependencyRevision
    )) return
    const attemptedUpdate = includeHtml ? {
      htmlAttemptedRevision: document.sourceRevision,
      htmlAttemptedDependencyRevision: document.dependencyRevision,
    } : {
      pdfAttemptedRevision: document.sourceRevision,
      pdfAttemptedDependencyRevision: document.dependencyRevision,
    }
    const desktop = window.typstDesktop
    if (!desktop) {
      updateRef.current(document.id, {
        attemptedRevision: document.sourceRevision,
        attemptedDependencyRevision: document.dependencyRevision,
        ...attemptedUpdate,
        compileState: 'error',
        compileTarget,
        messages: [`${includeHtml ? 'HTML' : 'PDF'} compilation requires the tedit desktop app.`],
      })
      return
    }
    if (languageServerStatus.documentId === document.id && languageServerStatus.state === 'error') {
      updateRef.current(document.id, {
        attemptedRevision: document.sourceRevision,
        attemptedDependencyRevision: document.dependencyRevision,
        ...attemptedUpdate,
        compileState: 'error',
        compileTarget,
        messages: [languageServerStatus.message],
      })
      return
    }
    if (languageServerStatus.documentId !== document.id || languageServerStatus.state !== 'ready') return
    const version = ++versionRef.current

    let idleCallback: number | undefined
    const timeout = window.setTimeout(() => {
      idleCallback = window.requestIdleCallback(() => {
        idleCallback = undefined
        updateRef.current(document.id, {
          compileState: 'compiling',
          compileTarget,
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
              includeHtml,
              openDocuments: toLanguageServerDocuments(documents),
            })
            if (version !== versionRef.current) return
            if ('cancelled' in output) return
            if ('error' in output) throw new Error(output.error)
            if (output.version !== document.sourceRevision) return

            const nextUrl = output.pdf ? URL.createObjectURL(new Blob(
              [output.pdf],
              { type: 'application/pdf' },
            )) : undefined
            const previousUrl = document.pdfUrl
            const elapsed = output.durationMs
            updateRef.current(document.id, {
              attemptedRevision: document.sourceRevision,
              attemptedDependencyRevision: document.dependencyRevision,
              ...attemptedUpdate,
              compileState: 'success',
              compileTarget,
              compileDurationMs: elapsed,
              ...(nextUrl ? {
                pdfUrl: nextUrl,
                pdfRevision: document.sourceRevision,
                pdfDependencyRevision: document.dependencyRevision,
              } : {}),
              ...(output.html === undefined ? {} : {
                html: output.html,
                htmlRevision: document.sourceRevision,
                htmlDependencyRevision: document.dependencyRevision,
              }),
              compiledAt: new Date().toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }),
              messages: [
                `Compiled ${document.previewRootPath?.split(/[\\/]/).pop() ?? document.fileName} to ${includeHtml ? 'HTML' : 'PDF'} in ${elapsed} ms`,
                'Compiled with Tinymist and available system fonts.',
                `${includeHtml ? 'HTML' : 'PDF'} preview is up to date.`,
              ],
              diagnostics: [],
            })
            if (nextUrl && previousUrl && previousUrl !== nextUrl) {
              window.setTimeout(() => URL.revokeObjectURL(previousUrl), 30_000)
            }
          } catch (error) {
            if (version !== versionRef.current) return
            updateRef.current(document.id, {
              attemptedRevision: document.sourceRevision,
              attemptedDependencyRevision: document.dependencyRevision,
              ...attemptedUpdate,
              compileState: 'error',
              compileTarget,
              compileDurationMs: undefined,
              messages: [formatError(error)],
              diagnostics: [],
            })
          }
        })()
      }, { timeout: PDF_COMPILE_IDLE_TIMEOUT_MS })
    }, PDF_COMPILE_SETTLE_MS)

    return () => {
      window.clearTimeout(timeout)
      if (idleCallback !== undefined) window.cancelIdleCallback(idleCallback)
      versionRef.current += 1
    }
  }, [
    document?.id,
    document?.sourceRevision,
    document?.dependencyRevision,
    document?.previewRootPath,
    document?.htmlRevision,
    includeHtml,
    openDocumentsKey,
    languageServerStatus.documentId,
    languageServerStatus.message,
    languageServerStatus.state,
  ])
}
