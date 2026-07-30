import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import typstLogo from '../assets/typst-logo.svg'
import { createDocument } from '../lib/documents'
import { PdfPreview } from './PdfPreview'

function PrintDocumentation() {
  const [document] = useState(() => ({
    ...createDocument({ fileName: 'typst-documentation.typ' }),
    compileState: 'success' as const,
    messages: [],
    pdfUrl: 'tedit-docs://docs/print/docs.pdf',
  }))

  return (
    <div className="docs-print-view">
      <PdfPreview
        document={document}
        onPreviewRootChange={() => undefined}
        positions={[]}
        showPreviewPosition={false}
        autoScrollEnabled={false}
        headingLabel="Print edition"
      />
    </div>
  )
}

export function DocsView({ open, onClose }: { open: boolean; onClose(): void }) {
  const [format, setFormat] = useState<'web' | 'print'>('web')

  useEffect(() => {
    setFormat('web')
  }, [open])

  return (
    <section className={`docs-view ${open ? 'open' : 'closed'}`} aria-label="Typst documentation" aria-hidden={!open}>
      <header className="docs-view-header">
        <div className="docs-view-title">
          <a
            className="docs-home-link"
            href="tedit-docs://docs/?tedit-home=1"
            target="tedit-docs-frame"
            title="Documentation home"
            onClick={() => setFormat('web')}
          >
            <img className="docs-logo" src={typstLogo} alt="Typst" />
          </a>
          <span className="docs-title-separator" aria-hidden="true">/</span>
          <strong>Documentation</strong>
          <span className="docs-offline-badge">Offline</span>
        </div>
        <div className="docs-view-actions">
          <div className="docs-format-switch" role="tablist" aria-label="Documentation format">
            <button
              type="button"
              className={`docs-format-button${format === 'web' ? ' active' : ''}`}
              role="tab"
              aria-selected={format === 'web'}
              onClick={() => setFormat('web')}
            >
              Web
            </button>
            <button
              type="button"
              className={`docs-format-button${format === 'print' ? ' active' : ''}`}
              role="tab"
              aria-selected={format === 'print'}
              onClick={() => setFormat('print')}
            >
              Print
            </button>
          </div>
          <button type="button" title="Close documentation" aria-label="Close documentation" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
      </header>
      <iframe
        className={format === 'web' ? '' : 'docs-content-hidden'}
        name="tedit-docs-frame"
        src="tedit-docs://docs/"
        title="Offline Typst documentation"
      />
      {format === 'print' && open && <PrintDocumentation />}
    </section>
  )
}
