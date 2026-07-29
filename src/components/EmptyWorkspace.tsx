import { createDocument, TYPST_INTRO_SOURCE } from '../lib/documents'
import type { EditorDocument } from '../types'
import { Icon } from './Icon'

export function EmptyWorkspace({ onCreate }: { onCreate(document: EditorDocument): void }) {
  return (
    <section className="workspace-empty">
      <strong>No document open</strong>
      <span>Open an existing Typst file or create a new document.</span>
      <div className="empty-actions">
        <button type="button" className="empty-create" onClick={() => onCreate(createDocument())}>
          <Icon name="plus" />
          <span>Create document</span>
        </button>
        <button
          type="button"
          className="empty-intro"
          onClick={() => onCreate(createDocument({
            fileName: 'typst-intro.typ',
            source: TYPST_INTRO_SOURCE,
          }))}
        >
          <Icon name="file" />
          <span>Typst intro</span>
        </button>
      </div>
    </section>
  )
}
