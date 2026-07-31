import { Icon } from './Icon'

export type PdfZoom = 'width' | 'page' | number

interface PdfToolbarProps {
  page: number
  pageCount: number
  zoom: PdfZoom
  pdfUrl?: string
  previewReady?: boolean
  rotationEnabled?: boolean
  fileName: string
  printing: boolean
  onPageChange(page: number): void
  onZoomChange(zoom: PdfZoom): void
  onRotate(): void
  onPrint(): void
}

export function PdfToolbar({
  page,
  pageCount,
  zoom,
  pdfUrl,
  previewReady,
  rotationEnabled = true,
  fileName,
  printing,
  onPageChange,
  onZoomChange,
  onRotate,
  onPrint,
}: PdfToolbarProps) {
  const numericZoom = typeof zoom === 'number' ? zoom : 100
  const previewAvailable = previewReady ?? Boolean(pdfUrl)

  return (
    <div className="pdf-toolbar" aria-label="PDF controls">
      <button type="button" title="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        <Icon name="previous" />
      </button>
      <label className="pdf-page-control" title="Current page">
        <input
          aria-label="Current page"
          type="number"
          min={1}
          max={pageCount || 1}
          value={page}
          onChange={(event) => onPageChange(Number(event.target.value))}
        />
        <span>/ {pageCount || '–'}</span>
      </label>
      <button type="button" title="Next page" disabled={!pageCount || page >= pageCount} onClick={() => onPageChange(page + 1)}>
        <Icon name="next" />
      </button>
      <span className="pdf-toolbar-separator" />
      <button type="button" title="Zoom out" disabled={!previewAvailable} onClick={() => onZoomChange(Math.max(25, numericZoom - 10))}>
        <Icon name="zoomOut" />
      </button>
      {typeof zoom === 'number' && <span className="pdf-zoom-value">{zoom}%</span>}
      <button type="button" title="Zoom in" disabled={!previewAvailable} onClick={() => onZoomChange(Math.min(300, numericZoom + 10))}>
        <Icon name="zoomIn" />
      </button>
      <button type="button" title="Fit to width" disabled={!previewAvailable} onClick={() => onZoomChange('width')}>
        <Icon name="fitWidth" />
      </button>
      <button type="button" title="Fit whole page" disabled={!previewAvailable} onClick={() => onZoomChange('page')}>
        <Icon name="fitPage" />
      </button>
      {rotationEnabled && (
        <button type="button" title="Rotate clockwise" disabled={!previewAvailable} onClick={onRotate}>
          <Icon name="rotate" />
        </button>
      )}
      <span className="pdf-toolbar-separator" />
      <button type="button" title="Print PDF" disabled={!pdfUrl || printing} onClick={onPrint}>
        <Icon name="print" />
      </button>
      <a
        href={pdfUrl}
        download={fileName}
        title={`Download ${fileName}`}
        className={!pdfUrl ? 'disabled' : ''}
        onClick={(event) => {
          if (!pdfUrl) event.preventDefault()
        }}
      >
        <Icon name="download" />
      </a>
    </div>
  )
}
