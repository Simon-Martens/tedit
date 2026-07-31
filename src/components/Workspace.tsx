import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { EditorDocument, LanguageServerDocument, PreviewPosition, PreviewRoot, PreviewSourceReveal, SourceCursorLocation, SourceSyncStatus } from '../types'
import type { BibliographiesController } from '../hooks/useBibliographies'
import { BibliographyPane } from './BibliographyPane'
import { CompilationPane } from './CompilationPane'
import { TypstPreview } from './TypstPreview'
import { SourcePane } from './SourcePane'

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function Workspace({
  document,
  previewRoots,
  onPreviewRootChange,
  onSourceChange,
  vimEnabled,
  previewPositions,
  previewStatus,
  sourceCursorLocation,
  sourceReveal,
  onCursorPositionChange,
  onPreviewPoint,
  onCursorChange,
  showPreviewPosition,
  autoScrollEnabled,
  lightThemeEnabled,
  foldingEnabled,
  autocompleteEnabled,
  errorHighlightingEnabled,
  compilationOpen,
  onSave,
  bibliographies,
  languageServerDocuments,
}: {
  document: EditorDocument
  previewRoots?: PreviewRoot[]
  onPreviewRootChange(filePath: string): void
  onSourceChange(value: string): void
  vimEnabled: boolean
  previewPositions: PreviewPosition[]
  previewStatus: SourceSyncStatus
  sourceCursorLocation?: SourceCursorLocation
  sourceReveal?: PreviewSourceReveal
  onCursorPositionChange(location: SourceCursorLocation): void
  onPreviewPoint(position: PreviewPosition): void
  onCursorChange(line: number, column: number): void
  showPreviewPosition: boolean
  autoScrollEnabled: boolean
  lightThemeEnabled: boolean
  foldingEnabled: boolean
  autocompleteEnabled: boolean
  errorHighlightingEnabled: boolean
  compilationOpen: boolean
  onSave(): void
  bibliographies: BibliographiesController
  languageServerDocuments: LanguageServerDocument[]
}) {
  const [leftPanePercent, setLeftPanePercent] = useState(50)
  const [sourceEditorPercent, setSourceEditorPercent] = useState(62)
  const [bibliographyMaximized, setBibliographyMaximized] = useState(false)
  const workspaceRef = useRef<HTMLElement>(null)
  const editorStackRef = useRef<HTMLDivElement>(null)
  const layoutVersion = leftPanePercent
    + sourceEditorPercent
    + (bibliographyMaximized ? 2000 : 0)

  useEffect(() => {
    if (!bibliographies.open) setBibliographyMaximized(false)
  }, [document.id, bibliographies.open])

  const resizeColumns = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const bounds = workspaceRef.current?.getBoundingClientRect()
    if (!bounds) return
    setLeftPanePercent(clamp(((event.clientX - bounds.left) / bounds.width) * 100, 25, 75))
  }

  const resizeEditorRows = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const bounds = editorStackRef.current?.getBoundingClientRect()
    if (!bounds) return
    setSourceEditorPercent(clamp(((event.clientY - bounds.top) / bounds.height) * 100, 30, 75))
  }

  const resizeColumnsWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const change = event.key === 'ArrowRight' ? 2 : -2
    setLeftPanePercent((current) => clamp(current + change, 25, 75))
  }

  const resizeEditorWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    setSourceEditorPercent((current) => clamp(current + (event.key === 'ArrowDown' ? 2 : -2), 30, 75))
  }

  return (
    <section
      className="workspace"
      ref={workspaceRef}
      style={{ '--left-pane-size': `${leftPanePercent}%` } as CSSProperties}
    >
      <section aria-label="Editor" className="left-pane">
        <div
          ref={editorStackRef}
          className={`editor-stack${bibliographies.open ? ' bibliography-open' : ''}${bibliographyMaximized ? ' bibliography-maximized' : ''}`}
          style={{ '--source-editor-size': `${sourceEditorPercent}%` } as CSSProperties}
        >
          <SourcePane
            document={document}
            onChange={onSourceChange}
            layoutVersion={layoutVersion}
            vimEnabled={vimEnabled}
            lightThemeEnabled={lightThemeEnabled}
            foldingEnabled={foldingEnabled}
            autocompleteEnabled={autocompleteEnabled}
            errorHighlightingEnabled={errorHighlightingEnabled}
            onCursorPositionChange={onCursorPositionChange}
            sourceReveal={sourceReveal}
            onCursorChange={onCursorChange}
            onSave={onSave}
            bibliographies={bibliographies.files}
            languageServerDocuments={languageServerDocuments}
            bibliographyOpen={bibliographies.open}
            selectedBibliography={bibliographies.selectedFile}
            onSelectBibliography={bibliographies.select}
            onToggleBibliography={bibliographies.toggle}
          />
          {bibliographies.open && bibliographies.selectedFile && (
            <>
              {!bibliographyMaximized && (
                <div
                  className="pane-resizer row-resizer bibliography-resizer"
                  role="separator"
                  aria-label="Resize source and bibliography panes"
                  aria-orientation="horizontal"
                  aria-valuemin={30}
                  aria-valuemax={75}
                  aria-valuenow={Math.round(sourceEditorPercent)}
                  tabIndex={0}
                  onKeyDown={resizeEditorWithKeyboard}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  onPointerMove={resizeEditorRows}
                />
              )}
              <BibliographyPane
                key={bibliographies.selectedFile.id}
                file={bibliographies.selectedFile}
                layoutVersion={layoutVersion}
                lightThemeEnabled={lightThemeEnabled}
                saving={bibliographies.saving}
                maximized={bibliographyMaximized}
                onChange={bibliographies.changeContent}
                onSave={() => void bibliographies.save()}
                onToggleMaximized={() => setBibliographyMaximized((current) => !current)}
                onClose={() => {
                  setBibliographyMaximized(false)
                  bibliographies.close()
                }}
              />
            </>
          )}
        </div>
      </section>
      <div
        className="pane-resizer column-resizer"
        role="separator"
        aria-label="Resize editor and Typst preview panes"
        aria-orientation="vertical"
        aria-valuemin={25}
        aria-valuemax={75}
        aria-valuenow={Math.round(leftPanePercent)}
        tabIndex={0}
        onKeyDown={resizeColumnsWithKeyboard}
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={resizeColumns}
      />
      <section
        aria-label="Typst preview and compilation output"
        className={`right-pane ${compilationOpen ? 'output-open' : 'output-hidden'}`}
      >
        <TypstPreview
          document={document}
          previewRoots={previewRoots}
          onPreviewRootChange={onPreviewRootChange}
          positions={previewPositions}
          status={previewStatus}
          showPreviewPosition={showPreviewPosition}
          autoScrollEnabled={autoScrollEnabled}
          onPreviewPoint={onPreviewPoint}
          key={`${document.id}:${document.previewRootPath ?? document.filePath ?? ''}`}
        />
        {compilationOpen && <CompilationPane document={document} />}
      </section>
    </section>
  )
}
