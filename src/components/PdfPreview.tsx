import { useEffect, useRef, useState } from 'react'
import {
  AnnotationMode,
  GlobalWorkerOptions,
  TextLayer,
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PageViewport,
  type RenderTask,
} from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { createPdfFilename } from '../lib/documents'
import type { EditorDocument, PreviewPosition, SourceCursorLocation, SourceSyncStatus } from '../types'
import { PdfToolbar, type PdfZoom } from './PdfToolbar'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const PDF_CSS_UNITS = 96 / 72

interface TextToken {
  value: string
  x: number
  y: number
}

interface SourceSignature {
  before: string[]
  target: string
  after: string[]
  targetIndex: number
  wordCount: number
}

interface PageRenderEntry {
  page: PDFPageProxy
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
  displayViewport: PageViewport
  renderViewport: PageViewport
  textLayerContainer: HTMLDivElement
  pageNumber: number
  renderWidth: number
  renderHeight: number
}

const WORD_PATTERN = /[\p{L}\p{N}\p{M}_]+/gu

function normalizeWord(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase()
}

function utf8ByteToStringIndex(text: string, byteOffset: number) {
  let bytes = 0
  let index = 0
  for (const character of text) {
    const nextBytes = bytes + new TextEncoder().encode(character).length
    if (nextBytes > byteOffset) break
    bytes = nextBytes
    index += character.length
  }
  return index
}

function sourceSignature(source: string, location: SourceCursorLocation): SourceSignature | undefined {
  const lines = source.split(/\r?\n/)
  let sourcePosition = location.cursor
  const cursorLine = lines[location.cursor.line]
  if (cursorLine === undefined || !/[\p{L}\p{N}\p{M}_]/u.test(cursorLine)) {
    sourcePosition = location.lookup
  }
  if (cursorLine !== undefined && location.cursor.line === location.lookup.line) {
    const cursorIndex = utf8ByteToStringIndex(cursorLine, location.cursor.character)
    for (const link of cursorLine.matchAll(/#link\s*\([^)]*\)\s*\[([^\]]*)\]/g)) {
      const start = link.index ?? 0
      const bodyStart = start + link[0].lastIndexOf(link[1])
      if (cursorIndex >= start && cursorIndex < bodyStart) sourcePosition = location.lookup
    }
  }
  const line = lines[sourcePosition.line]
  if (line === undefined) return undefined
  const index = utf8ByteToStringIndex(line, sourcePosition.character)
  const words = [...line.matchAll(WORD_PATTERN)]
  if (!words.length) return undefined
  let targetIndex = words.findIndex((word) => {
    const start = word.index ?? 0
    return start <= index && index <= start + word[0].length
  })
  if (targetIndex < 0) {
    targetIndex = words.reduce((closest, word, candidateIndex) => (
      Math.abs((word.index ?? 0) - index) < Math.abs((words[closest].index ?? 0) - index)
        ? candidateIndex
        : closest
    ), 0)
  }
  return {
    before: words.slice(Math.max(0, targetIndex - 2), targetIndex).map((word) => normalizeWord(word[0])),
    target: normalizeWord(words[targetIndex][0]),
    after: words.slice(targetIndex + 1, targetIndex + 3).map((word) => normalizeWord(word[0])),
    targetIndex,
    wordCount: words.length,
  }
}

function refinedTextY(tokens: TextToken[], signature: SourceSignature, anchor?: { x: number; y: number }) {
  let expectedIndex: number | undefined
  let matches = tokens.map((token, index) => ({ token, index })).filter(({ token }) => token.value === signature.target)
  if (anchor && tokens.length) {
    const anchorIndex = tokens.reduce((closest, token, index) => {
      const distance = Math.abs(token.y - anchor.y) * 4 + Math.abs(token.x - anchor.x)
      const closestDistance = Math.abs(tokens[closest].y - anchor.y) * 4 + Math.abs(tokens[closest].x - anchor.x)
      return distance < closestDistance ? index : closest
    }, 0)
    expectedIndex = anchorIndex + signature.targetIndex
    const end = anchorIndex + Math.max(8, signature.wordCount + 4)
    matches = matches.filter(({ index }) => index >= Math.max(0, anchorIndex - 2) && index <= end)
  }
  if (!matches.length) return undefined
  const scored = matches.map(({ token, index }) => {
    let score = 0
    for (let offset = 1; offset <= signature.before.length; offset += 1) {
      if (tokens[index - offset]?.value === signature.before.at(-offset)) score += 1
    }
    for (let offset = 0; offset < signature.after.length; offset += 1) {
      if (tokens[index + offset + 1]?.value === signature.after[offset]) score += 1
    }
    return { index, score, y: token.y }
  })
  const bestScore = Math.max(...scored.map(({ score }) => score))
  const best = scored.filter(({ score }) => score === bestScore)
  if (best.length === 1) return best[0].y
  if (expectedIndex === undefined) return undefined
  const expected = best
    .map((match) => ({ ...match, distance: Math.abs(match.index - expectedIndex) }))
    .sort((left, right) => left.distance - right.distance)
  if (expected.length > 1 && expected[0].distance === expected[1].distance) return undefined
  return expected[0].y
}

function canvasPosition(canvas: HTMLCanvasElement) {
  const row = canvas.parentElement
  return {
    left: (row?.offsetLeft ?? 0) + canvas.offsetLeft,
    top: (row?.offsetTop ?? 0) + canvas.offsetTop,
  }
}

export function PdfPreview({
  document,
  positions,
  sourceCursorLocation,
  sourceSyncStatus,
  showPreviewPosition,
  autoScrollEnabled,
}: {
  document: EditorDocument
  positions: PreviewPosition[]
  sourceCursorLocation?: SourceCursorLocation
  sourceSyncStatus: SourceSyncStatus
  showPreviewPosition: boolean
  autoScrollEnabled: boolean
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>()
  const [loadedPdfUrl, setLoadedPdfUrl] = useState<string>()
  const [displayedUrl, setDisplayedUrl] = useState<string>()
  const [pageNumber, setPageNumber] = useState(1)
  const [zoom, setZoom] = useState<PdfZoom>('width')
  const [rotation, setRotation] = useState(0)
  const [renderedVersion, setRenderedVersion] = useState(0)
  const [sizeVersion, setSizeVersion] = useState(0)
  const [printing, setPrinting] = useState(false)
  const pagesRef = useRef<HTMLDivElement>(null)
  const pageStackRef = useRef<HTMLDivElement>(null)
  const locationMarkerRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<RenderTask | undefined>(undefined)
  const textLayersRef = useRef<TextLayer[]>([])
  const renderVersionRef = useRef(0)
  const displayedUrlRef = useRef<string | undefined>(undefined)
  const textTokensRef = useRef(new Map<number, Promise<TextToken[]>>())
  const scrollFrameRef = useRef<number | undefined>(undefined)
  const pdfFileName = createPdfFilename(document)
  const isUpdating = document.compileState === 'compiling' || document.pdfUrl !== displayedUrl

  const scrollToPage = (page: number, behavior: ScrollBehavior = 'smooth') => {
    const viewport = viewportRef.current
    const row = pageStackRef.current?.querySelector<HTMLElement>(`.pdf-page-row[data-page="${page}"]`)
    if (!viewport || !row) return
    viewport.scrollTo({ top: Math.max(0, row.offsetTop - 6), behavior })
  }

  const changePage = (page: number) => {
    const nextPage = Math.min(pdf?.numPages ?? 1, Math.max(1, page || 1))
    setPageNumber(nextPage)
    scrollToPage(nextPage)
  }

  const trackVisiblePage = () => {
    if (scrollFrameRef.current !== undefined) return
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = undefined
      const viewport = viewportRef.current
      const pages = pageStackRef.current?.querySelectorAll<HTMLElement>('.pdf-page-row[data-page]')
      if (!viewport || !pages?.length) return
      const marker = viewport.scrollTop + Math.min(80, viewport.clientHeight * 0.25)
      let visiblePage = 1
      for (const page of pages) {
        if (page.offsetTop > marker) break
        visiblePage = Number(page.dataset.page)
      }
      setPageNumber((current) => current === visiblePage ? current : visiblePage)
    })
  }

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const observer = new ResizeObserver(() => setSizeVersion((current) => current + 1))
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!document.pdfUrl || document.pdfUrl === displayedUrlRef.current) return
    const url = document.pdfUrl
    renderVersionRef.current += 1
    renderTaskRef.current?.cancel()
    const loadingTask = getDocument({ url })
    let cancelled = false

    loadingTask.promise.then((nextPdf) => {
      if (cancelled) {
        void nextPdf.cleanup()
        return
      }
      setPdf((current) => {
        if (current) void current.cleanup()
        return nextPdf
      })
      setLoadedPdfUrl(url)
      setPageNumber((current) => Math.min(current, nextPdf.numPages))
    }).catch(() => undefined)

    return () => {
      cancelled = true
      void loadingTask.destroy()
    }
  }, [document.pdfUrl])

  useEffect(() => {
    if (!pdf || !loadedPdfUrl || loadedPdfUrl !== document.pdfUrl) return
    const pdfUrl = loadedPdfUrl
    const version = ++renderVersionRef.current
    renderTaskRef.current?.cancel()
    for (const textLayer of textLayersRef.current.splice(0)) textLayer.cancel()

    const render = async () => {
      const container = viewportRef.current
      if (!container || version !== renderVersionRef.current) return

      const availableWidth = Math.max(100, container.clientWidth - 16)
      const availableHeight = Math.max(100, container.clientHeight - 12)
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const nextPages = window.document.createDocumentFragment()
      const renderEntries: PageRenderEntry[] = []
      const currentPages = pageStackRef.current
      const currentRows = currentPages?.querySelectorAll<HTMLElement>('.pdf-page-row[data-page]')
      let anchorPage = Math.min(pageNumber, pdf.numPages)
      let anchorOffset = 0
      if (currentRows?.length) {
        const scrollMarker = container.scrollTop + 6
        for (const row of currentRows) {
          if (row.offsetTop > scrollMarker) break
          anchorPage = Number(row.dataset.page)
          anchorOffset = Math.max(0, (scrollMarker - row.offsetTop) / row.clientHeight)
        }
      }

      const pdfPages = await Promise.all(
        Array.from({ length: pdf.numPages }, (_, index) => pdf.getPage(index + 1)),
      )
      if (version !== renderVersionRef.current) return

      for (let index = 1; index <= pdf.numPages; index += 1) {
        const page = pdfPages[index - 1]
        const baseViewport = page.getViewport({ scale: 1, rotation })
        let scale: number
        if (zoom === 'width') scale = availableWidth / baseViewport.width
        else if (zoom === 'page') {
          scale = Math.min(availableWidth / baseViewport.width, availableHeight / baseViewport.height)
        } else scale = PDF_CSS_UNITS * (zoom / 100)

        const viewport = page.getViewport({ scale, rotation })
        const renderViewport = page.getViewport({ scale: scale * pixelRatio, rotation })
        const canvas = window.document.createElement('canvas')
        canvas.className = 'pdf-page-canvas'
        canvas.dataset.page = String(index)
        const unrotatedViewport = page.getViewport({ scale: 1, rotation: 0 })
        canvas.dataset.pageWidth = String(unrotatedViewport.width)
        canvas.dataset.pageHeight = String(unrotatedViewport.height)
        canvas.style.width = `${Math.ceil(viewport.width)}px`
        canvas.style.height = `${Math.ceil(viewport.height)}px`
        const context = canvas.getContext('2d')
        if (!context) continue
        const row = window.document.createElement('div')
        row.className = 'pdf-page-row'
        row.dataset.page = String(index)
        const textLayerContainer = window.document.createElement('div')
        textLayerContainer.className = 'pdf-text-layer'
        textLayerContainer.style.setProperty('--total-scale-factor', String(viewport.scale))
        row.append(canvas, textLayerContainer)
        nextPages.append(row)
        renderEntries.push({
          page,
          canvas,
          context,
          displayViewport: viewport,
          renderViewport,
          textLayerContainer,
          pageNumber: index,
          renderWidth: Math.ceil(renderViewport.width),
          renderHeight: Math.ceil(renderViewport.height),
        })
      }

      const prioritizedEntries = renderEntries.sort((left, right) => (
        Math.abs(left.pageNumber - anchorPage) - Math.abs(right.pageNumber - anchorPage)
      ))
      const renderPage = async (entry: typeof renderEntries[number]) => {
        entry.canvas.width = entry.renderWidth
        entry.canvas.height = entry.renderHeight
        const task = entry.page.render({
          canvas: entry.canvas,
          canvasContext: entry.context,
          viewport: entry.renderViewport,
          annotationMode: AnnotationMode.DISABLE,
        })
        renderTaskRef.current = task
        await task.promise
        if (version !== renderVersionRef.current) return false
        const textLayer = new TextLayer({
          textContentSource: entry.page.streamTextContent({ includeMarkedContent: true }),
          container: entry.textLayerContainer,
          viewport: entry.displayViewport,
        })
        textLayersRef.current.push(textLayer)
        await textLayer.render()
        return version === renderVersionRef.current
      }

      const firstEntry = prioritizedEntries.shift()
      if (!firstEntry || !await renderPage(firstEntry)) return
      const pages = pageStackRef.current
      if (!pages || version !== renderVersionRef.current) return
      pages.replaceChildren(nextPages)
      setRenderedVersion((current) => current + 1)
      const anchorRow = pages.querySelector<HTMLElement>(`.pdf-page-row[data-page="${anchorPage}"]`)
      if (anchorRow) {
        container.scrollTop = Math.max(0, anchorRow.offsetTop + anchorOffset * anchorRow.clientHeight - 6)
      }

      if (displayedUrlRef.current !== pdfUrl) {
        const previousUrl = displayedUrlRef.current
        displayedUrlRef.current = pdfUrl
        setDisplayedUrl(pdfUrl)
        if (previousUrl) URL.revokeObjectURL(previousUrl)
      }

      for (const entry of prioritizedEntries) {
        if (!await renderPage(entry)) return
      }
      setRenderedVersion((current) => current + 1)
    }

    void render().catch((error) => {
      if (error instanceof Error && error.name === 'RenderingCancelledException') return
    })
    return () => {
      renderTaskRef.current?.cancel()
      for (const textLayer of textLayersRef.current.splice(0)) textLayer.cancel()
    }
  }, [pdf, loadedPdfUrl, zoom, rotation, sizeVersion, document.pdfUrl])

  useEffect(() => {
    textTokensRef.current.clear()
  }, [pdf])

  useEffect(() => {
    if (!displayedUrl) {
      locationMarkerRef.current?.classList.remove('visible')
      return
    }
    if (displayedUrl !== document.pdfUrl) return
    if (!positions.length) {
      const marker = locationMarkerRef.current
      const viewport = viewportRef.current
      marker?.classList.remove('visible')
      const signature = sourceCursorLocation && sourceSignature(document.source, sourceCursorLocation)
      if (!pdf || !marker || !viewport || !signature || rotation !== 0) return
      let cancelled = false
      const canvases = [...(pageStackRef.current?.querySelectorAll<HTMLCanvasElement>('.pdf-page-canvas[data-page]') ?? [])]
      void Promise.all(canvases.map(async (canvas) => {
        const page = Number(canvas.dataset.page)
        const pageHeight = Number(canvas.dataset.pageHeight)
        let textTokens = textTokensRef.current.get(page)
        if (!textTokens) {
          textTokens = pdf.getPage(page).then((pdfPage) => pdfPage.getTextContent()).then((content) => (
            content.items.flatMap((item) => {
              if (!('str' in item) || item.dir === 'ttb') return []
              const y = pageHeight - Number(item.transform[5])
              return [...item.str.matchAll(WORD_PATTERN)].map((word) => ({
                value: normalizeWord(word[0]),
                x: Number(item.transform[4]),
                y,
              }))
            })
          ))
          textTokensRef.current.set(page, textTokens)
        }
        return { canvas, page, y: refinedTextY(await textTokens, signature) }
      })).then((matches) => {
        if (cancelled) return
        const resolved = matches.filter((match): match is typeof match & { y: number } => match.y !== undefined)
        if (resolved.length !== 1) return
        const { canvas, y } = resolved[0]
        const pageWidth = Number(canvas.dataset.pageWidth)
        const scale = canvas.clientWidth / pageWidth
        const position = canvasPosition(canvas)
        const top = position.top + Math.max(0, y - 3) * scale
        marker.style.left = `${position.left + 7}px`
        marker.style.top = `${top}px`
        marker.classList.add('visible')
      }).catch(() => undefined)
      return () => {
        cancelled = true
      }
    }
    const position = positions.reduce((closest, candidate) => (
      Math.abs(candidate.page - pageNumber) <= Math.abs(closest.page - pageNumber) ? candidate : closest
    ))
    const canvas = pageStackRef.current?.querySelector<HTMLCanvasElement>(`.pdf-page-canvas[data-page="${position.page}"]`)
    const marker = locationMarkerRef.current
    const viewport = viewportRef.current
    if (!canvas || !marker || !viewport) return

    const pageWidth = Number(canvas.dataset.pageWidth)
    const pageHeight = Number(canvas.dataset.pageHeight)
    const rotatedWidth = rotation % 180 === 0 ? pageWidth : pageHeight
    const scale = canvas.clientWidth / rotatedWidth
    let cancelled = false
    const placeMarker = (unrotatedY: number) => {
      if (cancelled) return
      let y = unrotatedY
      if (rotation === 90) y = position.x
      else if (rotation === 180) y = pageHeight - unrotatedY
      else if (rotation === 270) y = pageWidth - position.x

      const canvasOffset = canvasPosition(canvas)
      const left = canvasOffset.left + 7
      const top = canvasOffset.top + Math.max(0, y - 3) * scale
      marker.style.left = `${left}px`
      marker.style.top = `${top}px`
      marker.classList.add('visible')
      if (autoScrollEnabled) {
        viewport.scrollTo({ top: Math.max(0, top - viewport.clientHeight * 0.35), behavior: 'smooth' })
        setPageNumber(position.page)
      }
    }

    placeMarker(position.y)
    const signature = sourceCursorLocation && sourceSignature(document.source, sourceCursorLocation)
    if (pdf && rotation === 0 && signature) {
      let textTokens = textTokensRef.current.get(position.page)
      if (!textTokens) {
        textTokens = pdf.getPage(position.page).then((page) => page.getTextContent()).then((content) => (
          content.items.flatMap((item) => {
            if (!('str' in item) || item.dir === 'ttb') return []
            const y = pageHeight - Number(item.transform[5])
            return [...item.str.matchAll(WORD_PATTERN)].map((word) => ({
              value: normalizeWord(word[0]),
              x: Number(item.transform[4]),
              y,
            }))
          })
        ))
        textTokensRef.current.set(position.page, textTokens)
      }
      void textTokens.then((tokens) => {
        const refinedY = refinedTextY(tokens, signature, { x: position.x, y: position.y })
        if (refinedY !== undefined) placeMarker(refinedY)
      }).catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [positions, sourceCursorLocation, displayedUrl, document.pdfUrl, document.sourceRevision, rotation, renderedVersion, pdf, autoScrollEnabled])

  useEffect(() => {
    return () => {
      renderTaskRef.current?.cancel()
      for (const textLayer of textLayersRef.current.splice(0)) textLayer.cancel()
      if (scrollFrameRef.current !== undefined) cancelAnimationFrame(scrollFrameRef.current)
      if (pdf) void pdf.cleanup()
    }
  }, [pdf])

  const printPdf = async () => {
    if (!pdf || printing) return
    setPrinting(true)
    try {
      const images: string[] = []
      for (let index = 1; index <= pdf.numPages; index += 1) {
        const page = await pdf.getPage(index)
        const viewport = page.getViewport({ scale: 1.5 })
        const canvas = window.document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)
        const context = canvas.getContext('2d')
        if (!context) continue
        await page.render({
          canvas,
          canvasContext: context,
          viewport,
          annotationMode: AnnotationMode.DISABLE,
        }).promise
        images.push(canvas.toDataURL('image/png'))
      }

      const frame = window.document.createElement('iframe')
      frame.className = 'pdf-print-frame'
      frame.srcdoc = `<!doctype html><style>@page{margin:0}body{margin:0}img{display:block;width:100%;page-break-after:always}</style>${images.map((image) => `<img src="${image}">`).join('')}`
      frame.onload = () => {
        frame.contentWindow?.print()
        window.setTimeout(() => frame.remove(), 1000)
      }
      window.document.body.append(frame)
    } finally {
      setPrinting(false)
    }
  }

  return (
    <section className="preview-panel" aria-label="PDF preview">
      <div className="panel-heading preview-heading">
        <span className="preview-title">
          PDF Preview
          {isUpdating && displayedUrl ? (
            <i className="preview-spinner" title="Updating PDF preview" />
          ) : (
            <i
              className={`source-sync-indicator ${sourceSyncStatus.state}`}
              title={sourceSyncStatus.message}
            />
          )}
        </span>
        <PdfToolbar
          page={pageNumber}
          pageCount={pdf?.numPages ?? 0}
          zoom={zoom}
          pdfUrl={displayedUrl}
          fileName={pdfFileName}
          printing={printing}
          onPageChange={changePage}
          onZoomChange={setZoom}
          onRotate={() => setRotation((current) => (current + 90) % 360)}
          onPrint={() => void printPdf()}
        />
      </div>
      <div className="preview-surface pdf-canvas-viewport" ref={viewportRef} onScroll={trackVisiblePage}>
        <div ref={pagesRef} className={`pdf-pages ${showPreviewPosition ? '' : 'position-hidden'}`}>
          <div ref={pageStackRef} className="pdf-page-stack" />
          <div ref={locationMarkerRef} className="pdf-location-marker" aria-hidden="true" />
        </div>
        {!displayedUrl && (
          <div className="preview-empty">
            <div className={`loader ${document.compileState === 'error' ? 'loader-error' : ''}`} />
            <strong>{document.compileState === 'error' ? 'Preview unavailable' : 'Building preview'}</strong>
            <span>{document.compileState === 'error' ? 'Check the compilation output.' : 'The first compile may take a moment.'}</span>
          </div>
        )}
      </div>
    </section>
  )
}
