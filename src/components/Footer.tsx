import { memo, useRef, useSyncExternalStore, type ComponentProps } from 'react'
import type { EditorDocument, LanguageServerStatus, WatchHealthStatus } from '../types'
import { Icon } from './Icon'

let cursorPosition = { line: 1, column: 1 }
const cursorListeners = new Set<() => void>()

export function updateFooterCursorPosition(line: number, column: number) {
  if (cursorPosition.line === line && cursorPosition.column === column) return
  cursorPosition = { line, column }
  for (const listener of cursorListeners) listener()
}

function CursorPosition({ active }: { active: boolean }) {
  const position = useSyncExternalStore(
    (listener) => {
      cursorListeners.add(listener)
      return () => cursorListeners.delete(listener)
    },
    () => cursorPosition,
    () => cursorPosition,
  )
  return <span>Ln {active ? position.line : '-'}, Col {active ? position.column : '-'}</span>
}

function FooterContent({
  document,
  compilationOpen,
  onToggleCompilation,
  languageServerStatus,
  documentWatchStatus,
  onRestartLanguageServer,
  onRestartDocumentWatcher,
}: {
  document?: EditorDocument
  compilationOpen: boolean
  onToggleCompilation(): void
  languageServerStatus: LanguageServerStatus
  documentWatchStatus: WatchHealthStatus
  onRestartLanguageServer(): void
  onRestartDocumentWatcher(): void
}) {
  const state = document?.compileState ?? 'idle'
  const label = document
    ? state === 'loading' ? 'Starting' : state
    : 'Idle'

  return (
    <footer className="app-footer">
      <div className="footer-details">
        <CursorPosition active={Boolean(document)} />
        <span className="footer-separator" aria-hidden="true" />
        <span className="footer-repository" title={document?.repoName ?? 'No repository'}>
          {document?.repoName ?? 'No repository'}
        </span>
        <span className="footer-separator" aria-hidden="true" />
        <span className="footer-service">
          <span
            className={`footer-tinymist footer-tinymist-${languageServerStatus.state}`}
            title={languageServerStatus.message}
            role="status"
            aria-live="polite"
          >
            <i aria-hidden="true" />
            <span className="footer-service-label">
              {languageServerStatus.state === 'installing' || languageServerStatus.state === 'error'
                ? languageServerStatus.message
                : 'Tinymist'}
            </span>
          </span>
          <button
            type="button"
            className="footer-service-restart"
            title="Restart Tinymist"
            aria-label="Restart Tinymist"
            disabled={
              !document
              || languageServerStatus.state === 'disabled'
              || languageServerStatus.state === 'installing'
              || languageServerStatus.state === 'starting'
            }
            onClick={onRestartLanguageServer}
          >
            <Icon name="restart" />
          </button>
        </span>
        <span className="footer-service">
          <span
            className={`footer-tinymist footer-tinymist-${documentWatchStatus.state}`}
            title={documentWatchStatus.message}
            role="status"
            aria-live="polite"
          >
            <i aria-hidden="true" />
            File Watcher
          </span>
          <button
            type="button"
            className="footer-service-restart"
            title="Restart file watcher"
            aria-label="Restart file watcher"
            disabled={documentWatchStatus.state === 'disabled'}
            onClick={onRestartDocumentWatcher}
          >
            <Icon name="restart" />
          </button>
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

const MemoizedFooter = memo(FooterContent, (previous, next) => (
  previous.document?.id === next.document?.id
  && previous.document?.repoName === next.document?.repoName
  && previous.document?.compileState === next.document?.compileState
  && previous.document?.compileDurationMs === next.document?.compileDurationMs
  && previous.compilationOpen === next.compilationOpen
  && previous.languageServerStatus === next.languageServerStatus
  && previous.documentWatchStatus === next.documentWatchStatus
))

type FooterProps = ComponentProps<typeof FooterContent>

export function Footer(props: FooterProps) {
  const callbacksRef = useRef({
    onToggleCompilation: props.onToggleCompilation,
    onRestartLanguageServer: props.onRestartLanguageServer,
    onRestartDocumentWatcher: props.onRestartDocumentWatcher,
  })
  const stableCallbacksRef = useRef<Pick<
    FooterProps,
    'onToggleCompilation' | 'onRestartLanguageServer' | 'onRestartDocumentWatcher'
  > | null>(null)
  callbacksRef.current = {
    onToggleCompilation: props.onToggleCompilation,
    onRestartLanguageServer: props.onRestartLanguageServer,
    onRestartDocumentWatcher: props.onRestartDocumentWatcher,
  }
  stableCallbacksRef.current ??= {
    onToggleCompilation: () => callbacksRef.current.onToggleCompilation(),
    onRestartLanguageServer: () => callbacksRef.current.onRestartLanguageServer(),
    onRestartDocumentWatcher: () => callbacksRef.current.onRestartDocumentWatcher(),
  }
  return <MemoizedFooter {...props} {...stableCallbacksRef.current} />
}
