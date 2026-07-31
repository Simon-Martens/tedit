import { createTypstRenderer, type RenderSession } from '@myriaddreamin/typst.ts/renderer'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/wasm?url'

interface RenderUpdate {
  kind: 'new' | 'diff-v1'
  data: Uint8Array
}

interface RenderRequest {
  type: 'render'
  requestId: number
  updates: RenderUpdate[]
  window: {
    lo: { x: number; y: number }
    hi: { x: number; y: number }
  }
}

const renderer = createTypstRenderer()
const sessionPromise = (async () => {
  await renderer.init({ getModule: () => rendererWasmUrl })
  return new Promise<RenderSession>((resolve) => {
    void renderer.runWithSession(async (session) => {
      resolve(session)
      await new Promise<void>(() => undefined)
    })
  })
})()

self.onmessage = async (event: MessageEvent<RenderRequest>) => {
  const request = event.data
  if (request.type !== 'render') return
  try {
    const session = await sessionPromise
    const startedAt = performance.now()
    for (const update of request.updates) {
      if (update.kind === 'new') session.reset()
      session.manipulateData({ action: 'merge', data: update.data })
    }
    const patch = session.renderSvgDiff({ window: request.window })
    self.postMessage({
      type: 'result',
      requestId: request.requestId,
      reset: request.updates.some((update) => update.kind === 'new'),
      patch,
      pages: session.retrievePagesInfo(),
      docWidth: session.docWidth,
      docHeight: session.docHeight,
      renderDurationMs: performance.now() - startedAt,
    })
  } catch (error) {
    void sessionPromise.then((session) => session.reset())
    self.postMessage({
      type: 'error',
      requestId: request.requestId,
      message: error instanceof Error ? error.message : String(error),
    })
  }
}

void sessionPromise.then(() => self.postMessage({ type: 'ready' })).catch((error) => {
  self.postMessage({ type: 'error', requestId: 0, message: error instanceof Error ? error.message : String(error) })
})
