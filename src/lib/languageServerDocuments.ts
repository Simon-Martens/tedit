import type { EditorDocument, LanguageServerDocument } from '../types'

export function toLanguageServerDocuments(documents: EditorDocument[]): LanguageServerDocument[] {
  return documents.flatMap((document) => document.filePath ? [{
    documentId: document.id,
    filePath: document.filePath,
    source: document.source,
    version: document.sourceRevision,
  }] : [])
}
