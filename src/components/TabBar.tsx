import { Icon } from './Icon'
import type { EditorDocument } from '../types'

interface TabBarProps {
  documents: EditorDocument[]
  activeId: string
  onActivate(id: string): void
  onClose(id: string): void
  onNew(): void
}

export function TabBar({ documents, activeId, onActivate, onClose, onNew }: TabBarProps) {
  return (
    <nav className="tab-bar" aria-label="Open documents">
      <div className="tab-list" role="tablist">
        {documents.map((document) => (
          <button
            className={`document-tab ${document.id === activeId ? 'active' : ''}`}
            type="button"
            role="tab"
            aria-selected={document.id === activeId}
            key={document.id}
            onClick={() => onActivate(document.id)}
          >
            <Icon name="file" />
            <span className="tab-name">{document.fileName}</span>
            {document.isDirty && <span className="tab-dirty" aria-label="Unsaved changes" />}
            <span
              className="tab-close"
              role="button"
              tabIndex={0}
              aria-label={`Close ${document.fileName}`}
              onClick={(event) => {
                event.stopPropagation()
                onClose(document.id)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                onClose(document.id)
              }}
            >
              <Icon name="close" />
            </span>
          </button>
        ))}
      </div>
      <button className="new-tab" type="button" aria-label="New document" onClick={onNew}>
        <Icon name="plus" />
      </button>
    </nav>
  )
}
