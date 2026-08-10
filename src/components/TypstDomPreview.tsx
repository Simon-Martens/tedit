import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createTypstRenderer } from '@myriaddreamin/typst.ts/renderer'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/wasm?url'
import type { EditorDocument, PreviewPosition, PreviewRoot, SourceSyncStatus } from '../types'
import { reportError } from '../lib/logging'
import { PdfToolbar, type PdfZoom } from './PdfToolbar'

const CSS_PIXELS_PER_POINT = 96 / 72
const MAX_DOM_CANVAS_DIMENSION = 8192
const MAX_DOM_CANVAS_PIXELS = 32_000_000
let domRenderer = createTypstRenderer()
let rendererInitialization: Promise<void> | undefined

function initializeRenderer() {
  rendererInitialization ??= domRenderer.init({ getModule: () => rendererWasmUrl }).catch((error) => {
    rendererInitialization = undefined
    domRenderer = createTypstRenderer()
    throw error
  })
  return rendererInitialization
}

type DomDocument = Awaited<ReturnType<typeof domRenderer.renderDom>>

interface DomRendererInternals {
  processQueue(update: [string, string]): boolean
  doRender$dom(context: unknown): Promise<void>
  moduleInitialized: boolean
  current_task?: { cancel(): Promise<void> }
  isRendering: boolean
  patchQueue: Array<[string, string]>
  vpTimeout?: number
  r: { rerender(): Promise<void> }
  docKernel: {
    relayout(x: number, y: number, width: number, height: number): unknown
    repaint(page: number, x: number, y: number, width: number, height: number, stage: number): unknown
  }
}

export function TypstDomPreview({
  document,
  pdfFileName,
  previewRoots,
  onPreviewRootChange,
  positions,
  status,
  showPreviewPosition,
  previewClickNavigationEnabled,
  autoScrollEnabled,
  onPreviewPoint,
}: {
  document: EditorDocument
  pdfFileName: string
  previewRoots?: PreviewRoot[]
  onPreviewRootChange(filePath: string): void
  positions: PreviewPosition[]
  status: SourceSyncStatus
  showPreviewPosition: boolean
  previewClickNavigationEnabled: boolean
  autoScrollEnabled: boolean
  onPreviewPoint(position: PreviewPosition): void
}) {
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState<PdfZoom>('width')
  const [previewError, setPreviewError] = useState<string>()
  const [printError, setPrintError] = useState<string>()
  const [printing, setPrinting] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const documentRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLDivElement>(null)
  const domDocumentRef = useRef<DomDocument | undefined>(undefined)
  const domScaleRef = useRef(1)
  const zoomRef = useRef(zoom)
  const pageNumberRef = useRef(pageNumber)
  const positionsRef = useRef(positions)
  const showPositionRef = useRef(showPreviewPosition)
  const autoScrollRef = useRef(autoScrollEnabled)
  const autoScrollPendingRef = useRef(true)
  const scrollFrameRef = useRef<number | undefined>(undefined)
  zoomRef.current = zoom
  pageNumberRef.current = pageNumber
  positionsRef.current = positions
  showPositionRef.current = showPreviewPosition
  autoScrollRef.current = autoScrollEnabled

  const pages = () => [...(documentRef.current?.querySelectorAll<HTMLElement>('.typst-dom-page') ?? [])]

  const applyScale = (notifyViewport = true) => {
    const viewport = viewportRef.current
    const container = documentRef.current
    const domDocument = domDocumentRef.current
    const renderedPages = pages()
    if (!viewport || !container || !renderedPages.length) return
    const widths = renderedPages.map((page) => Number(page.dataset.width)).filter(Number.isFinite)
    const firstWidth = Number(renderedPages[0].dataset.width)
    const firstHeight = Number(renderedPages[0].dataset.height)
    if (!widths.length || !firstWidth || !firstHeight) return
    const availableWidth = Math.max(100, viewport.clientWidth - 20)
    const availableHeight = Math.max(100, viewport.clientHeight - 20)
    const selectedZoom = zoomRef.current
    let scale = availableWidth / Math.max(...widths)
    if (selectedZoom === 'page') {
      scale = Math.min(availableWidth / firstWidth, availableHeight / firstHeight)
    } else if (typeof selectedZoom === 'number') {
      scale = CSS_PIXELS_PER_POINT * selectedZoom / 100
    }
    const scaleChanged = Math.abs(domScaleRef.current - scale) > 0.001
    if (scaleChanged) {
      domScaleRef.current = scale
      container.style.setProperty('--typst-dom-scale', String(scale))
    }
    if (domDocument) {
      ;(domDocument.impl as typeof domDocument.impl & { domScale: number }).domScale = scale
      if (scaleChanged || notifyViewport) domDocument.addViewportChange()
    }
  }

  const updateMarker = (scrollIntoView = false) => {
    const viewport = viewportRef.current
    const marker = markerRef.current
    const renderedPages = pages()
    if (!viewport || !marker || !renderedPages.length || !positionsRef.current.length) {
      if (marker) marker.hidden = true
      return
    }
    const position = positionsRef.current.reduce((closest, candidate) => (
      Math.abs(candidate.page - pageNumberRef.current) < Math.abs(closest.page - pageNumberRef.current)
        ? candidate
        : closest
    ))
    const page = renderedPages[position.page - 1]
    const width = Number(page?.dataset.width)
    const height = Number(page?.dataset.height)
    if (!page || !width || !height) {
      marker.hidden = true
      return
    }
    const pageRect = page.getBoundingClientRect()
    const pageStyle = getComputedStyle(page)
    const localX = position.x * domScaleRef.current
    const localY = position.y * domScaleRef.current
    const anchorX = pageRect.left + Number.parseFloat(pageStyle.borderLeftWidth) + localX
    const anchorY = pageRect.top + Number.parseFloat(pageStyle.borderTopWidth) + localY
    if (marker.parentElement !== page) page.append(marker)
    marker.style.setProperty('--marker-x', `${localX}px`)
    marker.style.setProperty('--marker-y', `${localY}px`)
    marker.hidden = !showPositionRef.current
    if (!scrollIntoView || !autoScrollRef.current || !autoScrollPendingRef.current) return
    autoScrollPendingRef.current = false
    const targetY = anchorY
    const viewportRect = viewport.getBoundingClientRect()
    const guardTop = viewportRect.top + viewportRect.height * 0.2
    const guardBottom = viewportRect.bottom - viewportRect.height * 0.2
    if (targetY < guardTop) viewport.scrollTop += targetY - guardTop
    else if (targetY > guardBottom) viewport.scrollTop += targetY - guardBottom
  }

  useEffect(() => {
    const browserWindow = window as Window & {
      typstBindSemantics?: (...arguments_: unknown[]) => void
      typstBindSvgDom?: (...arguments_: unknown[]) => void
    }
    browserWindow.typstBindSemantics ??= () => undefined
    browserWindow.typstBindSvgDom ??= () => undefined
    const desktop = window.typstDesktop
    const container = documentRef.current
    const viewport = viewportRef.current
    if (!desktop || !container || !viewport) {
      setPreviewError('The paged DOM preview requires the tedit desktop app.')
      return
    }
    const marker = window.document.createElement('div')
    marker.className = 'pdf-location-marker visible'
    marker.hidden = true
    marker.setAttribute('aria-hidden', 'true')
    markerRef.current = marker

    let disposed = false
    let awaitingSnapshot = true
    let blockedBySize = false
    let stopSession: (() => void) | undefined
    let observer: MutationObserver | undefined
    let resizeObserver: ResizeObserver | undefined
    let resizeFrame: number | undefined
    let sessionTask: Promise<void> | undefined
    const removeUpdateListener = desktop.onPreviewUpdate((update) => {
      if (disposed || update.documentId !== document.id || !domDocumentRef.current) return
      if (blockedBySize && update.kind !== 'new') {
        desktop.refreshSourceSync({ documentId: document.id })
        return
      }
      if (awaitingSnapshot && update.kind !== 'new') return
      if (update.kind === 'new') awaitingSnapshot = false
      try {
        domDocumentRef.current.addChangement([update.kind, update.data as unknown as string])
      } catch (error) {
        reportError('typst-dom-preview-update', error)
        setPreviewError(error instanceof Error ? error.message : String(error))
      }
    })

    void (async () => {
      try {
        await initializeRenderer()
        if (disposed) return
        sessionTask = domRenderer.runWithSession(async (renderSession) => {
          const renderOptions = {
            renderSession,
            container,
            domScale: 1,
            retrieveDOMState: () => {
              const viewportRect = viewport.getBoundingClientRect()
              const containerRect = container.getBoundingClientRect()
              return {
                width: viewport.clientWidth,
                height: viewport.clientHeight,
                window: { innerWidth: viewport.clientWidth, innerHeight: viewport.clientHeight },
                boundingRect: {
                  left: containerRect.left - viewportRect.left,
                  top: containerRect.top - viewportRect.top,
                  right: containerRect.right - viewportRect.left,
                },
              }
            },
          } as Parameters<typeof domRenderer.renderDom>[0] & {
            retrieveDOMState(): {
              width: number
              height: number
              window: { innerWidth: number; innerHeight: number }
              boundingRect: { left: number; top: number; right: number }
            }
          }
          const domDocument = await domRenderer.renderDom(renderOptions)
          if (disposed) {
            domDocument.dispose()
            return
          }
          domDocumentRef.current = domDocument
          const recoverFromRenderError = (error: unknown) => {
            if (disposed) return
            awaitingSnapshot = true
            reportError('typst-dom-preview-render', error)
            setPreviewError(error instanceof Error ? error.message : String(error))
            desktop.refreshSourceSync({ documentId: document.id })
          }
          const internals = domDocument.impl as unknown as DomRendererInternals
          const pendingKernelTasks = new Set<Promise<unknown>>()
          const trackKernelTask = (task: unknown) => {
            const tracked = Promise.resolve(task).finally(() => pendingKernelTasks.delete(tracked))
            pendingKernelTasks.add(tracked)
            return tracked
          }
          const relayout = internals.docKernel.relayout.bind(internals.docKernel)
          internals.docKernel.relayout = (...arguments_) => trackKernelTask(relayout(...arguments_))
          const repaint = internals.docKernel.repaint.bind(internals.docKernel)
          internals.docKernel.repaint = (...arguments_) => trackKernelTask(repaint(...arguments_))
          const processQueue = internals.processQueue.bind(internals)
          internals.processQueue = (update) => {
            try {
              if (blockedBySize && update[0] === 'viewport-change') return false
              const shouldRender = processQueue(update)
              if (update[0] === 'new' || update[0] === 'diff-v1') {
                const pagePixels = renderSession.retrievePagesInfo().map((page) => ({
                  width: Math.ceil(page.width * 3),
                  height: Math.ceil(page.height * 3),
                }))
                const totalPixels = pagePixels.reduce((total, page) => total + page.width * page.height, 0)
                blockedBySize = pagePixels.some((page) => (
                  page.width > MAX_DOM_CANVAS_DIMENSION || page.height > MAX_DOM_CANVAS_DIMENSION
                )) || totalPixels > MAX_DOM_CANVAS_PIXELS
                if (blockedBySize) {
                  awaitingSnapshot = true
                  setPreviewError('This document is too large for the experimental paged DOM renderer. Use SVG or canvas preview.')
                  return false
                }
                setPreviewError(undefined)
              }
              return shouldRender
            } catch (error) {
              recoverFromRenderError(error)
              throw error
            }
          }
          let activeDomRender: Promise<void> | undefined
          const renderDom = internals.doRender$dom.bind(internals)
          internals.doRender$dom = (context) => {
            const task = renderDom(context).catch((error) => recoverFromRenderError(error))
            const tracked = task.finally(() => {
              if (activeDomRender === tracked) activeDomRender = undefined
            })
            activeDomRender = tracked
            return tracked
          }
          const rerender = internals.r.rerender.bind(internals.r)
          internals.r.rerender = async () => {
            if (blockedBySize) return
            try {
              await rerender()
              await activeDomRender
              while (pendingKernelTasks.size) {
                await Promise.allSettled([...pendingKernelTasks])
              }
            } catch (error) {
              recoverFromRenderError(error)
              throw error
            }
          }
          observer = new MutationObserver(() => {
            const count = pages().length
            setPageCount(count)
            setPageNumber((current) => Math.min(Math.max(1, current), Math.max(1, count)))
            applyScale(false)
            updateMarker(autoScrollPendingRef.current)
          })
          observer.observe(container, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-width', 'data-height', 'data-index'],
          })
          resizeObserver = new ResizeObserver(() => {
            if (resizeFrame !== undefined) return
            resizeFrame = requestAnimationFrame(() => {
              resizeFrame = undefined
              applyScale()
              updateMarker()
            })
          })
          resizeObserver.observe(viewport)
          awaitingSnapshot = true
          desktop.refreshSourceSync({ documentId: document.id })
          await new Promise<void>((resolve) => { stopSession = resolve })
          window.clearTimeout(internals.vpTimeout)
          internals.vpTimeout = undefined
          internals.patchQueue.splice(0)
          await internals.current_task?.cancel()
          while (pendingKernelTasks.size) {
            await Promise.allSettled([...pendingKernelTasks])
          }
          await internals.current_task?.cancel()
          await activeDomRender
          while (pendingKernelTasks.size) {
            await Promise.allSettled([...pendingKernelTasks])
          }
          for (let frame = 0; internals.isRendering && frame < 10; frame += 1) {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          }
          window.clearTimeout(internals.vpTimeout)
          internals.vpTimeout = undefined
          while (pendingKernelTasks.size) {
            await Promise.allSettled([...pendingKernelTasks])
          }
          domDocument.dispose()
          if (domDocumentRef.current === domDocument) domDocumentRef.current = undefined
        })
        await sessionTask
      } catch (error) {
        if (disposed) return
        reportError('typst-dom-preview', error)
        setPreviewError(error instanceof Error ? error.message : String(error))
      }
    })()

    return () => {
      disposed = true
      removeUpdateListener()
      observer?.disconnect()
      resizeObserver?.disconnect()
      if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
      if (scrollFrameRef.current !== undefined) cancelAnimationFrame(scrollFrameRef.current)
      marker.remove()
      if (markerRef.current === marker) markerRef.current = null
      stopSession?.()
      void sessionTask?.catch((error) => reportError('typst-dom-preview-dispose', error))
    }
  }, [document.id, document.filePath, document.previewRootPath])

  useEffect(() => {
    autoScrollPendingRef.current = true
    applyScale()
    updateMarker(true)
  }, [zoom])

  useEffect(() => {
    applyScale()
    updateMarker(autoScrollPendingRef.current)
  }, [pageCount, showPreviewPosition])

  useEffect(() => {
    autoScrollPendingRef.current = true
    updateMarker(true)
  }, [positions, autoScrollEnabled])

  const trackVisiblePage = () => {
    autoScrollPendingRef.current = false
    if (scrollFrameRef.current !== undefined) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = undefined
      domDocumentRef.current?.addViewportChange()
      const viewport = viewportRef.current
      const renderedPages = pages()
      if (!viewport || !renderedPages.length) return
      const markerY = viewport.getBoundingClientRect().top + Math.min(80, viewport.clientHeight * 0.25)
      let visiblePage = 1
      for (let index = 0; index < renderedPages.length; index += 1) {
        if (renderedPages[index].getBoundingClientRect().top <= markerY) visiblePage = index + 1
      }
      pageNumberRef.current = visiblePage
      setPageNumber(visiblePage)
      updateMarker()
    })
  }

  const changePage = (page: number) => {
    const next = Math.min(Math.max(1, Math.round(page) || 1), Math.max(1, pageCount))
    setPageNumber(next)
    const viewport = viewportRef.current
    const target = pages()[next - 1]
    if (viewport && target) {
      const viewportRect = viewport.getBoundingClientRect()
      const targetRect = target.getBoundingClientRect()
      viewport.scrollTo({ top: viewport.scrollTop + targetRect.top - viewportRect.top - 6, behavior: 'smooth' })
    }
  }

  const revealSource = (event: MouseEvent<HTMLDivElement>) => {
    const page = (event.target as Element).closest<HTMLElement>('.typst-dom-page')
    const width = Number(page?.dataset.width)
    const height = Number(page?.dataset.height)
    const index = Number(page?.dataset.index)
    if (!page || !width || !height || !Number.isSafeInteger(index)) return
    const rect = page.getBoundingClientRect()
    onPreviewPoint({
      page: index + 1,
      x: Math.max(0, Math.min(width, (event.clientX - rect.left) / rect.width * width)),
      y: Math.max(0, Math.min(height, (event.clientY - rect.top) / rect.height * height)),
    })
  }

  const currentPdfUrl = document.pdfRevision === document.sourceRevision
    && document.pdfDependencyRevision === document.dependencyRevision
    ? document.pdfUrl
    : undefined
  const printPdf = async () => {
    const desktop = window.typstDesktop
    if (!desktop || !currentPdfUrl || printing) return
    setPrinting(true)
    setPrintError(undefined)
    try {
      const response = await fetch(currentPdfUrl)
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

  const statusError = status.documentId === document.id && status.state === 'error' ? status.message : undefined
  const effectiveError = previewError ?? statusError

  return (
    <section className="preview-panel" aria-label="Typst paged DOM preview">
      <div className="panel-heading preview-heading">
        <span className="preview-title">
          <span className="preview-label">Typst DOM Preview</span>
          {previewRoots?.length === 1 && (
            <span className="preview-root-name" title={previewRoots[0].filePath}>
              <span className="preview-root-filename">{previewRoots[0].relativePath}</span>
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
                  {root.relativePath}{root.filePath === document.filePath ? ' (current)' : ''}
                </option>
              ))}
            </select>
          )}
        </span>
        <PdfToolbar
          page={pageNumber}
          pageCount={pageCount}
          zoom={zoom}
          pdfUrl={currentPdfUrl}
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
      <div className="preview-surface typst-dom-viewport" ref={viewportRef} onScroll={trackVisiblePage}>
        {pageCount > 0 && (printError || statusError || previewError) && (
          <div className="preview-error" role="alert">{printError ?? statusError ?? previewError}</div>
        )}
        <div
          className="typst-dom-document"
          ref={documentRef}
          onClick={previewClickNavigationEnabled ? revealSource : undefined}
        />
        {!pageCount && (
          <div className="preview-empty">
            <div className={`loader ${effectiveError ? 'loader-error' : ''}`} />
            <strong>{effectiveError ? 'DOM preview unavailable' : 'Starting paged DOM preview'}</strong>
            <span>{effectiveError ?? 'The experimental DOM renderer may take a moment.'}</span>
          </div>
        )}
      </div>
    </section>
  )
}
