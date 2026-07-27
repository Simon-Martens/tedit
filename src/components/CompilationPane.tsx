import { Icon } from './Icon'
import type { EditorDocument } from '../types'

export function CompilationPane({
  document,
  expanded,
  onToggleExpanded,
}: {
  document: EditorDocument
  expanded: boolean
  onToggleExpanded(): void
}) {
  return (
    <div className="output-panel">
      <div className="panel-heading">
        <span>Compilation</span>
        <div className="panel-actions">
          <span className={`status status-${document.compileState}`}>
            <i />
            {document.compileState === 'loading' ? 'Starting' : document.compileState}
          </span>
          {document.compileState === 'success' && document.compileDurationMs !== undefined && (
            <span className="compile-time">{document.compileDurationMs} ms</span>
          )}
          <button
            className="output-toggle"
            type="button"
            title={expanded ? 'Size output automatically' : 'Expand compilation output'}
            aria-label={expanded ? 'Size output automatically' : 'Expand compilation output'}
            aria-pressed={expanded}
            onClick={onToggleExpanded}
          >
            <Icon name={expanded ? 'collapse' : 'expand'} />
          </button>
        </div>
      </div>
      <div className="output-lines" role="log" aria-live="polite">
        {document.messages.map((message, index) => (
          <div className={message.startsWith('ERROR') ? 'log-error' : ''} key={`${message}-${index}`}>
            <span className="prompt">{index === 0 ? '›' : '·'}</span>
            <span>{message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
