import { useEffect, useRef } from 'react'
import { formatError } from '../lib/documents'
import { compileTypst } from '../lib/typstCompilerWorker'
import type { TypstWorkerDiagnostic } from '../lib/typstWorkerProtocol'
import type { EditorDiagnostic, EditorDocument } from '../types'

function parseDiagnostic(
  diagnostic: TypstWorkerDiagnostic,
  mainFilePath: string,
): EditorDiagnostic | undefined {
  const diagnosticPath = diagnostic.path.replace(/^\/+/, '')
  const sourcePath = mainFilePath.replace(/^\/+/, '')
  if (
    diagnosticPath
    && diagnosticPath !== sourcePath
    && diagnosticPath.split('/').at(-1) !== sourcePath.split('/').at(-1)
  ) return undefined
  const range = /^(\d+):(\d+)(?:-(\d+):(\d+))?$/.exec(diagnostic.range)
  if (!range) return undefined
  const startLineNumber = Number(range[1]) + 1
  const endLineNumber = Number(range[3] ?? range[1]) + 1
  const startColumn = Number(range[2]) + 1
  const endColumn = Number(range[4] ?? range[2]) + 1
  return {
    severity: diagnostic.severity.toLowerCase() === 'error'
      ? 'error'
      : diagnostic.severity.toLowerCase() === 'warning' ? 'warning' : 'info',
    message: diagnostic.message,
    startLineNumber,
    startColumn,
    endLineNumber,
    endColumn: Math.max(endColumn, startColumn + Number(endLineNumber === startLineNumber)),
  }
}

export function useTypstCompilation(
  document: EditorDocument | undefined,
  updateDocument: (id: string, update: Partial<EditorDocument>) => void,
) {
  const updateRef = useRef(updateDocument)
  const versionRef = useRef(0)
  updateRef.current = updateDocument

  useEffect(() => {
    if (!document) return
    if (document.attemptedRevision === document.sourceRevision) return
    const version = ++versionRef.current

    const timeout = window.setTimeout(() => {
      updateRef.current(document.id, {
        compileState: 'compiling',
        diagnostics: [],
      })

      void (async () => {
        if (version !== versionRef.current) return

        try {
          const output = await compileTypst(document.id, document.source)
          if (version !== versionRef.current) return
          const mainFilePath = `/documents/${document.id}.typ`
          if (output.error) throw new Error(output.error)
          const diagnostics = output.diagnostics
          const editorDiagnostics = diagnostics.flatMap((diagnostic) => {
            const parsed = parseDiagnostic(diagnostic, mainFilePath)
            return parsed ? [parsed] : []
          })
          const lines = diagnostics.map(
            (item) => `${item.severity.toUpperCase()} ${item.path || document.fileName}:${item.range}  ${item.message}`,
          )

          if (!output.pdf) {
            updateRef.current(document.id, {
              attemptedRevision: document.sourceRevision,
              compileState: 'error',
              compileDurationMs: undefined,
              messages: lines.length ? lines : ['Compilation failed without diagnostics.'],
              diagnostics: editorDiagnostics,
            })
            return
          }

          const nextUrl = URL.createObjectURL(new Blob(
            [output.pdf],
            { type: 'application/pdf' },
          ))
          const elapsed = output.durationMs
          updateRef.current(document.id, {
            attemptedRevision: document.sourceRevision,
            compileState: 'success',
            compileDurationMs: elapsed,
            pdfUrl: nextUrl,
            compiledAt: new Date().toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
            messages: [
              `Compiled ${document.fileName} in ${elapsed} ms`,
              output.fontMessage,
              ...lines,
              lines.length ? 'PDF updated with warnings.' : 'PDF preview is up to date.',
            ],
            diagnostics: editorDiagnostics,
          })
        } catch (error) {
          if (version !== versionRef.current) return
          updateRef.current(document.id, {
            attemptedRevision: document.sourceRevision,
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
  }, [document?.id, document?.sourceRevision])
}
