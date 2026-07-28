import type { EditorDocument } from '../types'
import { Icon } from './Icon'

export function Footer({
  document,
  line,
  column,
  compilationOpen,
  onToggleCompilation,
}: {
  document?: EditorDocument
  line: number
  column: number
  compilationOpen: boolean
  onToggleCompilation(): void
}) {
  const state = document?.compileState ?? 'idle'
  const label = document
    ? state === 'loading' ? 'Starting' : state
    : 'Idle'

  return (
    <footer className="app-footer">
      <div className="footer-details">
        <span>Ln {document ? line : '-'}, Col {document ? column : '-'}</span>
        <span className="footer-separator" aria-hidden="true" />
        <span className="footer-repository" title={document?.repoName ?? 'No repository'}>
          {document?.repoName ?? 'No repository'}
        </span>
      </div>
      <div className="footer-compilation">
        <span
          className={`footer-compile-status footer-compile-status-${state}`}
          role="status"
          aria-live="polite"
        >
          <i aria-hidden="true" />
          {state !== 'success' && state !== 'compiling' && <span>{label}</span>}
          {document?.compileDurationMs !== undefined && (
            <span className="footer-compile-time">{document.compileDurationMs} ms</span>
          )}
        </span>
        <button
          type="button"
          className="footer-output-toggle"
          title={compilationOpen ? 'Hide compilation output' : 'Show compilation output'}
          aria-label={compilationOpen ? 'Hide compilation output' : 'Show compilation output'}
          aria-expanded={compilationOpen}
          disabled={!document}
          onClick={onToggleCompilation}
        >
          <Icon name={compilationOpen ? 'collapse' : 'expand'} />
        </button>
      </div>
    </footer>
  )
}
