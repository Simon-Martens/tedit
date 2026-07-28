import type { EditorDocument } from '../types'

export function CompilationPane({
  document,
}: {
  document: EditorDocument
}) {
  return (
    <div className="output-panel">
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
