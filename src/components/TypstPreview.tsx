import {
  memo,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
} from 'react'
import { patchRoot } from '@myriaddreamin/typst.ts/render/svg/patch'
import { reportError } from '../lib/logging'
import type {
  EditorDocument,
  PreviewPosition,
  PreviewRoot,
  SourceSyncStatus,
} from '../types'
import { PdfToolbar, type PdfZoom } from './PdfToolbar'

const CSS_PIXELS_PER_POINT = 96 / 72
const PAGE_GAP_POINTS = 10
const RENDER_BACKOFF_LIMIT_MS = 5_000
const RAPID_UPDATE_WINDOW_MS = 700
const MAX_WORKER_RECOVERY_ATTEMPTS = 3
const VIEWPORT_SETTLE_MS = 240
const VIEWPORT_OVERSCAN = 2
const PAINT_OVERSCAN = 0.1
const AUTO_SCROLL_GUARD_FRACTION = 0.15
const BLOCK_MARKER_HORIZONTAL_PADDING_PX = 14
const BLOCK_MARKER_VERTICAL_PADDING_PX = 5
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const pageLayoutSignatures = new WeakMap<SVGSVGElement, string>()

interface RenderPageInfo {
  pageOffset: number
  width: number
  height: number
}

interface RenderMetrics {
  pages: RenderPageInfo[]
  docWidth: number
  docHeight: number
}

interface PreviewPageLayout {
  element: SVGGElement
  intrinsicY: number
  x: number
  y: number
  width: number
  height: number
}

function tinymistBlockRect(elements: Element[], anchor: { x: number; y: number }) {
  const rows: Array<{
    top: number
    bottom: number
    left: number
    right: number
    elements: Set<Element>
  }> = []
  for (const element of elements) {
    const rect = element.getBoundingClientRect()
    const center = rect.top + rect.height / 2
    const row = rows.find((candidate) => Math.abs(candidate.top + (candidate.bottom - candidate.top) / 2 - center) < 2)
    if (row) {
      row.top = Math.min(row.top, rect.top)
      row.bottom = Math.max(row.bottom, rect.bottom)
      row.left = Math.min(row.left, rect.left)
      row.right = Math.max(row.right, rect.right)
      row.elements.add(element)
    } else {
      rows.push({
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        elements: new Set([element]),
      })
    }
  }
  rows.sort((left, right) => left.top - right.top || left.left - right.left)
  if (!rows.length) return
  const anchorRow = rows.reduce((closest, row, index) => {
    const verticalDistance = Math.abs(row.top + (row.bottom - row.top) / 2 - anchor.y)
    const horizontalDistance = anchor.x < row.left
      ? row.left - anchor.x
      : anchor.x > row.right ? anchor.x - row.right : 0
    const distance = verticalDistance * 4 + horizontalDistance
    return distance < closest.distance ? { index, distance } : closest
  }, { index: 0, distance: Number.POSITIVE_INFINITY }).index
  let first = anchorRow
  while (first > 0) {
    const previous = rows[first - 1]
    const current = rows[first]
    const lineHeight = Math.max(previous.bottom - previous.top, current.bottom - current.top)
    if (current.top - previous.bottom > lineHeight * 0.65) break
    first -= 1
  }
  let last = anchorRow
  while (last + 1 < rows.length) {
    const current = rows[last]
    const next = rows[last + 1]
    const lineHeight = Math.max(current.bottom - current.top, next.bottom - next.top)
    if (next.top - current.bottom > lineHeight * 0.65) break
    last += 1
  }
  const blockRows = rows.slice(first, last + 1)
  return {
    left: Math.min(...blockRows.map((row) => row.left)),
    top: Math.min(...blockRows.map((row) => row.top)),
    right: Math.max(...blockRows.map((row) => row.right)),
    bottom: Math.max(...blockRows.map((row) => row.bottom)),
  }
}

type RendererWorkerMessage = {
  type: 'ready'
} | {
  type: 'result'
  requestId: number
  reset: boolean
  patch: string
  pages: RenderPageInfo[]
  docWidth: number
  docHeight: number
  renderDurationMs: number
} | {
  type: 'error'
  requestId: number
  message: string
}

function splitPreviewPath(value: string) {
  const separator = value.lastIndexOf('/')
  return separator < 0
    ? { directory: '', fileName: value }
    : { directory: value.slice(0, separator), fileName: value.slice(separator + 1) }
}

function compactPreviewPath(value: string, maximumLength = 48) {
  if (value.length <= maximumLength) return value
  const { directory, fileName } = splitPreviewPath(value)
  if (!directory) return fileName
  const availableDirectoryLength = Math.max(0, maximumLength - fileName.length - 5)
  const visibleDirectory = directory.slice(0, availableDirectoryLength).replace(/\/+$/, '')
  return `${visibleDirectory ? `${visibleDirectory}/` : ''}.../${fileName}`
}

function findLastPageStartingBefore(pages: PreviewPageLayout[], y: number) {
  let low = 0
  let high = pages.length - 1
  let result = -1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (pages[middle].y <= y) {
      result = middle
      low = middle + 1
    } else high = middle - 1
  }
  return result
}

function findFirstPageEndingAfter(pages: PreviewPageLayout[], y: number) {
  let low = 0
  let high = pages.length - 1
  let result = pages.length
  while (low <= high) {
    const middle = (low + high) >> 1
    if (pages[middle].y + pages[middle].height >= y) {
      result = middle
      high = middle - 1
    } else low = middle + 1
  }
  return result
}

function decoratePages(svg: SVGSVGElement, createDecorations = true) {
  const pages = [...svg.querySelectorAll<SVGGElement>(':scope > g.typst-page')]
  const dimensions = pages.map((page) => ({
    element: page,
    width: Number(page.dataset.pageWidth),
    height: Number(page.dataset.pageHeight),
  })).filter(({ width, height }) => Number.isFinite(width) && Number.isFinite(height))
  if (!dimensions.length) return []
  const width = Math.max(...dimensions.map((page) => page.width))
  let y = 0
  let intrinsicY = 0
  const layouts = dimensions.map((page, index) => {
    if (index > 0) y += PAGE_GAP_POINTS
    const layout = {
      ...page,
      intrinsicY,
      x: (width - page.width) / 2,
      y,
    }
    y += page.height
    intrinsicY += page.height
    return layout
  })
  const signature = dimensions.map(({ width, height }) => `${width}:${height}`).join(';')
  if (pageLayoutSignatures.get(svg) === signature) return layouts
  pageLayoutSignatures.set(svg, signature)
  for (const element of svg.querySelectorAll(':scope > .tedit-page-decoration')) element.remove()
  const firstPage = layouts[0].element
  const clips = createDecorations
    ? window.document.createElementNS(SVG_NAMESPACE, 'defs')
    : undefined
  clips?.classList.add('tedit-page-decoration', 'tedit-page-clips')

  for (const [index, page] of layouts.entries()) {
    page.element.setAttribute('transform', `translate(${page.x}, ${page.y})`)
    page.element.dataset.pageNumber = String(index)
    page.element.dataset.x = String(page.x)
    page.element.dataset.y = String(page.y)
    page.element.setAttribute('clip-path', `url(#tedit-page-clip-${index})`)
    if (!createDecorations) continue
    const clipPath = window.document.createElementNS(SVG_NAMESPACE, 'clipPath')
    clipPath.id = `tedit-page-clip-${index}`
    const clipRect = window.document.createElementNS(SVG_NAMESPACE, 'rect')
    clipRect.setAttribute('width', String(page.width))
    clipRect.setAttribute('height', String(page.height))
    clipPath.append(clipRect)
    clips!.append(clipPath)
  }

  if (createDecorations) {
    const backgrounds = window.document.createElementNS(SVG_NAMESPACE, 'svg')
    backgrounds.classList.add('tedit-page-decoration', 'tedit-page-backgrounds')
    backgrounds.setAttribute('viewBox', `0 0 ${width} ${y}`)
    backgrounds.setAttribute('width', String(width))
    backgrounds.setAttribute('height', String(y))
    for (const [index, page] of layouts.entries()) {
      const background = window.document.createElementNS(SVG_NAMESPACE, 'rect')
      background.classList.add('tedit-page-background')
      background.dataset.pageNumber = String(index)
      background.setAttribute('x', String(page.x))
      background.setAttribute('y', String(page.y))
      background.setAttribute('width', String(page.width))
      background.setAttribute('height', String(page.height))
      backgrounds.append(background)
    }
    svg.insertBefore(backgrounds, firstPage)
    svg.insertBefore(clips!, firstPage)
  }

  svg.setAttribute('viewBox', `0 0 ${width} ${y}`)
  svg.setAttribute('data-width', String(width))
  svg.setAttribute('data-height', String(y))
  svg.setAttribute('width', String(Math.ceil(width)))
  svg.setAttribute('height', String(Math.ceil(y)))
  return layouts
}

function TypstPreviewContent({
  document,
  pdfFileName,
  previewRoots,
  onPreviewRootChange,
  positions,
  status,
  showPreviewPosition,
  autoScrollEnabled,
  renderBackoffMs,
  onPreviewPoint,
}: {
  document: EditorDocument
  pdfFileName: string
  previewRoots?: PreviewRoot[]
  onPreviewRootChange(filePath: string): void
  positions: PreviewPosition[]
  status: SourceSyncStatus
  showPreviewPosition: boolean
  autoScrollEnabled: boolean
  renderBackoffMs: number
  onPreviewPoint(position: PreviewPosition): void
}) {
  const normalizedRenderBackoffMs = Number.isFinite(renderBackoffMs)
    ? Math.max(0, Math.min(RENDER_BACKOFF_LIMIT_MS, Math.round(renderBackoffMs)))
    : 180
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState<PdfZoom>('width')
  const [renderedVersion, setRenderedVersion] = useState(0)
  const [workerGeneration, setWorkerGeneration] = useState(0)
  const [partialRenderingDisabled, setPartialRenderingDisabled] = useState(false)
  const [previewError, setPreviewError] = useState<string>()
  const [printError, setPrintError] = useState<string>()
  const [printing, setPrinting] = useState(false)
  const zoomRef = useRef<PdfZoom>(zoom)
  const viewportRef = useRef<HTMLDivElement>(null)
  const documentRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLDivElement>(null)
  const workerRef = useRef<Worker | undefined>(undefined)
  const workerReadyRef = useRef(false)
  const renderMetricsRef = useRef<RenderMetrics | undefined>(undefined)
  const renderRequestIdRef = useRef(0)
  const appliedRequestIdRef = useRef(0)
  const updatesRef = useRef<Array<{ kind: 'new' | 'diff-v1'; data: Uint8Array }>>([])
  const processingRef = useRef(false)
  const activeRenderKindRef = useRef<'document' | 'viewport' | undefined>(undefined)
  const updateTimerRef = useRef<number | undefined>(undefined)
  const updateIdleRef = useRef<number | undefined>(undefined)
  const scrollFrameRef = useRef<number | undefined>(undefined)
  const viewportTimerRef = useRef<number | undefined>(undefined)
  const viewportRenderPendingRef = useRef(false)
  const activeRenderWindowKeyRef = useRef<string | undefined>(undefined)
  const lastRenderedWindowKeyRef = useRef<string | undefined>(undefined)
  const refreshOnWorkerStartRef = useRef(false)
  const awaitingFreshSnapshotRef = useRef(false)
  const lastDocumentUpdateAtRef = useRef(0)
  const renderBackoffBaseRef = useRef(normalizedRenderBackoffMs)
  const renderBackoffRef = useRef(normalizedRenderBackoffMs)
  const workerRecoveryAttemptsRef = useRef(0)
  const workerRecoveryTimerRef = useRef<number | undefined>(undefined)
  const pageLayoutsRef = useRef<PreviewPageLayout[]>([])
  const pageBackgroundsRef = useRef<SVGRectElement[]>([])
  const paintedPageRangeRef = useRef<{ first: number; last: number } | undefined>(undefined)
  const semanticElementsRef = useRef(new WeakMap<SVGGElement, Element[]>())
  const previewSelectionActiveRef = useRef(false)
  const partialRenderingDisabledRef = useRef(partialRenderingDisabled)
  const statusError = status.documentId === document.id && status.state === 'error' ? status.message : undefined
  const effectivePreviewError = previewError ?? statusError
  const visiblePreviewError = printError ?? statusError
  zoomRef.current = zoom
  partialRenderingDisabledRef.current = partialRenderingDisabled
  if (renderBackoffBaseRef.current !== normalizedRenderBackoffMs) {
    renderBackoffBaseRef.current = normalizedRenderBackoffMs
    renderBackoffRef.current = normalizedRenderBackoffMs
  }

  const applyScaleToSvg = (svg: SVGSVGElement, metrics: RenderMetrics) => {
    const viewport = viewportRef.current
    if (!viewport || !metrics.pages.length) return
    const firstPage = metrics.pages[0]
    const availableWidth = Math.max(100, viewport.clientWidth - 20)
    const availableHeight = Math.max(100, viewport.clientHeight - 20)
    const documentWidth = Number(svg.dataset.width) || metrics.docWidth
    const documentHeight = Number(svg.dataset.height) || metrics.docHeight
    const baseWidth = documentWidth * CSS_PIXELS_PER_POINT
    const baseHeight = documentHeight * CSS_PIXELS_PER_POINT
    let scale = availableWidth / baseWidth
    const currentZoom = zoomRef.current
    if (currentZoom === 'page' && firstPage) {
      scale = Math.min(
        availableWidth / (firstPage.width * CSS_PIXELS_PER_POINT),
        availableHeight / (firstPage.height * CSS_PIXELS_PER_POINT),
      )
    } else if (typeof currentZoom === 'number') {
      scale = currentZoom / 100
    }
    svg.style.width = `${Math.max(1, baseWidth * scale)}px`
    svg.style.height = `${Math.max(1, baseHeight * scale)}px`
  }

  const applyScale = () => {
    const metrics = renderMetricsRef.current
    const svg = documentRef.current?.firstElementChild as SVGSVGElement | null
    if (metrics && svg) applyScaleToSvg(svg, metrics)
  }

  const getRenderWindow = () => {
    const viewport = viewportRef.current
    const svg = documentRef.current?.firstElementChild as SVGSVGElement | null
    const pages = pageLayoutsRef.current
    const fullWindow = {
      bounds: { lo: { x: 0, y: 0 }, hi: { x: 1e20, y: 1e20 } },
      key: 'all',
    }
    if (
      partialRenderingDisabledRef.current
      || !viewport
      || !svg
      || !pages.length
      || !appliedRequestIdRef.current
    ) {
      return fullWindow
    }
    const svgRect = svg.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    const documentHeight = Number(svg.dataset.height)
    const scale = documentHeight > 0 ? svgRect.height / documentHeight : 0
    if (!scale) return fullWindow

    const viewportHeight = viewportRect.height / scale
    const visibleTop = (viewportRect.top - svgRect.top) / scale
    const top = visibleTop - viewportHeight * VIEWPORT_OVERSCAN
    const bottom = visibleTop + viewportHeight * (VIEWPORT_OVERSCAN + 1)
    const firstPageIndex = findFirstPageEndingAfter(pages, top)
    const lastPageIndex = findLastPageStartingBefore(pages, bottom)
    if (firstPageIndex >= pages.length || lastPageIndex < firstPageIndex) return fullWindow
    const firstPage = pages[firstPageIndex]
    const lastPage = pages[lastPageIndex]
    return {
      bounds: {
        lo: { x: 0, y: Math.max(0, firstPage.intrinsicY - 1) },
        hi: { x: 1e20, y: lastPage.intrinsicY + lastPage.height + 1 },
      },
      key: `${firstPageIndex}:${lastPageIndex}`,
    }
  }

  const hasPreviewSelection = () => {
    const selection = window.getSelection()
    const preview = documentRef.current
    if (!preview || !selection || selection.isCollapsed) return false
    if (preview.contains(selection.anchorNode) || preview.contains(selection.focusNode)) return true
    for (let index = 0; index < selection.rangeCount; index += 1) {
      if (selection.getRangeAt(index).intersectsNode(preview)) return true
    }
    return false
  }

  const updatePageVisibility = (force = false, preserveAllPages = hasPreviewSelection()) => {
    const viewport = viewportRef.current
    const svg = documentRef.current?.firstElementChild as SVGSVGElement | null
    const pages = pageLayoutsRef.current
    if (!viewport || !svg || !pages.length) return
    const svgRect = svg.getBoundingClientRect()
    const viewportRect = viewport.getBoundingClientRect()
    const documentHeight = Number(svg.dataset.height)
    const scale = documentHeight > 0 ? svgRect.height / documentHeight : 0
    if (!scale) return
    let first = 0
    let last = pages.length - 1
    if (!preserveAllPages) {
      const viewportHeight = viewportRect.height / scale
      const visibleTop = (viewportRect.top - svgRect.top) / scale
      first = Math.max(0, findFirstPageEndingAfter(pages, visibleTop - viewportHeight * PAINT_OVERSCAN))
      last = Math.min(
        pages.length - 1,
        findLastPageStartingBefore(pages, visibleTop + viewportHeight * (PAINT_OVERSCAN + 1)),
      )
      if (first > last) {
        first = 0
        last = pages.length - 1
      }
    }
    const current = paintedPageRangeRef.current
    if (force || !current) {
      for (const [index, page] of pages.entries()) {
        const hidden = index < first || index > last
        page.element.classList.toggle('tedit-page-hidden', hidden)
        pageBackgroundsRef.current[index]?.classList.toggle('tedit-page-hidden', hidden)
      }
    } else if (current.first !== first || current.last !== last) {
      for (let index = current.first; index <= current.last; index += 1) {
        if (index >= first && index <= last) continue
        pages[index]?.element.classList.add('tedit-page-hidden')
        pageBackgroundsRef.current[index]?.classList.add('tedit-page-hidden')
      }
      for (let index = first; index <= last; index += 1) {
        if (index >= current.first && index <= current.last) continue
        pages[index]?.element.classList.remove('tedit-page-hidden')
        pageBackgroundsRef.current[index]?.classList.remove('tedit-page-hidden')
      }
    }
    paintedPageRangeRef.current = { first, last }
    return { svgRect, viewportRect, documentHeight }
  }

  const renderViewport = () => {
    if (!workerReadyRef.current || !workerRef.current) return
    if (processingRef.current || updatesRef.current.length) {
      viewportRenderPendingRef.current = true
      return
    }
    const renderWindow = getRenderWindow()
    if (renderWindow.key === lastRenderedWindowKeyRef.current) {
      viewportRenderPendingRef.current = false
      return
    }
    viewportRenderPendingRef.current = false
    processingRef.current = true
    activeRenderKindRef.current = 'viewport'
    activeRenderWindowKeyRef.current = renderWindow.key
    workerRef.current.postMessage({
      type: 'render',
      requestId: ++renderRequestIdRef.current,
      updates: [],
      window: renderWindow.bounds,
    })
  }

  const scheduleViewportRender = () => {
    window.clearTimeout(viewportTimerRef.current)
    viewportTimerRef.current = window.setTimeout(() => {
      viewportTimerRef.current = undefined
      renderViewport()
    }, VIEWPORT_SETTLE_MS)
  }

  const noteDocumentUpdate = () => {
    const now = performance.now()
    const elapsed = now - lastDocumentUpdateAtRef.current
    const baseBackoff = renderBackoffBaseRef.current
    const maximumBackoff = Math.min(
      RENDER_BACKOFF_LIMIT_MS,
      Math.max(baseBackoff, Math.ceil(baseBackoff * 5.5)),
    )
    renderBackoffRef.current = elapsed < Math.max(RAPID_UPDATE_WINDOW_MS, baseBackoff)
      ? Math.min(maximumBackoff, Math.ceil(renderBackoffRef.current * 1.6))
      : baseBackoff
    lastDocumentUpdateAtRef.current = now
    return renderBackoffRef.current
  }

  const recoverWorker = () => {
    workerRef.current?.terminate()
    workerRef.current = undefined
    workerReadyRef.current = false
    processingRef.current = false
    activeRenderKindRef.current = undefined
    activeRenderWindowKeyRef.current = undefined
    lastRenderedWindowKeyRef.current = undefined
    updatesRef.current = []
    viewportRenderPendingRef.current = false
    if (workerRecoveryAttemptsRef.current >= MAX_WORKER_RECOVERY_ATTEMPTS) return
    const delay = Math.min(
      RENDER_BACKOFF_LIMIT_MS,
      Math.max(50, renderBackoffBaseRef.current) * (2 ** workerRecoveryAttemptsRef.current),
    )
    workerRecoveryAttemptsRef.current += 1
    refreshOnWorkerStartRef.current = true
    window.clearTimeout(workerRecoveryTimerRef.current)
    workerRecoveryTimerRef.current = window.setTimeout(() => {
      workerRecoveryTimerRef.current = undefined
      setWorkerGeneration((current) => current + 1)
    }, delay)
  }

  const processUpdates = (delay = renderBackoffRef.current) => {
    if (processingRef.current || !workerReadyRef.current || !workerRef.current || !updatesRef.current.length) return
    window.clearTimeout(updateTimerRef.current)
    if (updateIdleRef.current !== undefined) window.cancelIdleCallback(updateIdleRef.current)
    updateTimerRef.current = window.setTimeout(() => {
      updateTimerRef.current = undefined
      const renderUpdates = () => {
        updateIdleRef.current = undefined
        processingRef.current = true
        activeRenderKindRef.current = 'document'
        const updates = updatesRef.current.splice(0)
        let latestNew = -1
        for (let index = updates.length - 1; index >= 0; index -= 1) {
          if (updates[index].kind === 'new') {
            latestNew = index
            break
          }
        }
        const applicableUpdates = latestNew >= 0 ? updates.slice(latestNew) : updates
        const requestId = ++renderRequestIdRef.current
        const renderWindow = getRenderWindow()
        activeRenderWindowKeyRef.current = renderWindow.key
        workerRef.current?.postMessage({
          type: 'render',
          requestId,
          updates: applicableUpdates,
          window: renderWindow.bounds,
        }, applicableUpdates.map((update) => update.data.buffer as ArrayBuffer))
      }
      if (!delay) renderUpdates()
      else updateIdleRef.current = window.requestIdleCallback(renderUpdates, {
        timeout: Math.max(50, renderBackoffBaseRef.current),
      })
    }, delay)
  }

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!desktop) {
      setPreviewError('The live preview requires the tedit desktop app.')
      return
    }
    const worker = new Worker(new URL('../workers/typstRenderer.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<RendererWorkerMessage>) => {
      if (workerRef.current !== worker) return
      const message = event.data
      if (message.type === 'ready') {
        workerReadyRef.current = true
        processUpdates(
          appliedRequestIdRef.current || awaitingFreshSnapshotRef.current
            ? renderBackoffRef.current
            : 0,
        )
        return
      }
      if (message.type === 'error') {
        processingRef.current = false
        reportError('typst-preview-render', new Error(message.message))
        setPreviewError(message.message)
        updatesRef.current = []
        viewportRenderPendingRef.current = false
        recoverWorker()
        return
      }
      if (message.requestId < appliedRequestIdRef.current) {
        processingRef.current = false
        activeRenderKindRef.current = undefined
        activeRenderWindowKeyRef.current = undefined
        return
      }
      try {
        const patchStartedAt = performance.now()
        const container = documentRef.current
        if (!container) return
        const parsed = window.document.createElement('div')
        parsed.innerHTML = message.patch
        const nextSvg = parsed.firstElementChild as SVGSVGElement | null
        const currentSvg = container.firstElementChild as SVGSVGElement | null
        if (!nextSvg) throw new Error('Tinymist produced an empty SVG preview.')
        const metrics = { pages: message.pages, docWidth: message.docWidth, docHeight: message.docHeight }
        renderMetricsRef.current = metrics
        let pageLayouts: PreviewPageLayout[]
        if (message.reset || !currentSvg) {
          pageLayouts = decoratePages(nextSvg)
          applyScaleToSvg(nextSvg, metrics)
          container.replaceChildren(nextSvg)
        } else {
          decoratePages(nextSvg, false)
          applyScaleToSvg(nextSvg, metrics)
          patchRoot(currentSvg, nextSvg)
          pageLayouts = decoratePages(currentSvg)
        }
        pageLayoutsRef.current = pageLayouts
        semanticElementsRef.current = new WeakMap()
        pageBackgroundsRef.current = [...container.querySelectorAll<SVGRectElement>(
          ':scope > svg > svg.tedit-page-backgrounds > rect.tedit-page-background',
        )]
        updatePageVisibility(true)
        appliedRequestIdRef.current = message.requestId
        lastRenderedWindowKeyRef.current = activeRenderWindowKeyRef.current
        workerRecoveryAttemptsRef.current = 0
        awaitingFreshSnapshotRef.current = false
        if (message.reset) setPartialRenderingDisabled(false)
        if (
          performance.now() - lastDocumentUpdateAtRef.current
          > Math.max(RAPID_UPDATE_WINDOW_MS, renderBackoffBaseRef.current)
        ) {
          renderBackoffRef.current = renderBackoffBaseRef.current
        }
        setPageCount(message.pages.length)
        setPageNumber((current) => Math.max(1, Math.min(current, message.pages.length || 1)))
        setPreviewError(undefined)
        setRenderedVersion((current) => current + 1)
        const patchDurationMs = performance.now() - patchStartedAt
        if (import.meta.env.DEV && message.renderDurationMs + patchDurationMs > 16) {
          console.debug('Typst preview update', {
            renderMs: Math.round(message.renderDurationMs),
            patchMs: Math.round(patchDurationMs),
            patchBytes: message.patch.length,
          })
        }
      } catch (error) {
        reportError('typst-preview-patch', error)
        setPreviewError(error instanceof Error ? error.message : String(error))
        setPartialRenderingDisabled(true)
        recoverWorker()
      } finally {
        processingRef.current = false
        activeRenderKindRef.current = undefined
        activeRenderWindowKeyRef.current = undefined
        if (updatesRef.current.length) processUpdates()
        else if (viewportRenderPendingRef.current) renderViewport()
      }
    }
    worker.onerror = (event) => {
      if (workerRef.current !== worker) return
      processingRef.current = false
      activeRenderKindRef.current = undefined
      const message = event.message || 'The Typst renderer worker stopped unexpectedly.'
      reportError('typst-preview-worker', new Error(message))
      setPreviewError(message)
      recoverWorker()
    }
    const removeUpdateListener = desktop.onPreviewUpdate((update) => {
      if (update.documentId !== document.id) return
      const delay = noteDocumentUpdate()
      if (update.kind === 'new') updatesRef.current = []
      updatesRef.current.push({ kind: update.kind, data: update.data })
      const initialSnapshot = update.kind === 'new'
        && !appliedRequestIdRef.current
        && !awaitingFreshSnapshotRef.current
      processUpdates(initialSnapshot ? 0 : delay)
    })
    if (refreshOnWorkerStartRef.current) {
      refreshOnWorkerStartRef.current = false
      desktop.refreshSourceSync({ documentId: document.id })
    }
    return () => {
      removeUpdateListener()
      worker.terminate()
      workerRef.current = undefined
      workerReadyRef.current = false
      renderMetricsRef.current = undefined
      processingRef.current = false
      activeRenderKindRef.current = undefined
      activeRenderWindowKeyRef.current = undefined
      updatesRef.current = []
      pageLayoutsRef.current = []
      pageBackgroundsRef.current = []
      paintedPageRangeRef.current = undefined
      semanticElementsRef.current = new WeakMap()
      lastRenderedWindowKeyRef.current = undefined
      window.clearTimeout(updateTimerRef.current)
      updateTimerRef.current = undefined
      if (updateIdleRef.current !== undefined) window.cancelIdleCallback(updateIdleRef.current)
      updateIdleRef.current = undefined
      if (scrollFrameRef.current !== undefined) cancelAnimationFrame(scrollFrameRef.current)
      scrollFrameRef.current = undefined
      window.clearTimeout(viewportTimerRef.current)
      viewportTimerRef.current = undefined
      viewportRenderPendingRef.current = false
      window.clearTimeout(workerRecoveryTimerRef.current)
      workerRecoveryTimerRef.current = undefined
    }
  }, [document.id, workerGeneration])

  useEffect(() => {
    applyScale()
    updatePageVisibility(true)
    scheduleViewportRender()
  }, [zoom, pageCount])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(() => {
      applyScale()
      updatePageVisibility(true)
      scheduleViewportRender()
    })
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [pageCount, zoom])

  useEffect(() => {
    const preview = documentRef.current
    if (!preview) return
    const prepareSelection = () => {
      previewSelectionActiveRef.current = true
      updatePageVisibility(true, true)
    }
    const updateForSelection = () => {
      const active = hasPreviewSelection()
      if (active === previewSelectionActiveRef.current) return
      previewSelectionActiveRef.current = active
      updatePageVisibility(true, active)
    }
    preview.addEventListener('selectstart', prepareSelection)
    window.document.addEventListener('selectionchange', updateForSelection)
    return () => {
      preview.removeEventListener('selectstart', prepareSelection)
      window.document.removeEventListener('selectionchange', updateForSelection)
    }
  }, [])

  const pageLayouts = () => pageLayoutsRef.current
  const previewPoint = (position: PreviewPosition) => {
    const svg = documentRef.current?.firstElementChild as SVGSVGElement | null
    const page = pageLayoutsRef.current[position.page - 1]
    if (!svg || !page) return
    const svgRect = svg.getBoundingClientRect()
    const documentWidth = Number(svg.dataset.width)
    const documentHeight = Number(svg.dataset.height)
    if (!documentWidth || !documentHeight || !svgRect.width || !svgRect.height) return
    return {
      x: svgRect.left + (page.x + position.x) * (svgRect.width / documentWidth),
      y: svgRect.top + (page.y + position.y) * (svgRect.height / documentHeight),
    }
  }

  const previewBlockRect = (position: PreviewPosition) => {
    const anchor = previewPoint(position)
    const page = pageLayoutsRef.current[position.page - 1]
    if (!anchor || !page) return
    let elements = semanticElementsRef.current.get(page.element)
    if (!elements) {
      elements = [...page.element.querySelectorAll('.tsel')]
      semanticElementsRef.current.set(page.element, elements)
    }
    return tinymistBlockRect(elements, anchor)
  }

  const changePage = (page: number, behavior: ScrollBehavior = 'smooth') => {
    const nextPage = Math.max(1, Math.min(pageCount || 1, page || 1))
    const target = pageLayouts()[nextPage - 1]?.element
    const viewport = viewportRef.current
    if (target && viewport) {
      const targetRect = target.getBoundingClientRect()
      const viewportRect = viewport.getBoundingClientRect()
      viewport.scrollTo({ top: viewport.scrollTop + targetRect.top - viewportRect.top - 6, behavior })
    }
    setPageNumber(nextPage)
  }

  useEffect(() => {
    const marker = markerRef.current
    const pages = pageLayouts()
    if (!marker || !positions.length || !pages.length) {
      marker?.classList.remove('visible')
      return
    }
    const position = positions.reduce((closest, candidate) => (
      Math.abs(candidate.page - pageNumber) <= Math.abs(closest.page - pageNumber) ? candidate : closest
    ))
    const block = previewBlockRect(position)
    const markerParent = marker.offsetParent as HTMLElement | null
    if (!block || !markerParent) {
      marker.classList.remove('visible')
      return
    }
    const parentRect = markerParent.getBoundingClientRect()
    marker.style.left = `${block.left - parentRect.left - BLOCK_MARKER_HORIZONTAL_PADDING_PX}px`
    marker.style.top = `${block.top - parentRect.top - BLOCK_MARKER_VERTICAL_PADDING_PX}px`
    marker.style.width = `${block.right - block.left + BLOCK_MARKER_HORIZONTAL_PADDING_PX * 2}px`
    marker.style.height = `${block.bottom - block.top + BLOCK_MARKER_VERTICAL_PADDING_PX * 2}px`
    marker.classList.toggle('visible', showPreviewPosition)
  }, [positions, renderedVersion, pageNumber, zoom, showPreviewPosition])

  useEffect(() => {
    const viewport = viewportRef.current
    const pages = pageLayouts()
    if (
      !autoScrollEnabled
      || !viewport
      || !positions.length
      || !pages.length
    ) return
    const position = positions.reduce((closest, candidate) => (
      Math.abs(candidate.page - pageNumber) <= Math.abs(closest.page - pageNumber) ? candidate : closest
    ))
    const point = previewPoint(position)
    if (!point) return
    const viewportRect = viewport.getBoundingClientRect()
    const targetY = point.y
    const guardTop = viewportRect.top + viewportRect.height * AUTO_SCROLL_GUARD_FRACTION
    const guardBottom = viewportRect.bottom - viewportRect.height * AUTO_SCROLL_GUARD_FRACTION
    if (targetY < guardTop) {
      viewport.scrollTop = Math.max(
        0,
        viewport.scrollTop + targetY - guardTop,
      )
    } else if (targetY > guardBottom) {
      viewport.scrollTop += targetY - guardBottom
    }
  }, [positions, autoScrollEnabled])

  const trackVisiblePage = () => {
    if (scrollFrameRef.current !== undefined) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = undefined
      const pages = pageLayouts()
      if (!pages.length) return
      const geometry = updatePageVisibility()
      if (!geometry) return
      const { svgRect, viewportRect, documentHeight } = geometry
      if (!svgRect.height || !documentHeight) return
      const marker = viewportRect.top + Math.min(80, viewportRect.height * 0.25)
      const markerY = ((marker - svgRect.top) / svgRect.height) * documentHeight
      const visiblePage = Math.max(1, findLastPageStartingBefore(pages, markerY) + 1)
      setPageNumber((current) => current === visiblePage ? current : visiblePage)
      scheduleViewportRender()
    })
  }

  const revealSource = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element
    const pages = pageLayouts()
    const svg = documentRef.current?.firstElementChild as SVGSVGElement | null
    if (!svg || !pages.length) return
    const clickedPage = target.closest<SVGGElement>('g.typst-page')
    let pageIndex = clickedPage ? pages.findIndex((page) => page.element === clickedPage) : -1
    const svgRect = svg.getBoundingClientRect()
    const documentHeight = Number(svg.dataset.height)
    const scale = documentHeight > 0 ? svgRect.height / documentHeight : 0
    if (!scale) return
    if (pageIndex < 0) {
      const documentY = (event.clientY - svgRect.top) / scale
      const candidate = findLastPageStartingBefore(pages, documentY)
      const page = pages[candidate]
      const documentX = (event.clientX - svgRect.left) / scale
      if (
        page
        && documentX >= page.x
        && documentX <= page.x + page.width
        && documentY <= page.y + page.height
      ) pageIndex = candidate
    }
    const page = pages[pageIndex]
    if (!page) return
    const pageLeft = svgRect.left + page.x * scale
    const pageTop = svgRect.top + page.y * scale
    const pageWidth = page.width * scale
    const pageHeight = page.height * scale
    if (!pageWidth || !pageHeight) return
    const xRatio = Math.max(0, Math.min(1, (event.clientX - pageLeft) / pageWidth))
    const yRatio = Math.max(0, Math.min(1, (event.clientY - pageTop) / pageHeight))
    onPreviewPoint({
      page: pageIndex + 1,
      x: xRatio * page.width,
      y: yRatio * page.height,
    })
  }

  const printPdf = async () => {
    const desktop = window.typstDesktop
    if (!desktop || !document.pdfUrl || printing) return
    setPrinting(true)
    setPrintError(undefined)
    try {
      const response = await fetch(document.pdfUrl)
      if (!response.ok) throw new Error(`Could not read the generated PDF (${response.status}).`)
      const result = await desktop.printPdf(new Uint8Array(await response.arrayBuffer()))
      if (!result.success && result.failureReason && !/cancel/i.test(result.failureReason)) {
        throw new Error(result.failureReason)
      }
    } catch (error) {
      reportError('pdf-print', error)
      setPrintError(error instanceof Error ? error.message : String(error))
    } finally {
      setPrinting(false)
    }
  }

  return (
    <section className="preview-panel" aria-label="Typst preview">
      <div className="panel-heading preview-heading">
        <span className="preview-title">
          <span className="preview-label">Typst Preview</span>
          {previewRoots?.length === 1 && (
            <span className="preview-root-name" title={previewRoots[0].filePath}>
              <span className="preview-root-filename">{splitPreviewPath(previewRoots[0].relativePath).fileName}</span>
            </span>
          )}
          {previewRoots && previewRoots.length > 1 && document.filePath && (
            <select
              className="preview-root-select"
              aria-label="Document to preview"
              value={document.previewRootPath ?? document.filePath}
              onChange={(event) => onPreviewRootChange(event.target.value)}
            >
              {previewRoots.map((root) => (
                <option key={root.filePath} value={root.filePath}>
                  {compactPreviewPath(root.relativePath)}{root.filePath === document.filePath ? ' (current)' : ''}
                </option>
              ))}
            </select>
          )}
        </span>
        <PdfToolbar
          page={pageNumber}
          pageCount={pageCount}
          zoom={zoom}
          pdfUrl={document.pdfUrl}
          previewReady={pageCount > 0}
          rotationEnabled={false}
          fileName={pdfFileName}
          printing={printing}
          onPageChange={changePage}
          onZoomChange={setZoom}
          onRotate={() => undefined}
          onPrint={printPdf}
        />
      </div>
      <div
        className="preview-surface typst-preview-viewport"
        ref={viewportRef}
        onScroll={trackVisiblePage}
      >
        {pageCount > 0 && visiblePreviewError && (
          <div className="preview-error" role="alert">{visiblePreviewError}</div>
        )}
        <div className="typst-preview-content">
          <div className="typst-preview-document" ref={documentRef} onClick={revealSource} />
          <div className="typst-block-marker" ref={markerRef} aria-hidden="true" />
        </div>
        {!pageCount && (
          <div className="preview-empty">
            <div className={`loader ${effectivePreviewError ? 'loader-error' : ''}`} />
            <strong>{effectivePreviewError ? 'Preview unavailable' : 'Starting Tinymist preview'}</strong>
            <span>{effectivePreviewError ?? 'The first preview may take a moment.'}</span>
          </div>
        )}
      </div>
    </section>
  )
}

const MemoizedTypstPreview = memo(TypstPreviewContent, (previous, next) => (
  previous.document.id === next.document.id
  && previous.document.filePath === next.document.filePath
  && previous.document.previewRootPath === next.document.previewRootPath
  && previous.document.pdfUrl === next.document.pdfUrl
  && previous.pdfFileName === next.pdfFileName
  && previous.previewRoots === next.previewRoots
  && previous.positions === next.positions
  && previous.status === next.status
  && previous.showPreviewPosition === next.showPreviewPosition
  && previous.autoScrollEnabled === next.autoScrollEnabled
  && previous.renderBackoffMs === next.renderBackoffMs
  && previous.onPreviewRootChange === next.onPreviewRootChange
  && previous.onPreviewPoint === next.onPreviewPoint
))

export function TypstPreview(props: ComponentProps<typeof TypstPreviewContent>) {
  return <MemoizedTypstPreview {...props} />
}
