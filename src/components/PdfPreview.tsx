import { useEffect, useRef, useState } from 'react'
import {
  AnnotationMode,
  GlobalWorkerOptions,
  getDocument,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { createPdfFilename } from '../lib/documents'
import type { EditorDocument } from '../types'
import { PdfToolbar, type PdfZoom } from './PdfToolbar'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

const PDF_CSS_UNITS = 96 / 72

export function PdfPreview({ document }: { document: EditorDocument }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy>()
  const [displayedUrl, setDisplayedUrl] = useState<string>()
  const [pageNumber, setPageNumber] = useState(1)
  const [zoom, setZoom] = useState<PdfZoom>('width')
  const [rotation, setRotation] = useState(0)
  const [sizeVersion, setSizeVersion] = useState(0)
  const [printing, setPrinting] = useState(false)
  const pagesRef = useRef<HTMLDivElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const renderTaskRef = useRef<RenderTask | undefined>(undefined)
  const renderVersionRef = useRef(0)
  const displayedUrlRef = useRef<string | undefined>(undefined)
  const scrollFrameRef = useRef<number | undefined>(undefined)
  const pdfFileName = createPdfFilename(document)
  const isUpdating = document.compileState === 'compiling' || document.pdfUrl !== displayedUrl

  const scrollToPage = (page: number, behavior: ScrollBehavior = 'smooth') => {
    const viewport = viewportRef.current
    const canvas = pagesRef.current?.querySelector<HTMLElement>(`[data-page="${page}"]`)
    if (!viewport || !canvas) return
    viewport.scrollTo({ top: Math.max(0, canvas.offsetTop - 6), behavior })
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
      const pages = pagesRef.current?.querySelectorAll<HTMLElement>('[data-page]')
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
      setPageNumber((current) => Math.min(current, nextPdf.numPages))
    }).catch(() => undefined)

    return () => {
      cancelled = true
      void loadingTask.destroy()
    }
  }, [document.pdfUrl])

  useEffect(() => {
    if (!pdf || !document.pdfUrl) return
    const pdfUrl = document.pdfUrl
    const version = ++renderVersionRef.current
    renderTaskRef.current?.cancel()

    const render = async () => {
      const container = viewportRef.current
      if (!container || version !== renderVersionRef.current) return

      const availableWidth = Math.max(100, container.clientWidth - 12)
      const availableHeight = Math.max(100, container.clientHeight - 12)
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2)
      const nextPages = window.document.createDocumentFragment()

      for (let index = 1; index <= pdf.numPages; index += 1) {
        const page = await pdf.getPage(index)
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
        canvas.width = Math.ceil(renderViewport.width)
        canvas.height = Math.ceil(renderViewport.height)
        canvas.style.width = `${Math.ceil(viewport.width)}px`
        canvas.style.height = `${Math.ceil(viewport.height)}px`
        const context = canvas.getContext('2d')
        if (!context) continue

        const task = page.render({
          canvas,
          canvasContext: context,
          viewport: renderViewport,
          annotationMode: AnnotationMode.DISABLE,
        })
        renderTaskRef.current = task
        await task.promise
        if (version !== renderVersionRef.current) return
        nextPages.append(canvas)
      }

      const pages = pagesRef.current
      if (!pages || version !== renderVersionRef.current) return
      pages.replaceChildren(nextPages)
      requestAnimationFrame(() => scrollToPage(Math.min(pageNumber, pdf.numPages), 'auto'))

      if (displayedUrlRef.current !== pdfUrl) {
        const previousUrl = displayedUrlRef.current
        displayedUrlRef.current = pdfUrl
        setDisplayedUrl(pdfUrl)
        if (previousUrl) URL.revokeObjectURL(previousUrl)
      }
    }

    void render().catch((error) => {
      if (error instanceof Error && error.name === 'RenderingCancelledException') return
    })
    return () => renderTaskRef.current?.cancel()
  }, [pdf, zoom, rotation, sizeVersion, document.pdfUrl])

  useEffect(() => {
    return () => {
      renderTaskRef.current?.cancel()
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
          {isUpdating && displayedUrl && <i className="preview-spinner" />}
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
        <div ref={pagesRef} className="pdf-pages" />
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
