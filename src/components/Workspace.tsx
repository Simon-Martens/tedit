import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react'
import type { EditorDocument } from '../types'
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
}: {
  document: EditorDocument
  onSourceChange(value: string): void
  vimEnabled: boolean
}) {
  const [leftPanePercent, setLeftPanePercent] = useState(50)
  const [sourcePanePercent, setSourcePanePercent] = useState(67)
  const [outputExpanded, setOutputExpanded] = useState(false)
  const workspaceRef = useRef<HTMLElement>(null)
  const leftPaneRef = useRef<HTMLElement>(null)
  const automaticOutputHeight = document.compileState === 'error'
    ? Math.min(260, 56 + document.messages.length * 19)
    : 31
  const layoutVersion = leftPanePercent
    + sourcePanePercent
    + automaticOutputHeight
    + (outputExpanded ? 1000 : 0)

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
        className={`left-pane ${outputExpanded ? 'output-expanded' : 'output-auto'}`}
        style={{
          '--source-pane-size': `${sourcePanePercent}%`,
          '--output-pane-size': `${automaticOutputHeight}px`,
        } as CSSProperties}
      >
        <SourcePane
          document={document}
          onChange={onSourceChange}
          layoutVersion={layoutVersion}
          vimEnabled={vimEnabled}
        />
        {outputExpanded ? (
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
        ) : <div className="output-auto-divider" />}
        <CompilationPane
          document={document}
          expanded={outputExpanded}
          onToggleExpanded={() => setOutputExpanded((current) => !current)}
        />
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
      <PdfPreview document={document} key={document.id} />
    </section>
  )
}
