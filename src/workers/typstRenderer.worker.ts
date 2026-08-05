import { createTypstRenderer, type RenderSession } from '@myriaddreamin/typst.ts/renderer'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/wasm?url'

interface RenderUpdate {
  kind: 'new' | 'diff-v1'
  data: Uint8Array
}

interface RenderRequest {
  type: 'render'
  requestId: number
  mode: 'svg' | 'canvas'
  updates: RenderUpdate[]
  initialPageCount?: number
  pageIndices?: number[]
  pixelPerPt?: number
  window: {
    lo: { x: number; y: number }
    hi: { x: number; y: number }
  }
}

const MAX_CANVAS_DIMENSION = 8192
const MAX_CANVAS_PIXELS = 8_000_000

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
  const pendingBitmaps: ImageBitmap[] = []
  try {
    const session = await sessionPromise
    const startedAt = performance.now()
    for (const update of request.updates) {
      if (update.kind === 'new') session.reset()
      session.manipulateData({ action: 'merge', data: update.data })
    }
    const pages = session.retrievePagesInfo()
    if (request.mode === 'canvas') {
      const images: Array<{
        pageIndex: number
        pixelWidth: number
        pixelHeight: number
        bitmap: ImageBitmap
      }> = []
      for (const pageIndex of request.pageIndices ?? []) {
        const page = pages[pageIndex]
        if (!page) continue
        const requestedPixelPerPt = Math.max(0.1, request.pixelPerPt ?? 1)
        const maximumPixelPerPt = Math.min(
          MAX_CANVAS_DIMENSION / page.width,
          MAX_CANVAS_DIMENSION / page.height,
          Math.sqrt(MAX_CANVAS_PIXELS / (page.width * page.height)),
        )
        const pixelPerPt = Math.min(requestedPixelPerPt, maximumPixelPerPt)
        const pixelWidth = Math.max(1, Math.ceil(page.width * pixelPerPt))
        const pixelHeight = Math.max(1, Math.ceil(page.height * pixelPerPt))
        const canvas = new OffscreenCanvas(pixelWidth, pixelHeight)
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Offscreen canvas rendering is unavailable.')
        await session.renderCanvas({
          canvas: context as unknown as CanvasRenderingContext2D,
          pageOffset: page.pageOffset,
          pixelPerPt,
          backgroundColor: '#ffffff',
          dataSelection: { body: true, semantics: false },
        })
        const bitmap = canvas.transferToImageBitmap()
        pendingBitmaps.push(bitmap)
        images.push({
          pageIndex,
          pixelWidth,
          pixelHeight,
          bitmap,
        })
      }
      self.postMessage({
        type: 'result',
        mode: 'canvas',
        requestId: request.requestId,
        reset: request.updates.some((update) => update.kind === 'new'),
        images,
        pages,
        docWidth: session.docWidth,
        docHeight: session.docHeight,
        renderDurationMs: performance.now() - startedAt,
      }, { transfer: images.map(({ bitmap }) => bitmap) })
      pendingBitmaps.length = 0
      return
    }
    let renderWindow = request.window
    if (request.initialPageCount && pages.length) {
      const initialHeight = pages
        .slice(0, request.initialPageCount)
        .reduce((height, page) => height + page.height, 0)
      if (initialHeight > 0) {
        renderWindow = {
          lo: { x: 0, y: 0 },
          hi: { x: 1e20, y: initialHeight + 1 },
        }
      }
    }
    const patch = session.renderSvgDiff({ window: renderWindow })
    self.postMessage({
      type: 'result',
      mode: 'svg',
      requestId: request.requestId,
      reset: request.updates.some((update) => update.kind === 'new'),
      patch,
      pages,
      docWidth: session.docWidth,
      docHeight: session.docHeight,
      renderDurationMs: performance.now() - startedAt,
    })
  } catch (error) {
    for (const bitmap of pendingBitmaps) bitmap.close()
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
