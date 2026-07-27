import { Icon } from './Icon'
import { SettingsMenu } from './SettingsMenu'
import type { EditorDocument } from '../types'

interface ToolbarProps {
  document?: EditorDocument
  pdfFileName?: string
  onOpen(): void
  onSave(): void
  vimEnabled: boolean
  onVimEnabledChange(enabled: boolean): void
}

export function Toolbar({
  document,
  pdfFileName,
  onOpen,
  onSave,
  vimEnabled,
  onVimEnabledChange,
}: ToolbarProps) {
  return (
    <header className="topbar">
      <div className="brand" aria-label="Typst Edit">
        <span className="brand-mark">T/</span>
        <span>Typst Edit</span>
      </div>
      <div className="document-title">
        <Icon name="file" />
        <span>{document?.fileName ?? 'No document'}</span>
        {document?.isDirty && <span className="dirty-dot" title="Unsaved changes" />}
      </div>
      <div className="toolbar">
        <button type="button" onClick={onOpen}>
          <Icon name="open" />
          <span>Open</span>
        </button>
        <button type="button" onClick={onSave} disabled={!document}>
          <Icon name="save" />
          <span>Save</span>
        </button>
        <a
          className={document?.pdfUrl ? 'button-link' : 'button-link disabled'}
          href={document?.pdfUrl}
          download={pdfFileName}
          title={pdfFileName ? `Download ${pdfFileName}` : 'No PDF available'}
          aria-disabled={!document?.pdfUrl}
          onClick={(event) => {
            if (!document?.pdfUrl) event.preventDefault()
          }}
        >
          <Icon name="download" />
          <span>PDF</span>
        </a>
        <SettingsMenu vimEnabled={vimEnabled} onVimEnabledChange={onVimEnabledChange} />
      </div>
    </header>
  )
}
