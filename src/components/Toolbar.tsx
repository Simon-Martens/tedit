import { memo, useRef } from 'react'
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
  semanticHighlightingEnabled: boolean
  onSemanticHighlightingEnabledChange(enabled: boolean): void
  errorHighlightingEnabled: boolean
  onErrorHighlightingEnabledChange(enabled: boolean): void
  automaticErrorPopupEnabled: boolean
  onAutomaticErrorPopupEnabledChange(enabled: boolean): void
  previewRenderBackoffMs: number
  onPreviewRenderBackoffMsChange(value: number): void
}

function useLatestCallback<Arguments extends unknown[]>(callback: (...arguments_: Arguments) => void) {
  const callbackRef = useRef(callback)
  const stableCallbackRef = useRef<((...arguments_: Arguments) => void) | null>(null)
  callbackRef.current = callback
  stableCallbackRef.current ??= (...arguments_) => callbackRef.current(...arguments_)
  return stableCallbackRef.current
}

function ToolbarContent({
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
  semanticHighlightingEnabled,
  onSemanticHighlightingEnabledChange,
  errorHighlightingEnabled,
  onErrorHighlightingEnabledChange,
  automaticErrorPopupEnabled,
  onAutomaticErrorPopupEnabledChange,
  previewRenderBackoffMs,
  onPreviewRenderBackoffMsChange,
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
          semanticHighlightingEnabled={semanticHighlightingEnabled}
          onSemanticHighlightingEnabledChange={onSemanticHighlightingEnabledChange}
          errorHighlightingEnabled={errorHighlightingEnabled}
          onErrorHighlightingEnabledChange={onErrorHighlightingEnabledChange}
          automaticErrorPopupEnabled={automaticErrorPopupEnabled}
          onAutomaticErrorPopupEnabledChange={onAutomaticErrorPopupEnabledChange}
          previewRenderBackoffMs={previewRenderBackoffMs}
          onPreviewRenderBackoffMsChange={onPreviewRenderBackoffMsChange}
        />
      </div>
    </header>
  )
}

const MemoizedToolbar = memo(ToolbarContent, (previous, next) => (
  previous.document?.id === next.document?.id
  && previous.document?.fileName === next.document?.fileName
  && previous.document?.repoName === next.document?.repoName
  && previous.document?.isDirty === next.document?.isDirty
  && previous.document?.pdfUrl === next.document?.pdfUrl
  && previous.pdfFileName === next.pdfFileName
  && previous.docsOpen === next.docsOpen
  && previous.docsAvailable === next.docsAvailable
  && previous.vimEnabled === next.vimEnabled
  && previous.showPreviewPosition === next.showPreviewPosition
  && previous.autoScrollEnabled === next.autoScrollEnabled
  && previous.lightThemeEnabled === next.lightThemeEnabled
  && previous.foldingEnabled === next.foldingEnabled
  && previous.autocompleteEnabled === next.autocompleteEnabled
  && previous.semanticHighlightingEnabled === next.semanticHighlightingEnabled
  && previous.errorHighlightingEnabled === next.errorHighlightingEnabled
  && previous.automaticErrorPopupEnabled === next.automaticErrorPopupEnabled
  && previous.previewRenderBackoffMs === next.previewRenderBackoffMs
))

export function Toolbar(props: ToolbarProps) {
  const onOpen = useLatestCallback(props.onOpen)
  const onSave = useLatestCallback(props.onSave)
  const onToggleDocs = useLatestCallback(props.onToggleDocs)
  const onVimEnabledChange = useLatestCallback(props.onVimEnabledChange)
  const onShowPreviewPositionChange = useLatestCallback(props.onShowPreviewPositionChange)
  const onAutoScrollEnabledChange = useLatestCallback(props.onAutoScrollEnabledChange)
  const onLightThemeEnabledChange = useLatestCallback(props.onLightThemeEnabledChange)
  const onFoldingEnabledChange = useLatestCallback(props.onFoldingEnabledChange)
  const onAutocompleteEnabledChange = useLatestCallback(props.onAutocompleteEnabledChange)
  const onSemanticHighlightingEnabledChange = useLatestCallback(props.onSemanticHighlightingEnabledChange)
  const onErrorHighlightingEnabledChange = useLatestCallback(props.onErrorHighlightingEnabledChange)
  const onAutomaticErrorPopupEnabledChange = useLatestCallback(props.onAutomaticErrorPopupEnabledChange)
  const onPreviewRenderBackoffMsChange = useLatestCallback(props.onPreviewRenderBackoffMsChange)

  return <MemoizedToolbar
    {...props}
    onOpen={onOpen}
    onSave={onSave}
    onToggleDocs={onToggleDocs}
    onVimEnabledChange={onVimEnabledChange}
    onShowPreviewPositionChange={onShowPreviewPositionChange}
    onAutoScrollEnabledChange={onAutoScrollEnabledChange}
    onLightThemeEnabledChange={onLightThemeEnabledChange}
    onFoldingEnabledChange={onFoldingEnabledChange}
    onAutocompleteEnabledChange={onAutocompleteEnabledChange}
    onSemanticHighlightingEnabledChange={onSemanticHighlightingEnabledChange}
    onErrorHighlightingEnabledChange={onErrorHighlightingEnabledChange}
    onAutomaticErrorPopupEnabledChange={onAutomaticErrorPopupEnabledChange}
    onPreviewRenderBackoffMsChange={onPreviewRenderBackoffMsChange}
  />
}
