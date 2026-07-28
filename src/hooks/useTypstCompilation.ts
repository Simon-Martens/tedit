import { useEffect, useRef } from 'react'
import { loadFonts, type BeforeBuildFn } from '@myriaddreamin/typst.ts'
import {
  CompileFormatEnum,
  createTypstCompiler,
  type TypstCompiler,
} from '@myriaddreamin/typst.ts/compiler'
import compilerWasmUrl from '@myriaddreamin/typst-ts-web-compiler/wasm?url'
import libertinusRegular from '../assets/fonts/LibertinusSerif-Regular.otf?inline'
import libertinusBold from '../assets/fonts/LibertinusSerif-Bold.otf?inline'
import libertinusItalic from '../assets/fonts/LibertinusSerif-Italic.otf?inline'
import libertinusBoldItalic from '../assets/fonts/LibertinusSerif-BoldItalic.otf?inline'
import newComputerModernMath from '../assets/fonts/NewCMMath-Regular.otf?inline'
import { formatError } from '../lib/documents'
import type { EditorDiagnostic, EditorDocument } from '../types'

interface Diagnostic {
  severity: string
  path: string
  range: string
  message: string
}

function parseDiagnostic(
  diagnostic: Diagnostic,
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

const bundledFonts = [
  libertinusRegular,
  libertinusBold,
  libertinusItalic,
  libertinusBoldItalic,
  newComputerModernMath,
]

interface CompilerEntry {
  compiler: TypstCompiler
  fontMessage: string
}

const compilerPromises = new Map<string, Promise<CompilerEntry>>()
let compileQueue = Promise.resolve()

function waitForStatusPaint() {
  return new Promise<void>((resolve) => {
    let resolved = false
    const finish = () => {
      if (resolved) return
      resolved = true
      resolve()
    }
    window.setTimeout(finish, 50)
    window.requestAnimationFrame(() => window.setTimeout(finish, 0))
  })
}

function extractFontFamilies(source: string) {
  const families = new Set<string>()
  const assignment = /\bfont\s*:\s*(\((?:[^()"]|"(?:\\.|[^"\\])*")*\)|"(?:\\.|[^"\\])*")/g
  for (const match of source.matchAll(assignment)) {
    for (const value of match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)) {
      try {
        families.add(JSON.parse(`"${value[1]}"`))
      } catch {
        families.add(value[1])
      }
    }
  }
  return [...families].filter(Boolean).sort((left, right) => left.localeCompare(right))
}

function getCompiler(source: string) {
  const families = extractFontFamilies(source)
  const key = families.map((family) => family.toLocaleLowerCase()).join('\n')
  const existing = compilerPromises.get(key)
  if (existing) return existing

  const promise = (async () => {
    let fontMessage = families.length
      ? 'Requested system fonts were not found; using bundled fallback fonts.'
      : 'Using bundled default fonts.'
    const loadRequestedSystemFonts: BeforeBuildFn = async (_stage, { builder }) => {
      if (!families.length || !window.queryLocalFonts) return
      try {
        const requested = new Set(families.map((family) => family.toLocaleLowerCase()))
        const available = await window.queryLocalFonts()
        const matching = available.filter((font) => requested.has(font.family.toLocaleLowerCase()))
        let loaded = 0
        for (const font of matching) {
          try {
            const data = new Uint8Array(await (await font.blob()).arrayBuffer())
            await builder.add_raw_font(data)
            loaded += 1
          } catch {
            // Ignore an unreadable face while retaining the rest of its family.
          }
        }
        const matchedFamilies = new Set(matching.map((font) => font.family.toLocaleLowerCase()))
        const missing = families.filter((family) => !matchedFamilies.has(family.toLocaleLowerCase()))
        fontMessage = loaded
          ? `Loaded ${loaded} system font faces${missing.length ? `; missing: ${missing.join(', ')}` : '.'}`
          : `System fonts not found: ${families.join(', ')}; using bundled fallback fonts.`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        fontMessage = `System fonts could not be loaded (${message}); using bundled fallback fonts.`
      }
    }

    const compiler = createTypstCompiler()
    await compiler.init({
      getModule: () => compilerWasmUrl,
      beforeBuild: [loadFonts(bundledFonts, { assets: false }), loadRequestedSystemFonts],
    })
    return { compiler, fontMessage }
  })()
  compilerPromises.set(key, promise)
  return promise
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
        messages: ['Compiling document...'],
        diagnostics: [],
      })

      compileQueue = compileQueue.then(async () => {
        if (version !== versionRef.current) return
        await waitForStatusPaint()
        if (version !== versionRef.current) return
        const started = performance.now()

        try {
          const { compiler, fontMessage } = await getCompiler(document.source)
          if (version !== versionRef.current) return

          const mainFilePath = `/documents/${document.id}.typ`
          compiler.addSource(mainFilePath, document.source)
          const output = await compiler.compile({
            mainFilePath,
            format: CompileFormatEnum.pdf,
            diagnostics: 'full',
          })
          if (version !== versionRef.current) return

          const diagnostics = (output.diagnostics ?? []) as Diagnostic[]
          const editorDiagnostics = diagnostics.flatMap((diagnostic) => {
            const parsed = parseDiagnostic(diagnostic, mainFilePath)
            return parsed ? [parsed] : []
          })
          const lines = diagnostics.map(
            (item) => `${item.severity.toUpperCase()} ${item.path || document.fileName}:${item.range}  ${item.message}`,
          )

          if (!output.result) {
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
            [new Uint8Array(output.result)],
            { type: 'application/pdf' },
          ))
          const elapsed = Math.round(performance.now() - started)
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
              fontMessage,
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
      })
    }, 450)

    return () => {
      window.clearTimeout(timeout)
      versionRef.current += 1
    }
  }, [document?.id, document?.sourceRevision])
}
