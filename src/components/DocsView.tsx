import { Icon } from './Icon'
import typstLogo from '../assets/typst-logo.svg'

export function DocsView({ open, onClose }: { open: boolean; onClose(): void }) {
  return (
    <section className={`docs-view ${open ? 'open' : 'closed'}`} aria-label="Typst documentation" aria-hidden={!open}>
      <header className="docs-view-header">
        <div className="docs-view-title">
          <a
            className="docs-home-link"
            href="tedit-docs://docs/?tedit-home=1"
            target="tedit-docs-frame"
            title="Documentation home"
          >
            <img className="docs-logo" src={typstLogo} alt="Typst" />
          </a>
          <span className="docs-title-separator" aria-hidden="true">/</span>
          <strong>Documentation</strong>
          <span className="docs-offline-badge">Offline</span>
        </div>
        <button type="button" title="Close documentation" aria-label="Close documentation" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <iframe name="tedit-docs-frame" src="tedit-docs://docs/" title="Offline Typst documentation" />
    </section>
  )
}
