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
  closeDocument(id: string, beforeClose?: () => boolean): void
  removeDocument(id: string): void
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
    setDocuments((current) => current.map((entry) => {
      if (entry.id !== document.id || source === entry.source) return entry
      return {
        ...entry,
        source,
        sourceRevision: entry.sourceRevision + 1,
        isDirty: true,
        languageServerDiagnostics: undefined,
        languageServerDiagnosticsSourceVersion: undefined,
        languageServerDiagnosticsClientVersion: undefined,
      }
    }))
  }

  const changePreviewRoot = (document: EditorDocument, filePath: string) => {
    if (filePath === (document.previewRootPath ?? document.filePath)) return
    if (document.pdfUrl) URL.revokeObjectURL(document.pdfUrl)
    updateDocument(document.id, {
      previewRootPath: filePath === document.filePath ? undefined : filePath,
      dependencyRevision: document.dependencyRevision + 1,
      attemptedDependencyRevision: undefined,
      compileState: 'loading',
      compileDurationMs: undefined,
      pdfUrl: undefined,
    })
  }

  const addDocument = (document: EditorDocument) => {
    setDocuments((current) => [...current, document])
    setActiveId(document.id)
  }

  const closeDocument = (id: string, beforeClose?: () => boolean) => {
    const index = documents.findIndex((document) => document.id === id)
    const closing = documents[index]
    if (!closing) return
    if (closing.isDirty && !window.confirm(`Close ${closing.fileName} without saving?`)) return
    if (beforeClose && !beforeClose()) return
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

  const removeDocument = (id: string) => {
    const current = documentsRef.current
    const index = current.findIndex((document) => document.id === id)
    const removed = current[index]
    if (!removed) return
    if (removed.pdfUrl) URL.revokeObjectURL(removed.pdfUrl)
    const remaining = current.filter((document) => document.id !== id)
    documentsRef.current = remaining
    setDocuments(remaining)
    if (activeIdRef.current === id) {
      const nextId = remaining[Math.min(index, remaining.length - 1)]?.id ?? ''
      activeIdRef.current = nextId
      setActiveId(nextId)
    }
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
    removeDocument,
    reorderDocuments,
  }
}
