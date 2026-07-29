import { useRef } from 'react'
import { createDocument, formatError } from '../lib/documents'
import type { EditorDocument, WritableFileHandle } from '../types'
import type { EditorDocumentsController } from './useEditorDocuments'

export function useFileCommands(editor: EditorDocumentsController) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showDocumentError = (message: string) => {
    if (!editor.activeDocument) return
    editor.updateDocument(editor.activeId, {
      attemptedRevision: editor.activeDocument.sourceRevision,
      attemptedDependencyRevision: editor.activeDocument.dependencyRevision,
      compileState: 'error',
      messages: [message],
    })
  }

  const loadBrowserFile = async (file: File, handle?: WritableFileHandle) => {
    if (!file.name.toLowerCase().endsWith('.typ')) {
      showDocumentError('Only .typ files can be opened.')
      return
    }
    editor.addDocument(createDocument({
      fileName: file.name,
      fileHandle: handle,
      source: await file.text(),
    }))
  }

  const openFile = async () => {
    if (window.typstDesktop) {
      try {
        const opened = await window.typstDesktop.openDocument()
        if (!opened) return
        const existing = editor.documents.find(({ filePath }) => filePath === opened.filePath)
        if (existing) {
          editor.activateDocument(existing.id)
          return
        }
        editor.addDocument(createDocument({
          fileName: opened.name,
          filePath: opened.filePath,
          source: opened.content,
          diskVersion: opened.diskVersion,
          repoCommit: opened.commit,
          repoName: opened.repoName,
        }))
      } catch (error) {
        showDocumentError(`Could not open file: ${formatError(error)}`)
      }
      return
    }

    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          multiple: false,
          types: [{ description: 'Typst document', accept: { 'text/plain': ['.typ'] } }],
        })
        if (handle) await loadBrowserFile(await handle.getFile(), handle)
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
        showDocumentError(`Could not open file: ${formatError(error)}`)
      }
      return
    }

    fileInputRef.current?.click()
  }

  const saveDesktopDocument = async (document: EditorDocument) => {
    const desktop = window.typstDesktop
    if (!desktop) return false
    try {
      let saved = await desktop.saveDocument({
        filePath: document.filePath,
        name: document.fileName,
        content: document.source,
        expectedDiskVersion: document.filePath ? document.diskVersion ?? null : undefined,
      })
      if (!saved) return false
      if ('kind' in saved) {
        const conflict = saved
        const resolution = await desktop.resolveDocumentConflict({
          name: document.fileName,
          deleted: conflict.kind === 'deleted',
        })
        if (resolution === 'reload') {
          if (conflict.kind === 'changed') {
            editor.transformDocuments((current) => current.map((entry) => entry.id === document.id
              && entry.sourceRevision === document.sourceRevision ? {
              ...entry,
              source: conflict.content ?? '',
              sourceRevision: entry.sourceRevision + 1,
              diskVersion: conflict.diskVersion,
              isDirty: false,
              messages: [`Reloaded ${entry.fileName} from disk.`, ...entry.messages.slice(0, 3)],
            } : entry))
          }
          return true
        }
        saved = await desktop.saveDocument({
          filePath: document.filePath,
          name: document.fileName,
          content: document.source,
          expectedDiskVersion: conflict.kind === 'deleted' ? null : conflict.diskVersion,
        })
        if (!saved || 'kind' in saved) throw new Error('The file changed again before it could be saved.')
      }
      const savedRevision = document.sourceRevision
      editor.transformDocuments((current) => current.map((entry) => entry.id === document.id ? {
        ...entry,
        fileName: saved.name,
        filePath: saved.filePath,
        diskVersion: saved.diskVersion,
        repoCommit: saved.commit,
        repoName: saved.repoName,
        dependencyRevision: entry.dependencyRevision + 1,
        isDirty: entry.sourceRevision !== savedRevision,
        messages: [`Saved ${saved.name}`, ...entry.messages.slice(0, 3)],
      } : entry))
      return true
    } catch (error) {
      editor.updateDocument(document.id, {
        attemptedRevision: document.sourceRevision,
        attemptedDependencyRevision: document.dependencyRevision,
        compileState: 'error',
        messages: [`Could not save file: ${formatError(error)}`],
      })
      return false
    }
  }

  const saveFile = async () => {
    const document = editor.activeDocument
    if (!document) return
    if (window.typstDesktop) {
      await saveDesktopDocument(document)
      return
    }

    if (document.fileHandle) {
      const savedRevision = document.sourceRevision
      try {
        const writable = await document.fileHandle.createWritable()
        await writable.write(document.source)
        await writable.close()
        editor.transformDocuments((current) => current.map((entry) => entry.id === document.id ? {
          ...entry,
          isDirty: entry.sourceRevision !== savedRevision,
          dependencyRevision: entry.dependencyRevision + 1,
          messages: [`Saved ${document.fileName}`, ...document.messages.slice(0, 3)],
        } : entry))
      } catch (error) {
        showDocumentError(`Could not save file: ${formatError(error)}`)
      }
      return
    }

    const url = URL.createObjectURL(new Blob([document.source], { type: 'text/plain' }))
    const anchor = window.document.createElement('a')
    anchor.href = url
    anchor.download = document.fileName
    anchor.click()
    URL.revokeObjectURL(url)
    editor.updateDocument(document.id, {
      isDirty: false,
      dependencyRevision: document.dependencyRevision + 1,
    })
  }

  return { fileInputRef, loadBrowserFile, openFile, saveFile, saveDesktopDocument }
}
