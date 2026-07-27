import { useEffect, useRef, useState } from 'react'
import { TabBar } from './components/TabBar'
import { Toolbar } from './components/Toolbar'
import { Workspace } from './components/Workspace'
import { useTypstCompilation } from './hooks/useTypstCompilation'
import { createDocument, createPdfFilename, formatError } from './lib/documents'
import type { EditorDocument, WritableFileHandle } from './types'

function App() {
  const [documents, setDocuments] = useState<EditorDocument[]>(() => [createDocument()])
  const [activeId, setActiveId] = useState(() => documents[0].id)
  const [vimEnabled, setVimEnabled] = useState(() => localStorage.getItem('typst-edit.vim-mode') === 'true')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const documentsRef = useRef(documents)
  documentsRef.current = documents

  const activeDocument = documents.find(({ id }) => id === activeId) ?? documents[0]

  const updateDocument = (id: string, update: Partial<EditorDocument>) => {
    setDocuments((current) => current.map((document) => (
      document.id === id ? { ...document, ...update } : document
    )))
  }

  useTypstCompilation(activeDocument, updateDocument)

  useEffect(() => {
    localStorage.setItem('typst-edit.vim-mode', String(vimEnabled))
  }, [vimEnabled])

  useEffect(() => {
    return () => {
      for (const document of documentsRef.current) {
        if (document.pdfUrl) URL.revokeObjectURL(document.pdfUrl)
      }
    }
  }, [])

  const addDocument = (document: EditorDocument) => {
    setDocuments((current) => [...current, document])
    setActiveId(document.id)
  }

  const showDocumentError = (message: string) => {
    updateDocument(activeId, { compileState: 'error', messages: [message] })
  }

  const loadBrowserFile = async (file: File, handle?: WritableFileHandle) => {
    if (!file.name.toLowerCase().endsWith('.typ')) {
      showDocumentError('Only .typ files can be opened.')
      return
    }

    addDocument(createDocument({
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
        const existing = documents.find(({ filePath }) => filePath === opened.filePath)
        if (existing) {
          setActiveId(existing.id)
          return
        }
        addDocument(createDocument({
          fileName: opened.name,
          filePath: opened.filePath,
          source: opened.content,
          repoCommit: opened.commit,
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

  const saveFile = async () => {
    const document = activeDocument
    if (window.typstDesktop) {
      try {
        const saved = await window.typstDesktop.saveDocument({
          filePath: document.filePath,
          name: document.fileName,
          content: document.source,
        })
        if (!saved) return
        updateDocument(document.id, {
          fileName: saved.name,
          filePath: saved.filePath,
          repoCommit: saved.commit,
          isDirty: false,
          messages: [`Saved ${saved.name}`, ...document.messages.slice(0, 3)],
        })
      } catch (error) {
        showDocumentError(`Could not save file: ${formatError(error)}`)
      }
      return
    }

    if (document.fileHandle) {
      try {
        const writable = await document.fileHandle.createWritable()
        await writable.write(document.source)
        await writable.close()
        updateDocument(document.id, {
          isDirty: false,
          messages: [`Saved ${document.fileName}`, ...document.messages.slice(0, 3)],
        })
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
    updateDocument(document.id, { isDirty: false })
  }

  const closeDocument = (id: string) => {
    const index = documents.findIndex((document) => document.id === id)
    const closing = documents[index]
    if (!closing) return
    if (closing.isDirty && !window.confirm(`Close ${closing.fileName} without saving?`)) return
    if (closing.pdfUrl) URL.revokeObjectURL(closing.pdfUrl)

    if (documents.length === 1) {
      const replacement = createDocument()
      setDocuments([replacement])
      setActiveId(replacement.id)
      return
    }

    const remaining = documents.filter((document) => document.id !== id)
    setDocuments(remaining)
    if (id === activeId) setActiveId(remaining[Math.min(index, remaining.length - 1)].id)
  }

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'o') {
        event.preventDefault()
        void openFile()
      } else if (key === 's') {
        event.preventDefault()
        void saveFile()
      } else if (key === 'n') {
        event.preventDefault()
        addDocument(createDocument())
      } else if (key === 'w') {
        event.preventDefault()
        closeDocument(activeId)
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  })

  return (
    <main className="app-shell">
      <input
        ref={fileInputRef}
        type="file"
        accept=".typ"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void loadBrowserFile(file)
          event.target.value = ''
        }}
      />
      <Toolbar
        document={activeDocument}
        pdfFileName={createPdfFilename(activeDocument)}
        onOpen={() => void openFile()}
        onSave={() => void saveFile()}
        vimEnabled={vimEnabled}
        onVimEnabledChange={setVimEnabled}
      />
      <TabBar
        documents={documents}
        activeId={activeId}
        onActivate={setActiveId}
        onClose={closeDocument}
        onNew={() => addDocument(createDocument())}
      />
      <Workspace
        document={activeDocument}
        onSourceChange={(source) => updateDocument(activeDocument.id, {
          source,
          sourceRevision: activeDocument.sourceRevision + 1,
          isDirty: true,
        })}
        vimEnabled={vimEnabled}
      />
    </main>
  )
}

export default App
