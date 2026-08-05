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
  pdfFileName,
  previewRoots,
  onPreviewRootChange,
  onSourceChange,
  vimEnabled,
  previewPositions,
  previewStatus,
  sourceReveal,
  onCursorPositionChange,
  onPreviewPoint,
  onCursorChange,
  showPreviewPosition,
  previewClickNavigationEnabled,
  canvasPreviewEnabled,
  autoScrollEnabled,
  lightThemeEnabled,
  foldingEnabled,
  autocompleteEnabled,
  semanticHighlightingEnabled,
  languageServerReady,
  errorHighlightingEnabled,
  previewRenderBackoffMs,
  compilationOpen,
  onSave,
  onDeleteFile,
  bibliographies,
  languageServerDocuments,
}: {
  document: EditorDocument
  pdfFileName: string
  previewRoots?: PreviewRoot[]
  onPreviewRootChange(filePath: string): void
  onSourceChange(value: string): void
  vimEnabled: boolean
  previewPositions: PreviewPosition[]
  previewStatus: SourceSyncStatus
  sourceReveal?: PreviewSourceReveal
  onCursorPositionChange(location: SourceCursorLocation): void
  onPreviewPoint(position: PreviewPosition): void
  onCursorChange(line: number, column: number): void
  showPreviewPosition: boolean
  previewClickNavigationEnabled: boolean
  canvasPreviewEnabled: boolean
  autoScrollEnabled: boolean
  lightThemeEnabled: boolean
  foldingEnabled: boolean
  autocompleteEnabled: boolean
  semanticHighlightingEnabled: boolean
  languageServerReady: boolean
  errorHighlightingEnabled: boolean
  previewRenderBackoffMs: number
  compilationOpen: boolean
  onSave(): void
  onDeleteFile(): void
  bibliographies: BibliographiesController
  languageServerDocuments: LanguageServerDocument[]
}) {
  const [leftPanePercent, setLeftPanePercent] = useState(50)
  const [sourceEditorPercent, setSourceEditorPercent] = useState(62)
  const [bibliographyMaximized, setBibliographyMaximized] = useState(false)
  const workspaceRef = useRef<HTMLElement>(null)
  const editorStackRef = useRef<HTMLDivElement>(null)
  const previewRootChangeRef = useRef(onPreviewRootChange)
  const previewPointRef = useRef(onPreviewPoint)
  const stablePreviewRootChangeRef = useRef<((filePath: string) => void) | null>(null)
  const stablePreviewPointRef = useRef<((position: PreviewPosition) => void) | null>(null)
  previewRootChangeRef.current = onPreviewRootChange
  previewPointRef.current = onPreviewPoint
  stablePreviewRootChangeRef.current ??= (filePath) => previewRootChangeRef.current(filePath)
  stablePreviewPointRef.current ??= (position) => previewPointRef.current(position)
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
            semanticHighlightingEnabled={semanticHighlightingEnabled}
            languageServerReady={languageServerReady}
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
            onCreateBibliography={() => void bibliographies.createDefault()}
            bibliographyCreating={bibliographies.creating}
            canCreateBibliography={bibliographies.canCreateDefault}
            defaultBibliographyExists={bibliographies.defaultBibliographyExists}
            fileActionBusy={bibliographies.isBusy()}
            onDeleteFile={onDeleteFile}
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
          pdfFileName={pdfFileName}
          previewRoots={previewRoots}
          onPreviewRootChange={stablePreviewRootChangeRef.current}
          positions={previewPositions}
          status={previewStatus}
          showPreviewPosition={!canvasPreviewEnabled && showPreviewPosition}
          previewClickNavigationEnabled={!canvasPreviewEnabled && previewClickNavigationEnabled}
          canvasPreviewEnabled={canvasPreviewEnabled}
          autoScrollEnabled={autoScrollEnabled}
          renderBackoffMs={previewRenderBackoffMs}
          onPreviewPoint={stablePreviewPointRef.current}
          key={`${document.id}:${document.previewRootPath ?? document.filePath ?? ''}`}
        />
        {compilationOpen && <CompilationPane document={document} />}
      </section>
    </section>
  )
}
