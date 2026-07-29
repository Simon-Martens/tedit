import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { TabBar } from './components/TabBar'
import { Toolbar } from './components/Toolbar'
import { Workspace } from './components/Workspace'
import { Icon } from './components/Icon'
import { Footer } from './components/Footer'
import { DocsView } from './components/DocsView'
import { useTypstCompilation } from './hooks/useTypstCompilation'
import { useSourcePreviewSync } from './hooks/useSourcePreviewSync'
import { useTinymistLanguageServer } from './hooks/useTinymistLanguageServer'
import { createDocument, createPdfFilename, formatError, TYPST_INTRO_SOURCE } from './lib/documents'
import { reportError } from './lib/logging'
import type { DesktopFileChange, EditorDocument, PreviewRoot, WatchHealthStatus, WritableFileHandle } from './types'

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
  const [sessionPersistenceEnabled, setSessionPersistenceEnabled] = useState(() => !window.typstDesktop)
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 })
  const [compilationView, setCompilationView] = useState<{
    documentId: string
    mode: 'closed' | 'manual' | 'error'
  }>({ documentId: '', mode: 'closed' })
  const [docsOpen, setDocsOpen] = useState(false)
  const [docsMounted, setDocsMounted] = useState(false)
  const [previewRootDiscovery, setPreviewRootDiscovery] = useState<{
    documentId: string
    roots: PreviewRoot[]
    status: WatchHealthStatus
  }>()
  const [documentWatchStatus, setDocumentWatchStatus] = useState<WatchHealthStatus>({
    state: 'disabled',
    message: 'No open files need filesystem watching.',
    watchedDirectories: 0,
    requestedDirectories: 0,
  })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const documentsRef = useRef(documents)
  const activeIdRef = useRef(activeId)
  const conflictQueueRef = useRef(Promise.resolve())
  const activatedDocumentRef = useRef('')
  const recoveryTimerRef = useRef<number | undefined>(undefined)
  const documentWatchRequestRef = useRef(0)
  const closingRef = useRef(false)
  documentsRef.current = documents
  activeIdRef.current = activeId

  const activeDocument = documents.find(({ id }) => id === activeId) ?? documents[0]
  const sessionFilePaths = documents.flatMap(({ filePath }) => filePath ? [filePath] : [])
  const sessionKey = sessionFilePaths.join('\0')
  const activeFilePath = activeDocument?.filePath
  const activePreviewRoots = previewRootDiscovery
    && previewRootDiscovery.documentId === activeDocument?.id
    ? previewRootDiscovery.roots
    : undefined
  const previewDiscoveryKey = documents
    .flatMap((document) => document.filePath && document.id !== activeDocument?.id
      ? [`${document.filePath}\0${document.sourceRevision}`]
      : [])
    .join('\u0001')
  const recoveryKey = documents
    .filter((document) => document.isDirty || !document.filePath)
    .map((document) => `${document.id}\0${document.filePath ?? ''}\0${document.sourceRevision}`)
    .join('\u0001')
  const hasCurrentCompilationError = activeDocument?.compileState === 'error'
    && activeDocument.attemptedRevision === activeDocument.sourceRevision
    && activeDocument.attemptedDependencyRevision === activeDocument.dependencyRevision
  const compilationMode = compilationView.documentId === activeDocument?.id
    ? compilationView.mode
    : hasCurrentCompilationError ? 'error' : 'closed'
  const compilationOpen = compilationMode !== 'closed'

  useEffect(() => {
    setCursorPosition({ line: 1, column: 1 })
  }, [activeDocument?.id])

  useLayoutEffect(() => {
    const documentId = activeDocument?.id ?? ''
    setCompilationView((current) => {
      let mode = current.documentId === documentId ? current.mode : 'closed'
      if (hasCurrentCompilationError) mode = 'error'
      else if (!activeDocument || (activeDocument.compileState === 'success' && mode === 'error')) mode = 'closed'
      if (current.documentId === documentId && current.mode === mode) return current
      return { documentId, mode }
    })
  }, [activeDocument?.id, activeDocument?.compileState, hasCurrentCompilationError])

  const updateDocument = (id: string, update: Partial<EditorDocument>) => {
    setDocuments((current) => current.map((document) => (
      document.id === id ? { ...document, ...update } : document
    )))
  }

  useEffect(() => {
    if (!activeDocument || activatedDocumentRef.current === activeDocument.id) return
    activatedDocumentRef.current = activeDocument.id
    updateDocument(activeDocument.id, {
      dependencyRevision: activeDocument.dependencyRevision + 1,
    })
  }, [activeDocument?.id])

  const languageServerStatus = useTinymistLanguageServer(activeDocument, documents, updateDocument)
  useTypstCompilation(activeDocument, documents, updateDocument, languageServerStatus)
  const sourcePreviewSync = useSourcePreviewSync(
    activeDocument,
    documents,
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
    }).catch((error) => reportError('settings-load', error))
  }, [])

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!desktop) return
    let cancelled = false
    desktop.restoreSession().then((restored) => {
      if (cancelled) return
      if (!restored.documents.length) {
        setSessionPersistenceEnabled(true)
        return
      }
      const nextDocuments = restored.documents.map((document) => createDocument({
        id: document.recoveryId,
        fileName: document.name,
        filePath: document.filePath,
        source: document.content,
        diskVersion: document.diskVersion,
        isDirty: document.isDirty,
        repoCommit: document.commit,
        repoName: document.repoName,
      }))
      const currentDocuments = documentsRef.current
      setDocuments((current) => {
        const merged = [...current]
        for (const restoredDocument of nextDocuments) {
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
          nextDocuments.find(({ filePath }) => filePath === restored.activeFilePath)?.id
            ?? nextDocuments[0].id,
        )
      }
      setSessionPersistenceEnabled(true)
    }).catch((error) => {
      if (!cancelled) console.error('Could not restore the tedit session.', error)
    }).finally(() => {
      if (!cancelled) setSessionRestored(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!sessionPersistenceEnabled || !window.typstDesktop) return
    void window.typstDesktop.saveSession({
      filePaths: sessionFilePaths,
      activeFilePath,
    }).catch((error) => reportError('session-save', error))
  }, [sessionPersistenceEnabled, sessionKey, activeFilePath])

  useEffect(() => {
    if (!sessionRestored || !window.typstDesktop) return
    const request = ++documentWatchRequestRef.current
    void window.typstDesktop.watchDocuments(sessionFilePaths)
      .then((status) => {
        if (request === documentWatchRequestRef.current) setDocumentWatchStatus(status)
      })
      .catch((error) => {
        if (request !== documentWatchRequestRef.current) return
        reportError('document-watch', error)
        setDocumentWatchStatus({
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
          watchedDirectories: 0,
          requestedDirectories: 0,
        })
      })
  }, [sessionRestored, sessionKey])

  useEffect(() => window.typstDesktop?.onDocumentWatchStatus(setDocumentWatchStatus), [])

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!sessionPersistenceEnabled || !desktop || closingRef.current) return
    recoveryTimerRef.current = window.setTimeout(() => {
      recoveryTimerRef.current = undefined
      const recoverableDocuments = documentsRef.current
        .filter((document) => document.isDirty || !document.filePath)
        .map((document) => ({
          recoveryId: document.id,
          filePath: document.filePath,
          name: document.fileName,
          content: document.source,
        }))
      void desktop.saveRecovery({
        documents: recoverableDocuments,
        activeFilePath: documentsRef.current.find(({ id }) => id === activeId)?.filePath,
      }).catch((error) => reportError('recovery-save', error))
    }, 400)
    return () => {
      window.clearTimeout(recoveryTimerRef.current)
      recoveryTimerRef.current = undefined
    }
  }, [sessionPersistenceEnabled, recoveryKey, activeId])

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!desktop || !activeDocument?.filePath) return
    const documentId = activeDocument.id
    const filePath = activeDocument.filePath
    let cancelled = false
    const applyRoots = (roots: PreviewRoot[], status: WatchHealthStatus) => {
      if (cancelled) return
      setPreviewRootDiscovery({ documentId, roots, status })
      setDocuments((current) => current.map((document) => {
        if (
          document.id !== documentId
          || !document.previewRootPath
          || roots.some((root) => root.filePath === document.previewRootPath)
        ) return document
        return {
          ...document,
          previewRootPath: undefined,
          dependencyRevision: document.dependencyRevision + 1,
        }
      }))
    }
    const removeRootListener = desktop.onPreviewRootsChanged((update) => {
      if (update.filePath === filePath) applyRoots(update.roots, update.status)
    })
    const timeout = window.setTimeout(() => {
      void desktop.discoverPreviewRoots({
        filePath,
        openDocuments: documents.flatMap((document) => document.filePath ? [{
          filePath: document.filePath,
          source: document.source,
        }] : []),
      }).then((result) => applyRoots(result.roots, result.status)).catch((error) => {
        if (cancelled) return
        reportError('preview-root-discovery', error)
        setPreviewRootDiscovery({
          documentId,
          roots: [],
          status: {
            state: 'error',
            message: error instanceof Error ? error.message : String(error),
            watchedDirectories: 0,
            requestedDirectories: 0,
          },
        })
      })
    }, 150)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      removeRootListener()
      desktop.stopPreviewRootDiscovery()
    }
  }, [
    activeDocument?.id,
    activeDocument?.filePath,
    previewDiscoveryKey,
  ])

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!desktop) return

    const applyDiskChange = (
      documentId: string,
      change: DesktopFileChange,
      expectedRevision: number,
      discardDirty = false,
    ) => {
      setDocuments((current) => current.map((document) => {
        if (document.id !== documentId) return document
        if (document.sourceRevision !== expectedRevision) return document
        if (change.kind === 'deleted') {
          return {
            ...document,
            diskVersion: undefined,
            isDirty: true,
            messages: [`${document.fileName} was deleted outside tedit. Saving will recreate it.`, ...document.messages.slice(0, 3)],
          }
        }
        if (change.content === document.source) {
          return { ...document, diskVersion: change.diskVersion, isDirty: false }
        }
        if (document.isDirty && !discardDirty) return document
        return {
          ...document,
          source: change.content ?? '',
          sourceRevision: document.sourceRevision + 1,
          diskVersion: change.diskVersion,
          isDirty: false,
          messages: [`Reloaded ${document.fileName} from disk.`, ...document.messages.slice(0, 3)],
        }
      }))
    }

    return desktop.onDocumentChange((change) => {
      const changedDocument = documentsRef.current.find(({ filePath }) => filePath === change.filePath)
      if (!changedDocument) return
      if (change.kind === 'changed' && change.content === changedDocument.source) {
        applyDiskChange(changedDocument.id, change, changedDocument.sourceRevision)
        return
      }
      if (!changedDocument.isDirty && change.kind === 'changed') {
        applyDiskChange(changedDocument.id, change, changedDocument.sourceRevision)
        return
      }

      conflictQueueRef.current = conflictQueueRef.current.then(async () => {
        const current = documentsRef.current.find(({ id }) => id === changedDocument.id)
        if (!current) return
        const resolution = await desktop.resolveDocumentConflict({
          name: current.fileName,
          deleted: change.kind === 'deleted',
        })
        if (resolution === 'reload') {
          applyDiskChange(current.id, change, current.sourceRevision, true)
        } else {
          setDocuments((documents) => documents.map((document) => document.id === current.id ? {
            ...document,
            diskVersion: change.diskVersion,
            isDirty: true,
            messages: [`Keeping editor changes for ${document.fileName}.`, ...document.messages.slice(0, 3)],
          } : document))
        }
      }).catch((error) => reportError('external-change-resolution', error))
    })
  }, [])

  useEffect(() => {
    const fileTitle = activeDocument
      ? [activeDocument.repoName, activeDocument.fileName].filter(Boolean).join(' / ')
      : undefined
    window.document.title = fileTitle ? `${fileTitle} - tedit` : 'tedit'
  }, [activeDocument?.fileName, activeDocument?.repoName])

  const changeVimEnabled = (enabled: boolean) => {
    setVimEnabled(enabled)
    void window.typstDesktop?.updateSettings({ vimEnabled: enabled }).catch((error) => reportError('settings-update', error))
  }

  const changeShowPreviewPosition = (enabled: boolean) => {
    setShowPreviewPosition(enabled)
    void window.typstDesktop?.updateSettings({ showPreviewPosition: enabled }).catch((error) => reportError('settings-update', error))
  }

  const changeAutoScrollEnabled = (enabled: boolean) => {
    setAutoScrollEnabled(enabled)
    void window.typstDesktop?.updateSettings({ autoScrollEnabled: enabled }).catch((error) => reportError('settings-update', error))
  }

  const changeLightThemeEnabled = (enabled: boolean) => {
    setLightThemeEnabled(enabled)
    void window.typstDesktop?.updateSettings({ lightThemeEnabled: enabled }).catch((error) => reportError('settings-update', error))
  }

  const changeFoldingEnabled = (enabled: boolean) => {
    setFoldingEnabled(enabled)
    void window.typstDesktop?.updateSettings({ foldingEnabled: enabled }).catch((error) => reportError('settings-update', error))
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
    updateDocument(activeId, {
      attemptedRevision: activeDocument.sourceRevision,
      attemptedDependencyRevision: activeDocument.dependencyRevision,
      compileState: 'error',
      messages: [message],
    })
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
            setDocuments((current) => current.map((entry) => entry.id === document.id
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
      setDocuments((current) => current.map((entry) => entry.id === document.id ? {
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
      updateDocument(document.id, {
        attemptedRevision: document.sourceRevision,
        attemptedDependencyRevision: document.dependencyRevision,
        compileState: 'error',
        messages: [`Could not save file: ${formatError(error)}`],
      })
      return false
    }
  }

  const saveFile = async () => {
    const document = activeDocument
    if (!document) return
    if (window.typstDesktop) {
      await saveDesktopDocument(document)
      return
    }

    if (document.fileHandle) {
      try {
        const writable = await document.fileHandle.createWritable()
        await writable.write(document.source)
        await writable.close()
        updateDocument(document.id, {
          isDirty: false,
          dependencyRevision: document.dependencyRevision + 1,
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
    updateDocument(document.id, {
      isDirty: false,
      dependencyRevision: document.dependencyRevision + 1,
    })
  }

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!desktop) return
    return desktop.onAppCloseRequested(() => {
      void (async () => {
        desktop.acknowledgeAppClose()
        closingRef.current = true
        window.clearTimeout(recoveryTimerRef.current)
        recoveryTimerRef.current = undefined
        const persistCurrentRecovery = async () => {
          const currentDocuments = documentsRef.current
            .filter((document) => document.isDirty || !document.filePath)
            .map((document) => ({
              recoveryId: document.id,
              filePath: document.filePath,
              name: document.fileName,
              content: document.source,
            }))
          await desktop.saveRecovery({
            documents: currentDocuments,
            activeFilePath: documentsRef.current.find(({ id }) => id === activeIdRef.current)?.filePath,
          })
        }
        const cancelClose = async () => {
          closingRef.current = false
          await persistCurrentRecovery().catch((error) => reportError('recovery-save', error))
          desktop.completeAppClose(false)
        }
        const recoverable = documentsRef.current.filter((document) => document.isDirty || !document.filePath)
        if (!recoverable.length) {
          try {
            await desktop.clearRecovery()
            desktop.completeAppClose(true)
          } catch (error) {
            reportError('recovery-clear', error)
            await cancelClose()
          }
          return
        }
        const resolution = await desktop.resolveAppClose({
          dirtyNames: recoverable.map(({ fileName }) => fileName),
        }).catch((error) => {
          reportError('close-resolution', error)
          return 'cancel' as const
        })
        if (resolution === 'cancel') {
          await cancelClose()
          return
        }
        if (resolution === 'save') {
          for (const document of recoverable) {
            if (!await saveDesktopDocument(document)) {
              await cancelClose()
              return
            }
          }
          await new Promise((resolve) => window.setTimeout(resolve, 0))
          if (documentsRef.current.some((document) => document.isDirty || !document.filePath)) {
            await cancelClose()
            return
          }
        }
        try {
          await desktop.clearRecovery()
          desktop.completeAppClose(true)
        } catch (error) {
          const current = documentsRef.current[0]
          if (current) updateDocument(current.id, {
            compileState: 'error',
            messages: [`Could not clear recovery data: ${formatError(error)}`],
          })
          await cancelClose()
        }
      })()
    })
  }, [])

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
        docsOpen={docsOpen}
        docsAvailable={Boolean(window.typstDesktop)}
        onToggleDocs={() => {
          if (!docsOpen) setDocsMounted(true)
          setDocsOpen((current) => !current)
        }}
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
          previewRoots={activePreviewRoots}
          previewRootStatus={previewRootDiscovery?.documentId === activeDocument.id
            ? previewRootDiscovery.status
            : undefined}
          onPreviewRootChange={(filePath) => updateDocument(activeDocument.id, {
            previewRootPath: filePath === activeDocument.filePath ? undefined : filePath,
            dependencyRevision: activeDocument.dependencyRevision + 1,
          })}
          onSourceChange={(source) => {
            if (source === activeDocument.source) return
            updateDocument(activeDocument.id, {
              source,
              sourceRevision: activeDocument.sourceRevision + 1,
              isDirty: true,
            })
          }}
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
          compilationAutoSized={compilationMode === 'error'}
          onSave={() => void saveFile()}
        />
      ) : (
        <section className="workspace-empty">
          <strong>No document open</strong>
          <span>Open an existing Typst file or create a new document.</span>
          <div className="empty-actions">
            <button type="button" className="empty-create" onClick={() => addDocument(createDocument())}>
              <Icon name="plus" />
              <span>Create document</span>
            </button>
            <button
              type="button"
              className="empty-intro"
              onClick={() => addDocument(createDocument({
                fileName: 'typst-intro.typ',
                source: TYPST_INTRO_SOURCE,
              }))}
            >
              <Icon name="file" />
              <span>Typst intro</span>
            </button>
          </div>
        </section>
      )}
      <Footer
        document={activeDocument}
        line={cursorPosition.line}
        column={cursorPosition.column}
        compilationOpen={compilationOpen}
        onToggleCompilation={() => setCompilationView({
          documentId: activeDocument?.id ?? '',
          mode: compilationOpen ? 'closed' : 'manual',
        })}
        languageServerStatus={languageServerStatus}
        documentWatchStatus={documentWatchStatus}
      />
      {docsMounted && <DocsView open={docsOpen} onClose={() => setDocsOpen(false)} />}
    </main>
  )
}

export default App
