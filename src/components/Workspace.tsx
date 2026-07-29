import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { EditorDocument, LanguageServerDocument, PreviewPosition, PreviewRoot, SourceCursorLocation } from '../types'
import type { BibliographiesController } from '../hooks/useBibliographies'
import { BibliographyPane } from './BibliographyPane'
import { CompilationPane } from './CompilationPane'
import { PdfPreview } from './PdfPreview'
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
  sourceCursorLocation,
  onCursorPositionChange,
  onCursorChange,
  showPreviewPosition,
  autoScrollEnabled,
  lightThemeEnabled,
  foldingEnabled,
  compilationOpen,
  compilationAutoSized,
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
  sourceCursorLocation?: SourceCursorLocation
  onCursorPositionChange(location: SourceCursorLocation): void
  onCursorChange(line: number, column: number): void
  showPreviewPosition: boolean
  autoScrollEnabled: boolean
  lightThemeEnabled: boolean
  foldingEnabled: boolean
  compilationOpen: boolean
  compilationAutoSized: boolean
  onSave(): void
  bibliographies: BibliographiesController
  languageServerDocuments: LanguageServerDocument[]
}) {
  const [leftPanePercent, setLeftPanePercent] = useState(50)
  const [sourcePanePercent, setSourcePanePercent] = useState(67)
  const [sourceEditorPercent, setSourceEditorPercent] = useState(62)
  const [bibliographyMaximized, setBibliographyMaximized] = useState(false)
  const workspaceRef = useRef<HTMLElement>(null)
  const leftPaneRef = useRef<HTMLElement>(null)
  const editorStackRef = useRef<HTMLDivElement>(null)
  const layoutVersion = leftPanePercent
    + sourcePanePercent
    + sourceEditorPercent
    + (compilationOpen ? 1000 : 0)
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

  const resizeRows = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const bounds = leftPaneRef.current?.getBoundingClientRect()
    if (!bounds) return
    setSourcePanePercent(clamp(((event.clientY - bounds.top) / bounds.height) * 100, 35, 80))
  }

  const resizeEditorRows = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const bounds = editorStackRef.current?.getBoundingClientRect()
    if (!bounds) return
    setSourceEditorPercent(clamp(((event.clientY - bounds.top) / bounds.height) * 100, 30, 75))
  }

  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>, axis: 'columns' | 'rows') => {
    const decreaseKey = axis === 'columns' ? 'ArrowLeft' : 'ArrowUp'
    const increaseKey = axis === 'columns' ? 'ArrowRight' : 'ArrowDown'
    if (event.key !== decreaseKey && event.key !== increaseKey) return
    event.preventDefault()
    const change = event.key === increaseKey ? 2 : -2
    if (axis === 'columns') {
      setLeftPanePercent((current) => clamp(current + change, 25, 75))
    } else {
      setSourcePanePercent((current) => clamp(current + change, 35, 80))
    }
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
      <section
        aria-label="Editor and compilation output"
        ref={leftPaneRef}
        className={`left-pane ${compilationOpen
          ? compilationAutoSized ? 'output-error' : 'output-expanded'
          : 'output-hidden'}`}
        style={{
          '--source-pane-size': `${sourcePanePercent}%`,
        } as CSSProperties}
      >
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
            onCursorPositionChange={onCursorPositionChange}
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
        {compilationOpen && (
          <>
            {compilationAutoSized ? (
              <div className="output-auto-divider" />
            ) : (
              <div
                className="pane-resizer row-resizer"
                role="separator"
                aria-label="Resize source and compilation panes"
                aria-orientation="horizontal"
                aria-valuemin={35}
                aria-valuemax={80}
                aria-valuenow={Math.round(sourcePanePercent)}
                tabIndex={0}
                onKeyDown={(event) => resizeWithKeyboard(event, 'rows')}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={resizeRows}
              />
            )}
            <CompilationPane document={document} />
          </>
        )}
      </section>
      <div
        className="pane-resizer column-resizer"
        role="separator"
        aria-label="Resize editor and PDF preview panes"
        aria-orientation="vertical"
        aria-valuemin={25}
        aria-valuemax={75}
        aria-valuenow={Math.round(leftPanePercent)}
        tabIndex={0}
        onKeyDown={(event) => resizeWithKeyboard(event, 'columns')}
        onPointerDown={(event) => {
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={resizeColumns}
      />
      <PdfPreview
        document={document}
        previewRoots={previewRoots}
        onPreviewRootChange={onPreviewRootChange}
        positions={previewPositions}
        sourceCursorLocation={sourceCursorLocation}
        showPreviewPosition={showPreviewPosition}
        autoScrollEnabled={autoScrollEnabled}
        key={document.id}
      />
    </section>
  )
}
