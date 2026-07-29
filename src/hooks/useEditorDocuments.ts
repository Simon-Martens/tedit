import { useEffect, useRef, useState } from 'react'
import type { EditorDocument } from '../types'

export interface EditorDocumentsController {
  documents: EditorDocument[]
  activeId: string
  activeDocument?: EditorDocument
  getDocuments(): EditorDocument[]
  getActiveId(): string
  activateDocument(id: string): void
  addDocument(document: EditorDocument): void
  closeDocument(id: string): void
  reorderDocuments(draggedId: string, targetId: string, after: boolean): void
  updateDocument(id: string, update: Partial<EditorDocument>): void
  transformDocuments(transform: (documents: EditorDocument[]) => EditorDocument[]): void
  restoreDocuments(documents: EditorDocument[], activeFilePath?: string): void
  changeSource(document: EditorDocument, source: string): void
  changePreviewRoot(document: EditorDocument, filePath: string): void
}

export function useEditorDocuments(): EditorDocumentsController {
  const [documents, setDocuments] = useState<EditorDocument[]>([])
  const [activeId, setActiveId] = useState('')
  const documentsRef = useRef(documents)
  const activeIdRef = useRef(activeId)
  const activatedDocumentRef = useRef('')
  documentsRef.current = documents
  activeIdRef.current = activeId

  const activeDocument = documents.find(({ id }) => id === activeId) ?? documents[0]

  const updateDocument = (id: string, update: Partial<EditorDocument>) => {
    setDocuments((current) => current.map((document) => (
      document.id === id ? { ...document, ...update } : document
    )))
  }

  const transformDocuments = (transform: (documents: EditorDocument[]) => EditorDocument[]) => {
    setDocuments(transform)
  }

  const restoreDocuments = (restoredDocuments: EditorDocument[], activeFilePath?: string) => {
    const currentDocuments = documentsRef.current
    setDocuments((current) => {
      const merged = [...current]
      for (const restoredDocument of restoredDocuments) {
        const existingIndex = merged.findIndex((document) => restoredDocument.filePath
          ? document.filePath === restoredDocument.filePath
          : document.id === restoredDocument.id)
        if (existingIndex < 0) {
          merged.push(restoredDocument)
        } else if (
          restoredDocument.isDirty
          && !merged[existingIndex].isDirty
          && merged[existingIndex].diskVersion === restoredDocument.diskVersion
        ) {
          merged[existingIndex] = { ...restoredDocument, id: merged[existingIndex].id }
        }
      }
      return merged
    })
    if (!currentDocuments.length) {
      setActiveId(
        restoredDocuments.find(({ filePath }) => filePath === activeFilePath)?.id
          ?? restoredDocuments[0].id,
      )
    }
  }

  const changeSource = (document: EditorDocument, source: string) => {
    if (source === document.source) return
    updateDocument(document.id, {
      source,
      sourceRevision: document.sourceRevision + 1,
      isDirty: true,
    })
  }

  const changePreviewRoot = (document: EditorDocument, filePath: string) => {
    updateDocument(document.id, {
      previewRootPath: filePath === document.filePath ? undefined : filePath,
      dependencyRevision: document.dependencyRevision + 1,
    })
  }

  const addDocument = (document: EditorDocument) => {
    setDocuments((current) => [...current, document])
    setActiveId(document.id)
  }

  const closeDocument = (id: string) => {
    const index = documents.findIndex((document) => document.id === id)
    const closing = documents[index]
    if (!closing) return
    if (closing.isDirty && !window.confirm(`Close ${closing.fileName} without saving?`)) return
    if (closing.pdfUrl) URL.revokeObjectURL(closing.pdfUrl)

    if (documents.length === 1) {
      setDocuments([])
      setActiveId('')
      return
    }

    const remaining = documents.filter((document) => document.id !== id)
    setDocuments(remaining)
    if (id === activeId) setActiveId(remaining[Math.min(index, remaining.length - 1)].id)
  }

  const reorderDocuments = (draggedId: string, targetId: string, after: boolean) => {
    setDocuments((current) => {
      const draggedIndex = current.findIndex(({ id }) => id === draggedId)
      const targetIndex = current.findIndex(({ id }) => id === targetId)
      if (draggedIndex < 0 || targetIndex < 0 || draggedIndex === targetIndex) return current
      const next = [...current]
      const [dragged] = next.splice(draggedIndex, 1)
      const adjustedTargetIndex = next.findIndex(({ id }) => id === targetId)
      next.splice(adjustedTargetIndex + (after ? 1 : 0), 0, dragged)
      return next
    })
  }

  useEffect(() => {
    if (!activeDocument || activatedDocumentRef.current === activeDocument.id) return
    activatedDocumentRef.current = activeDocument.id
    updateDocument(activeDocument.id, {
      dependencyRevision: activeDocument.dependencyRevision + 1,
    })
  }, [activeDocument?.id])

  useEffect(() => () => {
    for (const document of documentsRef.current) {
      if (document.pdfUrl) URL.revokeObjectURL(document.pdfUrl)
    }
  }, [])

  return {
    documents,
    activeId,
    activeDocument,
    getDocuments: () => documentsRef.current,
    getActiveId: () => activeIdRef.current,
    activateDocument: setActiveId,
    updateDocument,
    transformDocuments,
    restoreDocuments,
    changeSource,
    changePreviewRoot,
    addDocument,
    closeDocument,
    reorderDocuments,
  }
}
