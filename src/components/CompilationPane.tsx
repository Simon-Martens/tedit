import type { EditorDocument } from '../types'

export function CompilationPane({
  document,
}: {
  document: EditorDocument
}) {
  return (
    <div className="output-panel">
      <div className="output-lines" role="log" aria-live="polite">
        {document.messages.map((message, index) => {
          const trimmedMessage = message.trimEnd()
          return (
            <div className={trimmedMessage.startsWith('ERROR') ? 'log-error' : ''} key={`${trimmedMessage}-${index}`}>
              <span className="prompt">{index === 0 ? '›' : '·'}</span>
              <span>{trimmedMessage}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
