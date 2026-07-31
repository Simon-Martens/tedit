import { useEffect, useRef, useState } from 'react'
import { Icon } from './Icon'

export function SettingsMenu({
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
  automaticErrorPopupEnabled,
  onAutomaticErrorPopupEnabledChange,
  previewRenderBackoffMs,
  onPreviewRenderBackoffMsChange,
}: {
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
  automaticErrorPopupEnabled: boolean
  onAutomaticErrorPopupEnabledChange(enabled: boolean): void
  previewRenderBackoffMs: number
  onPreviewRenderBackoffMsChange(value: number): void
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const closeMenu = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', closeMenu)
    window.addEventListener('keydown', closeWithEscape)
    return () => {
      window.removeEventListener('mousedown', closeMenu)
      window.removeEventListener('keydown', closeWithEscape)
    }
  }, [open])

  return (
    <div className="settings-menu" ref={menuRef}>
      <button
        className={open ? 'settings-trigger active' : 'settings-trigger'}
        type="button"
        title="Settings"
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="settings" />
      </button>
      {open && (
        <div className="settings-popover" role="dialog" aria-label="Editor settings">
          <div className="settings-popover-title">Editor settings</div>
          <label className="setting-row">
            <span>
              <strong>Light color scheme</strong>
              <small>Use a light theme throughout the app</small>
            </span>
            <input
              type="checkbox"
              checked={lightThemeEnabled}
              onChange={(event) => onLightThemeEnabledChange(event.target.checked)}
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Preview backoff</strong>
              <small>Wait after edits before rendering (ms)</small>
            </span>
            <input
              className="setting-number"
              type="number"
              min={0}
              max={5000}
              step={50}
              value={previewRenderBackoffMs}
              onChange={(event) => {
                if (Number.isFinite(event.target.valueAsNumber)) {
                  onPreviewRenderBackoffMsChange(event.target.valueAsNumber)
                }
              }}
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Vim mode</strong>
              <small>Vim motions and commands</small>
            </span>
            <input
              type="checkbox"
              checked={vimEnabled}
              onChange={(event) => onVimEnabledChange(event.target.checked)}
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Code folding</strong>
              <small>Collapse multiline Typst blocks</small>
            </span>
            <input
              type="checkbox"
              checked={foldingEnabled}
              onChange={(event) => onFoldingEnabledChange(event.target.checked)}
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Autocomplete</strong>
              <small>Show Tinymist code suggestions</small>
            </span>
            <input
              type="checkbox"
              checked={autocompleteEnabled}
              onChange={(event) => onAutocompleteEnabledChange(event.target.checked)}
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Error highlighting</strong>
              <small>Underline diagnostics in the source</small>
            </span>
            <input
              type="checkbox"
              checked={errorHighlightingEnabled}
              onChange={(event) => onErrorHighlightingEnabledChange(event.target.checked)}
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Auto Error Popup</strong>
              <small>Open compilation output when errors occur</small>
            </span>
            <input
              type="checkbox"
              checked={automaticErrorPopupEnabled}
              onChange={(event) => onAutomaticErrorPopupEnabledChange(event.target.checked)}
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Show position</strong>
              <small>Display the PDF source marker</small>
            </span>
            <input
              type="checkbox"
              checked={showPreviewPosition}
              onChange={(event) => onShowPreviewPositionChange(event.target.checked)}
            />
          </label>
          <label className="setting-row">
            <span>
              <strong>Autoscroll</strong>
              <small>Follow the editor position in the PDF</small>
            </span>
            <input
              type="checkbox"
              checked={autoScrollEnabled}
              onChange={(event) => onAutoScrollEnabledChange(event.target.checked)}
            />
          </label>
        </div>
      )}
    </div>
  )
}
