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
import type { TypstCompileRequest, TypstCompileResponse, TypstWorkerDiagnostic } from '../lib/typstWorkerProtocol'

const bundledFonts = [
  libertinusRegular,
  libertinusBold,
  libertinusItalic,
  libertinusBoldItalic,
  newComputerModernMath,
]

const compilerPromises = new Map<string, Promise<TypstCompiler>>()

function getCompiler(fontKey: string, systemFonts: ArrayBuffer[]) {
  const existing = compilerPromises.get(fontKey)
  if (existing) return existing

  const loadSystemFonts: BeforeBuildFn = async (_stage, { builder }) => {
    for (const font of systemFonts) await builder.add_raw_font(new Uint8Array(font))
  }
  const promise = (async () => {
    const compiler = createTypstCompiler()
    await compiler.init({
      getModule: () => compilerWasmUrl,
      beforeBuild: [loadFonts(bundledFonts, { assets: false }), loadSystemFonts],
    })
    return compiler
  })()
  compilerPromises.set(fontKey, promise)
  void promise.catch(() => compilerPromises.delete(fontKey))
  return promise
}

function post(response: TypstCompileResponse, transfer: Transferable[] = []) {
  globalThis.postMessage(response, { transfer })
}

async function compile(request: TypstCompileRequest) {
  const started = performance.now()
  try {
    const compiler = await getCompiler(request.fontKey, request.systemFonts)
    const mainFilePath = `/documents/${request.documentId}.typ`
    compiler.addSource(mainFilePath, request.source)
    const output = await compiler.compile({
      mainFilePath,
      format: CompileFormatEnum.pdf,
      diagnostics: 'full',
    })
    const result = output.result
    const pdf = result
      ? result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength) as ArrayBuffer
      : undefined
    post({
      type: 'result',
      requestId: request.requestId,
      durationMs: Math.round(performance.now() - started),
      diagnostics: (output.diagnostics ?? []) as TypstWorkerDiagnostic[],
      fontMessage: request.fontMessage,
      pdf,
    }, pdf ? [pdf] : [])
  } catch (error) {
    post({
      type: 'result',
      requestId: request.requestId,
      durationMs: Math.round(performance.now() - started),
      diagnostics: [],
      fontMessage: request.fontMessage,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

let compileQueue = Promise.resolve()
globalThis.onmessage = ({ data }: MessageEvent<TypstCompileRequest>) => {
  if (data.type !== 'compile') return
  compileQueue = compileQueue.then(() => compile(data))
}
