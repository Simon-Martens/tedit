import { Icon } from './Icon'
import { SettingsMenu } from './SettingsMenu'
import type { EditorDocument } from '../types'
import teditLogo from '../../build/icon.svg'

interface ToolbarProps {
  document?: EditorDocument
  pdfFileName?: string
  onOpen(): void
  onSave(): void
  docsOpen: boolean
  docsAvailable: boolean
  onToggleDocs(): void
  vimEnabled: boolean
  onVimEnabledChange(enabled: boolean): void
  showPreviewPosition: boolean
  onShowPreviewPositionChange(enabled: boolean): void
  autoScrollEnabled: boolean
  onAutoScrollEnabledChange(enabled: boolean): void
  lightThemeEnabled: boolean
  onLightThemeEnabledChange(enabled: boolean): void
  foldingEnabled: boolean
  onFoldingEnabledChange(enabled: boolean): void
  autocompleteEnabled: boolean
  onAutocompleteEnabledChange(enabled: boolean): void
  errorHighlightingEnabled: boolean
  onErrorHighlightingEnabledChange(enabled: boolean): void
}

export function Toolbar({
  document,
  pdfFileName,
  onOpen,
  onSave,
  docsOpen,
  docsAvailable,
  onToggleDocs,
  vimEnabled,
  onVimEnabledChange,
  showPreviewPosition,
  onShowPreviewPositionChange,
  autoScrollEnabled,
  onAutoScrollEnabledChange,
  lightThemeEnabled,
  onLightThemeEnabledChange,
  foldingEnabled,
  onFoldingEnabledChange,
  autocompleteEnabled,
  onAutocompleteEnabledChange,
  errorHighlightingEnabled,
  onErrorHighlightingEnabledChange,
}: ToolbarProps) {
  const documentTitle = document
    ? [document.repoName, document.fileName].filter(Boolean).join(' / ')
    : 'No document'

  return (
    <header className="topbar">
      <div className="brand" aria-label="tedit">
        <img className="brand-mark" src={teditLogo} alt="" />
        <span>tedit</span>
      </div>
      <div className="document-title">
        <Icon name="file" />
        <span>{documentTitle}</span>
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
        <button
          type="button"
          className={`docs-toggle ${docsOpen ? 'active' : ''}`}
          title={docsAvailable ? 'Open offline Typst documentation' : 'Offline documentation is available in the desktop app'}
          aria-label="Typst documentation"
          aria-pressed={docsOpen}
          disabled={!docsAvailable}
          onClick={onToggleDocs}
        >
          <Icon name="help" />
        </button>
        <SettingsMenu
          vimEnabled={vimEnabled}
          onVimEnabledChange={onVimEnabledChange}
          showPreviewPosition={showPreviewPosition}
          onShowPreviewPositionChange={onShowPreviewPositionChange}
          autoScrollEnabled={autoScrollEnabled}
          onAutoScrollEnabledChange={onAutoScrollEnabledChange}
          lightThemeEnabled={lightThemeEnabled}
          onLightThemeEnabledChange={onLightThemeEnabledChange}
          foldingEnabled={foldingEnabled}
          onFoldingEnabledChange={onFoldingEnabledChange}
          autocompleteEnabled={autocompleteEnabled}
          onAutocompleteEnabledChange={onAutocompleteEnabledChange}
          errorHighlightingEnabled={errorHighlightingEnabled}
          onErrorHighlightingEnabledChange={onErrorHighlightingEnabledChange}
        />
      </div>
    </header>
  )
}
