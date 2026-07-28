import { useEffect, useRef, useState } from 'react'
import { TabBar } from './components/TabBar'
import { Toolbar } from './components/Toolbar'
import { Workspace } from './components/Workspace'
import { Icon } from './components/Icon'
import { Footer } from './components/Footer'
import { useTypstCompilation } from './hooks/useTypstCompilation'
import { useSourcePreviewSync } from './hooks/useSourcePreviewSync'
import { createDocument, createPdfFilename, formatError } from './lib/documents'
import type { EditorDocument, WritableFileHandle } from './types'

function browserSetting(key: string, fallback: boolean) {
  const value = localStorage.getItem(key)
  return value === null ? fallback : value === 'true'
}

function App() {
  const [documents, setDocuments] = useState<EditorDocument[]>([])
  const [activeId, setActiveId] = useState('')
  const [vimEnabled, setVimEnabled] = useState(() => (
    window.typstDesktop ? false : browserSetting('tedit.vim-mode', false)
  ))
  const [showPreviewPosition, setShowPreviewPosition] = useState(() => (
    window.typstDesktop ? false : browserSetting('tedit.show-preview-position', false)
  ))
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(() => (
    window.typstDesktop ? true : browserSetting('tedit.autoscroll', true)
  ))
  const [lightThemeEnabled, setLightThemeEnabled] = useState(() => (
    window.typstDesktop ? false : browserSetting('tedit.light-theme', false)
  ))
  const [foldingEnabled, setFoldingEnabled] = useState(() => (
    window.typstDesktop ? true : browserSetting('tedit.code-folding', true)
  ))
  const [sessionRestored, setSessionRestored] = useState(() => !window.typstDesktop)
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 })
  const [compilationOpen, setCompilationOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const documentsRef = useRef(documents)
  documentsRef.current = documents

  const activeDocument = documents.find(({ id }) => id === activeId) ?? documents[0]
  const sessionFilePaths = documents.flatMap(({ filePath }) => filePath ? [filePath] : [])
  const sessionKey = sessionFilePaths.join('\0')
  const activeFilePath = activeDocument?.filePath

  useEffect(() => {
    setCursorPosition({ line: 1, column: 1 })
  }, [activeDocument?.id])

  useEffect(() => {
    setCompilationOpen(activeDocument?.compileState === 'error')
  }, [activeDocument?.id, activeDocument?.compileState === 'error'])

  const updateDocument = (id: string, update: Partial<EditorDocument>) => {
    setDocuments((current) => current.map((document) => (
      document.id === id ? { ...document, ...update } : document
    )))
  }

  useTypstCompilation(activeDocument, updateDocument)
  const sourcePreviewSync = useSourcePreviewSync(
    activeDocument,
    showPreviewPosition || autoScrollEnabled,
  )

  useEffect(() => {
    if (window.typstDesktop) return
    localStorage.setItem('tedit.vim-mode', String(vimEnabled))
  }, [vimEnabled])

  useEffect(() => {
    if (window.typstDesktop) return
    localStorage.setItem('tedit.show-preview-position', String(showPreviewPosition))
  }, [showPreviewPosition])

  useEffect(() => {
    if (window.typstDesktop) return
    localStorage.setItem('tedit.autoscroll', String(autoScrollEnabled))
  }, [autoScrollEnabled])

  useEffect(() => {
    if (window.typstDesktop) return
    localStorage.setItem('tedit.light-theme', String(lightThemeEnabled))
  }, [lightThemeEnabled])

  useEffect(() => {
    if (window.typstDesktop) return
    localStorage.setItem('tedit.code-folding', String(foldingEnabled))
  }, [foldingEnabled])

  useEffect(() => {
    window.typstDesktop?.getSettings().then((settings) => {
      setVimEnabled(settings.vimEnabled)
      setShowPreviewPosition(settings.showPreviewPosition)
      setAutoScrollEnabled(settings.autoScrollEnabled)
      setLightThemeEnabled(settings.lightThemeEnabled)
      setFoldingEnabled(settings.foldingEnabled)
    }).catch(() => undefined)
  }, [])

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!desktop) return
    desktop.restoreSession().then((restored) => {
      if (!restored.documents.length) return
      const nextDocuments = restored.documents.map((document) => createDocument({
        fileName: document.name,
        filePath: document.filePath,
        source: document.content,
        repoCommit: document.commit,
        repoName: document.repoName,
      }))
      for (const document of documentsRef.current) {
        if (document.pdfUrl) URL.revokeObjectURL(document.pdfUrl)
      }
      setDocuments(nextDocuments)
      setActiveId(
        nextDocuments.find(({ filePath }) => filePath === restored.activeFilePath)?.id
          ?? nextDocuments[0].id,
      )
    }).catch(() => undefined).finally(() => setSessionRestored(true))
  }, [])

  useEffect(() => {
    if (!sessionRestored || !window.typstDesktop) return
    void window.typstDesktop.saveSession({
      filePaths: sessionFilePaths,
      activeFilePath,
    }).catch(() => undefined)
  }, [sessionRestored, sessionKey, activeFilePath])

  useEffect(() => {
    const fileTitle = activeDocument
      ? [activeDocument.repoName, activeDocument.fileName].filter(Boolean).join(' / ')
      : undefined
    window.document.title = fileTitle ? `${fileTitle} - tedit` : 'tedit'
  }, [activeDocument?.fileName, activeDocument?.repoName])

  const changeVimEnabled = (enabled: boolean) => {
    setVimEnabled(enabled)
    void window.typstDesktop?.updateSettings({ vimEnabled: enabled }).catch(() => undefined)
  }

  const changeShowPreviewPosition = (enabled: boolean) => {
    setShowPreviewPosition(enabled)
    void window.typstDesktop?.updateSettings({ showPreviewPosition: enabled }).catch(() => undefined)
  }

  const changeAutoScrollEnabled = (enabled: boolean) => {
    setAutoScrollEnabled(enabled)
    void window.typstDesktop?.updateSettings({ autoScrollEnabled: enabled }).catch(() => undefined)
  }

  const changeLightThemeEnabled = (enabled: boolean) => {
    setLightThemeEnabled(enabled)
    void window.typstDesktop?.updateSettings({ lightThemeEnabled: enabled }).catch(() => undefined)
  }

  const changeFoldingEnabled = (enabled: boolean) => {
    setFoldingEnabled(enabled)
    void window.typstDesktop?.updateSettings({ foldingEnabled: enabled }).catch(() => undefined)
  }

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
    if (!activeDocument) return
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

  const saveFile = async () => {
    const document = activeDocument
    if (!document) return
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
          repoName: saved.repoName,
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
    <main className={`app-shell ${lightThemeEnabled ? 'theme-light' : ''}`}>
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
        pdfFileName={activeDocument ? createPdfFilename(activeDocument) : undefined}
        onOpen={() => void openFile()}
        onSave={() => void saveFile()}
        vimEnabled={vimEnabled}
        onVimEnabledChange={changeVimEnabled}
        showPreviewPosition={showPreviewPosition}
        onShowPreviewPositionChange={changeShowPreviewPosition}
        autoScrollEnabled={autoScrollEnabled}
        onAutoScrollEnabledChange={changeAutoScrollEnabled}
        lightThemeEnabled={lightThemeEnabled}
        onLightThemeEnabledChange={changeLightThemeEnabled}
        foldingEnabled={foldingEnabled}
        onFoldingEnabledChange={changeFoldingEnabled}
      />
      <TabBar
        documents={documents}
        activeId={activeId}
        onActivate={setActiveId}
        onClose={closeDocument}
        onNew={() => addDocument(createDocument())}
        onReorder={reorderDocuments}
      />
      {activeDocument ? (
        <Workspace
          document={activeDocument}
          onSourceChange={(source) => updateDocument(activeDocument.id, {
            source,
            sourceRevision: activeDocument.sourceRevision + 1,
            isDirty: true,
          })}
          vimEnabled={vimEnabled}
          previewPositions={sourcePreviewSync.positions}
          sourceCursorLocation={sourcePreviewSync.sourceCursorLocation}
          sourceSyncStatus={sourcePreviewSync.status}
          onCursorPositionChange={sourcePreviewSync.locate}
          onCursorChange={(line, column) => setCursorPosition({ line, column })}
          showPreviewPosition={showPreviewPosition}
          autoScrollEnabled={autoScrollEnabled}
          lightThemeEnabled={lightThemeEnabled}
          foldingEnabled={foldingEnabled}
          compilationOpen={compilationOpen}
        />
      ) : (
        <section className="workspace-empty">
          <strong>No document open</strong>
          <span>Open an existing Typst file or create a new document.</span>
          <button type="button" className="empty-create" onClick={() => addDocument(createDocument())}>
            <Icon name="plus" />
            <span>Create document</span>
          </button>
        </section>
      )}
      <Footer
        document={activeDocument}
        line={cursorPosition.line}
        column={cursorPosition.column}
        compilationOpen={compilationOpen}
        onToggleCompilation={() => setCompilationOpen((current) => !current)}
      />
    </main>
  )
}

export default App
