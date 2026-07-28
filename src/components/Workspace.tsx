import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { EditorDocument, PreviewPosition, SourceCursorLocation, SourceSyncStatus } from '../types'
import { CompilationPane } from './CompilationPane'
import { PdfPreview } from './PdfPreview'
import { SourcePane } from './SourcePane'

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

export function Workspace({
  document,
  onSourceChange,
  vimEnabled,
  previewPositions,
  sourceCursorLocation,
  sourceSyncStatus,
  onCursorPositionChange,
  onCursorChange,
  showPreviewPosition,
  autoScrollEnabled,
  lightThemeEnabled,
  foldingEnabled,
  compilationOpen,
  onSave,
}: {
  document: EditorDocument
  onSourceChange(value: string): void
  vimEnabled: boolean
  previewPositions: PreviewPosition[]
  sourceCursorLocation?: SourceCursorLocation
  sourceSyncStatus: SourceSyncStatus
  onCursorPositionChange(location: SourceCursorLocation): void
  onCursorChange(line: number, column: number): void
  showPreviewPosition: boolean
  autoScrollEnabled: boolean
  lightThemeEnabled: boolean
  foldingEnabled: boolean
  compilationOpen: boolean
  onSave(): void
}) {
  const [leftPanePercent, setLeftPanePercent] = useState(50)
  const [sourcePanePercent, setSourcePanePercent] = useState(67)
  const workspaceRef = useRef<HTMLElement>(null)
  const leftPaneRef = useRef<HTMLElement>(null)
  const layoutVersion = leftPanePercent
    + sourcePanePercent
    + (compilationOpen ? 1000 : 0)

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
          ? document.compileState === 'error' ? 'output-error' : 'output-expanded'
          : 'output-hidden'}`}
        style={{
          '--source-pane-size': `${sourcePanePercent}%`,
        } as CSSProperties}
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
        />
        {compilationOpen && (
          <>
            {document.compileState === 'error' ? (
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
        positions={previewPositions}
        sourceCursorLocation={sourceCursorLocation}
        sourceSyncStatus={sourceSyncStatus}
        showPreviewPosition={showPreviewPosition}
        autoScrollEnabled={autoScrollEnabled}
        key={document.id}
      />
    </section>
  )
}
