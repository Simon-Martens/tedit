import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createTypstRenderer, type RenderSession, type TypstRenderer } from '@myriaddreamin/typst.ts/renderer'
import { patchRoot } from '@myriaddreamin/typst.ts/render/svg/patch'
import rendererWasmUrl from '@myriaddreamin/typst-ts-renderer/wasm?url'
import { createPdfFilename } from '../lib/documents'
import { reportError } from '../lib/logging'
import type { EditorDocument, PreviewPosition, PreviewRoot, SourceSyncStatus } from '../types'
import { PdfToolbar, type PdfZoom } from './PdfToolbar'

const CSS_PIXELS_PER_POINT = 96 / 72
const PAGE_GAP_POINTS = 10
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
let rendererPromise: Promise<TypstRenderer> | undefined

function getRenderer() {
  rendererPromise ??= (async () => {
    const renderer = createTypstRenderer()
    await renderer.init({ getModule: () => rendererWasmUrl })
    return renderer
  })()
  return rendererPromise
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

function decoratePages(svg: SVGSVGElement) {
  for (const element of svg.querySelectorAll(':scope > .tedit-page-decoration')) element.remove()
  const pages = [...svg.querySelectorAll<SVGGElement>(':scope > g.typst-page')]
  const dimensions = pages.map((page) => ({
    page,
    width: Number(page.dataset.pageWidth),
    height: Number(page.dataset.pageHeight),
  })).filter(({ width, height }) => Number.isFinite(width) && Number.isFinite(height))
  if (!dimensions.length) return
  const width = Math.max(...dimensions.map((page) => page.width))
  let y = 0
  const firstPage = dimensions[0].page

  for (const [index, page] of dimensions.entries()) {
    if (index > 0) y += PAGE_GAP_POINTS
    const x = (width - page.width) / 2
    const transform = `translate(${x}, ${y})`
    page.page.setAttribute('transform', transform)
    page.page.dataset.pageNumber = String(index)
    page.page.dataset.x = String(x)
    page.page.dataset.y = String(y)

    const background = window.document.createElementNS(SVG_NAMESPACE, 'rect')
    background.classList.add('tedit-page-decoration', 'tedit-page-background')
    background.dataset.pageNumber = String(index)
    background.dataset.pageWidth = String(page.width)
    background.dataset.pageHeight = String(page.height)
    background.setAttribute('x', String(x))
    background.setAttribute('y', String(y))
    background.setAttribute('width', String(page.width))
    background.setAttribute('height', String(page.height))
    svg.insertBefore(background, firstPage)

    const clipPath = window.document.createElementNS(SVG_NAMESPACE, 'clipPath')
    clipPath.classList.add('tedit-page-decoration')
    clipPath.id = `tedit-page-clip-${index}`
    const clipRect = window.document.createElementNS(SVG_NAMESPACE, 'rect')
    clipRect.setAttribute('width', String(page.width))
    clipRect.setAttribute('height', String(page.height))
    clipPath.append(clipRect)
    svg.insertBefore(clipPath, firstPage)
    page.page.setAttribute('clip-path', `url(#${clipPath.id})`)

    y += page.height
  }

  svg.setAttribute('viewBox', `0 0 ${width} ${y}`)
  svg.setAttribute('data-width', String(width))
  svg.setAttribute('data-height', String(y))
  svg.setAttribute('width', String(Math.ceil(width)))
  svg.setAttribute('height', String(Math.ceil(y)))
}

export function TypstPreview({
  document,
  previewRoots,
  onPreviewRootChange,
  positions,
  status,
  showPreviewPosition,
  autoScrollEnabled,
  onPreviewPoint,
}: {
  document: EditorDocument
  previewRoots?: PreviewRoot[]
  onPreviewRootChange(filePath: string): void
  positions: PreviewPosition[]
  status: SourceSyncStatus
  showPreviewPosition: boolean
  autoScrollEnabled: boolean
  onPreviewPoint(position: PreviewPosition): void
}) {
  const [pageNumber, setPageNumber] = useState(1)
  const [pageCount, setPageCount] = useState(0)
  const [zoom, setZoom] = useState<PdfZoom>('width')
  const [renderedVersion, setRenderedVersion] = useState(0)
  const [previewError, setPreviewError] = useState<string>()
  const [printError, setPrintError] = useState<string>()
  const [printing, setPrinting] = useState(false)
  const zoomRef = useRef<PdfZoom>(zoom)
  const viewportRef = useRef<HTMLDivElement>(null)
  const documentRef = useRef<HTMLDivElement>(null)
  const markerRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<RenderSession | undefined>(undefined)
  const updatesRef = useRef<Array<{ kind: 'new' | 'diff-v1'; data: Uint8Array }>>([])
  const processingRef = useRef(false)
  const releaseSessionRef = useRef<() => void>(() => undefined)
  const pdfFileName = createPdfFilename(document)
  const statusError = status.documentId === document.id && status.state === 'error' ? status.message : undefined
  const effectivePreviewError = previewError ?? statusError
  const visiblePreviewError = printError ?? statusError
  zoomRef.current = zoom

  const applyScaleToSvg = (svg: SVGSVGElement, session: RenderSession, pagesCount: number) => {
    const viewport = viewportRef.current
    if (!viewport || !pagesCount) return
    const pages = session.retrievePagesInfo()
    const firstPage = pages[0]
    const availableWidth = Math.max(100, viewport.clientWidth - 20)
    const availableHeight = Math.max(100, viewport.clientHeight - 20)
    const documentWidth = Number(svg.dataset.width) || session.docWidth
    const documentHeight = Number(svg.dataset.height) || session.docHeight
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
    const session = sessionRef.current
    const svg = documentRef.current?.firstElementChild as SVGSVGElement | null
    if (session && svg) applyScaleToSvg(svg, session, pageCount)
  }

  const processUpdates = () => {
    if (processingRef.current || !sessionRef.current || !updatesRef.current.length) return
    processingRef.current = true
    requestAnimationFrame(() => {
      try {
        const session = sessionRef.current
        const container = documentRef.current
        if (!session || !container) return
        const updates = updatesRef.current.splice(0)
        let latestNew = -1
        for (let index = updates.length - 1; index >= 0; index -= 1) {
          if (updates[index].kind === 'new') {
            latestNew = index
            break
          }
        }
        const applicableUpdates = latestNew >= 0 ? updates.slice(latestNew) : updates
        let replaceDocument = false
        for (const update of applicableUpdates) {
          if (update.kind === 'new') {
            session.reset()
            replaceDocument = true
          }
          session.manipulateData({ action: 'merge', data: update.data })
        }
        const patch = session.renderSvgDiff({
          window: { lo: { x: 0, y: 0 }, hi: { x: 1e20, y: 1e20 } },
        })
        const parsed = window.document.createElement('div')
        parsed.innerHTML = patch
        const nextSvg = parsed.firstElementChild as SVGSVGElement | null
        const currentSvg = container.firstElementChild as SVGSVGElement | null
        if (!nextSvg) throw new Error('Tinymist produced an empty SVG preview.')
        const nextPageCount = session.retrievePagesInfo().length
        decoratePages(nextSvg)
        applyScaleToSvg(nextSvg, session, nextPageCount)
        if (replaceDocument || !currentSvg) container.replaceChildren(nextSvg)
        else {
          patchRoot(currentSvg, nextSvg)
          decoratePages(currentSvg)
          applyScaleToSvg(currentSvg, session, nextPageCount)
        }
        setPageCount(nextPageCount)
        setPageNumber((current) => Math.max(1, Math.min(current, nextPageCount || 1)))
        setPreviewError(undefined)
        setRenderedVersion((current) => current + 1)
      } catch (error) {
        reportError('typst-preview-render', error)
        setPreviewError(error instanceof Error ? error.message : String(error))
      } finally {
        processingRef.current = false
        if (updatesRef.current.length) processUpdates()
      }
    })
  }

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!desktop) {
      setPreviewError('The live preview requires the tedit desktop app.')
      return
    }
    let cancelled = false
    const removeUpdateListener = desktop.onPreviewUpdate((update) => {
      if (update.documentId !== document.id) return
      if (update.kind === 'new') updatesRef.current = []
      updatesRef.current.push({ kind: update.kind, data: new Uint8Array(update.data) })
      processUpdates()
    })
    void getRenderer().then((renderer) => renderer.runWithSession(async (session) => {
      if (cancelled) return
      sessionRef.current = session
      processUpdates()
      await new Promise<void>((resolve) => {
        releaseSessionRef.current = resolve
      })
    })).catch((error) => {
      reportError('typst-preview-init', error)
      setPreviewError(error instanceof Error ? error.message : String(error))
    })
    return () => {
      cancelled = true
      removeUpdateListener()
      releaseSessionRef.current()
      releaseSessionRef.current = () => undefined
      sessionRef.current = undefined
      updatesRef.current = []
    }
  }, [document.id])

  useEffect(() => {
    applyScale()
  }, [zoom, pageCount, renderedVersion])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(applyScale)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [pageCount, zoom])

  const pageElements = () => [...(documentRef.current?.querySelectorAll<SVGGElement>('g.typst-page') ?? [])]
  const changePage = (page: number, behavior: ScrollBehavior = 'smooth') => {
    const nextPage = Math.max(1, Math.min(pageCount || 1, page || 1))
    const target = pageElements()[nextPage - 1]
    const viewport = viewportRef.current
    if (target && viewport) {
      const targetRect = target.getBoundingClientRect()
      const viewportRect = viewport.getBoundingClientRect()
      viewport.scrollTo({ top: viewport.scrollTop + targetRect.top - viewportRect.top - 6, behavior })
    }
    setPageNumber(nextPage)
  }

  useEffect(() => {
    const viewport = viewportRef.current
    const marker = markerRef.current
    const pages = pageElements()
    if (!viewport || !marker || !positions.length || !pages.length) {
      marker?.classList.remove('visible')
      return
    }
    const position = positions.reduce((closest, candidate) => (
      Math.abs(candidate.page - pageNumber) <= Math.abs(closest.page - pageNumber) ? candidate : closest
    ))
    const page = pages[position.page - 1]
    if (!page) return
    const pageRect = page.getBoundingClientRect()
    const documentRect = documentRef.current!.getBoundingClientRect()
    const pageWidth = Number(page.dataset.pageWidth) || pageRect.width
    const pageHeight = Number(page.dataset.pageHeight) || pageRect.height
    marker.style.left = `${pageRect.left - documentRect.left + (position.x / pageWidth) * pageRect.width}px`
    marker.style.top = `${pageRect.top - documentRect.top + (position.y / pageHeight) * pageRect.height}px`
    marker.classList.toggle('visible', showPreviewPosition)
    if (autoScrollEnabled) {
      viewport.scrollTo({
        top: Math.max(0, viewport.scrollTop + pageRect.top - viewport.getBoundingClientRect().top
          + (position.y / pageHeight) * pageRect.height - viewport.clientHeight * 0.35),
        behavior: 'smooth',
      })
      setPageNumber(position.page)
    }
  }, [positions, renderedVersion, zoom, showPreviewPosition, autoScrollEnabled])

  const trackVisiblePage = () => {
    const viewport = viewportRef.current
    if (!viewport) return
    const marker = viewport.getBoundingClientRect().top + Math.min(80, viewport.clientHeight * 0.25)
    let visiblePage = 1
    for (const [index, page] of pageElements().entries()) {
      if (page.getBoundingClientRect().top > marker) break
      visiblePage = index + 1
    }
    setPageNumber((current) => current === visiblePage ? current : visiblePage)
  }

  const revealSource = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element
    const pages = pageElements()
    const backgrounds = [...(documentRef.current?.querySelectorAll<SVGRectElement>(
      ':scope > svg > .tedit-page-background',
    ) ?? [])]
    const clickedPage = target.closest<SVGGElement>('g.typst-page')
    let pageIndex = clickedPage ? pages.indexOf(clickedPage) : -1
    if (pageIndex < 0) {
      pageIndex = backgrounds.findIndex((background) => {
        const rect = background.getBoundingClientRect()
        return event.clientX >= rect.left && event.clientX <= rect.right
          && event.clientY >= rect.top && event.clientY <= rect.bottom
      })
    }
    const page = pages[pageIndex]
    const background = backgrounds[pageIndex]
    if (!page || !background) return
    const rect = background.getBoundingClientRect()
    const width = Number(page.dataset.pageWidth)
    const height = Number(page.dataset.pageHeight)
    if (!rect.width || !rect.height || !width || !height) return
    const xRatio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    const yRatio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
    onPreviewPoint({
      page: pageIndex + 1,
      x: xRatio * width,
      y: yRatio * height,
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
      <div className="preview-surface typst-preview-viewport" ref={viewportRef} onScroll={trackVisiblePage}>
        {pageCount > 0 && visiblePreviewError && (
          <div className="preview-error" role="alert">{visiblePreviewError}</div>
        )}
        <div className="typst-preview-content">
          <div className="typst-preview-document" ref={documentRef} onClick={revealSource} />
          <div className="pdf-location-marker" ref={markerRef} aria-hidden="true" />
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
