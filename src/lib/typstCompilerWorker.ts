import type { TypstCompileRequest, TypstCompileResponse } from './typstWorkerProtocol'

interface FontResolution {
  key: string
  message: string
  buffers: ArrayBuffer[]
}

const fontPromises = new Map<string, Promise<FontResolution>>()
const sentFontKeys = new Set<string>()
const pending = new Map<number, {
  resolve(response: TypstCompileResponse): void
  reject(error: Error): void
}>()
let requestId = 0
let worker: Worker | undefined

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

function resolveFonts(source: string) {
  const families = extractFontFamilies(source)
  const key = families.map((family) => family.toLocaleLowerCase()).join('\n')
  const existing = fontPromises.get(key)
  if (existing) return existing

  const promise = (async (): Promise<FontResolution> => {
    if (!families.length) return { key, message: 'Using bundled default fonts.', buffers: [] }
    if (!window.queryLocalFonts) {
      return {
        key,
        message: 'Requested system fonts were not found; using bundled fallback fonts.',
        buffers: [],
      }
    }
    try {
      const requested = new Set(families.map((family) => family.toLocaleLowerCase()))
      const available = await window.queryLocalFonts()
      const matching = available.filter((font) => requested.has(font.family.toLocaleLowerCase()))
      const buffers: ArrayBuffer[] = []
      for (const font of matching) {
        try {
          buffers.push(await (await font.blob()).arrayBuffer())
        } catch {
          // Ignore an unreadable face while retaining the rest of its family.
        }
      }
      const matchedFamilies = new Set(matching.map((font) => font.family.toLocaleLowerCase()))
      const missing = families.filter((family) => !matchedFamilies.has(family.toLocaleLowerCase()))
      const message = buffers.length
        ? `Loaded ${buffers.length} system font faces${missing.length ? `; missing: ${missing.join(', ')}` : '.'}`
        : `System fonts not found: ${families.join(', ')}; using bundled fallback fonts.`
      return { key, message, buffers }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        key,
        message: `System fonts could not be loaded (${message}); using bundled fallback fonts.`,
        buffers: [],
      }
    }
  })()
  fontPromises.set(key, promise)
  return promise
}

function getWorker() {
  if (worker) return worker
  worker = new Worker(new URL('../workers/typstCompiler.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }: MessageEvent<TypstCompileResponse>) => {
    const request = pending.get(data.requestId)
    if (!request) return
    pending.delete(data.requestId)
    request.resolve(data)
  }
  worker.onerror = ({ message }) => {
    const error = new Error(message || 'Typst compiler worker failed.')
    for (const request of pending.values()) request.reject(error)
    pending.clear()
    worker?.terminate()
    worker = undefined
    sentFontKeys.clear()
    fontPromises.clear()
  }
  return worker
}

export async function compileTypst(documentId: string, source: string) {
  const fonts = await resolveFonts(source)
  const id = ++requestId
  const includeFonts = !sentFontKeys.has(fonts.key)
  if (includeFonts) sentFontKeys.add(fonts.key)
  const systemFonts = includeFonts ? fonts.buffers : []
  const request: TypstCompileRequest = {
    type: 'compile',
    requestId: id,
    documentId,
    source,
    fontKey: fonts.key,
    fontMessage: fonts.message,
    systemFonts,
  }
  const result = new Promise<TypstCompileResponse>((resolve, reject) => {
    pending.set(id, { resolve, reject })
  })
  getWorker().postMessage(request, systemFonts)
  return result
}
