import { useEffect, useState } from 'react'
import { DocsView } from './components/DocsView'
import { EmptyWorkspace } from './components/EmptyWorkspace'
import { Footer } from './components/Footer'
import { TabBar } from './components/TabBar'
import { Toolbar } from './components/Toolbar'
import { Workspace } from './components/Workspace'
import { useCompilationView } from './hooks/useCompilationView'
import { useDesktopRecovery } from './hooks/useDesktopRecovery'
import { useDesktopSession } from './hooks/useDesktopSession'
import { useDocumentTitle } from './hooks/useDocumentTitle'
import { useDocumentWatching } from './hooks/useDocumentWatching'
import { useEditorDocuments } from './hooks/useEditorDocuments'
import { useFileCommands } from './hooks/useFileCommands'
import { usePreviewRootDiscovery } from './hooks/usePreviewRootDiscovery'
import { useSettings } from './hooks/useSettings'
import { useShortcuts } from './hooks/useShortcuts'
import { useSourcePreviewSync } from './hooks/useSourcePreviewSync'
import { useTinymistLanguageServer } from './hooks/useTinymistLanguageServer'
import { useTypstCompilation } from './hooks/useTypstCompilation'
import { createDocument, createPdfFilename } from './lib/documents'

function App() {
  const editor = useEditorDocuments()
  const settings = useSettings()
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 })
  const [docsOpen, setDocsOpen] = useState(false)
  const [docsMounted, setDocsMounted] = useState(false)
  const compilation = useCompilationView(editor.activeDocument)
  const languageServerStatus = useTinymistLanguageServer(
    editor.activeDocument,
    editor.documents,
    editor.updateDocument,
  )
  useTypstCompilation(
    editor.activeDocument,
    editor.documents,
    editor.updateDocument,
    languageServerStatus,
  )
  const sourcePreviewSync = useSourcePreviewSync(
    editor.activeDocument,
    editor.documents,
    settings.showPreviewPosition || settings.autoScrollEnabled,
  )
  const files = useFileCommands(editor)
  const desktopSession = useDesktopSession(editor)
  useDesktopRecovery(editor, desktopSession.persistenceEnabled, files.saveDesktopDocument)
  const documentWatchStatus = useDocumentWatching({
    editor,
    sessionRestored: desktopSession.restored,
    sessionFilePaths: desktopSession.filePaths,
    sessionKey: desktopSession.filePathsKey,
  })
  const previewRoots = usePreviewRootDiscovery(editor)

  useDocumentTitle(editor.activeDocument)
  useShortcuts({
    open: () => void files.openFile(),
    save: () => void files.saveFile(),
    create: () => editor.addDocument(createDocument()),
    close: () => editor.closeDocument(editor.activeId),
  })

  useEffect(() => {
    setCursorPosition({ line: 1, column: 1 })
  }, [editor.activeDocument?.id])

  return (
    <main className={`app-shell ${settings.lightThemeEnabled ? 'theme-light' : ''}`}>
      <input
        ref={files.fileInputRef}
        type="file"
        accept=".typ"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void files.loadBrowserFile(file)
          event.target.value = ''
        }}
      />
      <Toolbar
        document={editor.activeDocument}
        pdfFileName={editor.activeDocument ? createPdfFilename(editor.activeDocument) : undefined}
        onOpen={() => void files.openFile()}
        onSave={() => void files.saveFile()}
        docsOpen={docsOpen}
        docsAvailable={Boolean(window.typstDesktop)}
        onToggleDocs={() => {
          if (!docsOpen) setDocsMounted(true)
          setDocsOpen((current) => !current)
        }}
        vimEnabled={settings.vimEnabled}
        onVimEnabledChange={settings.changeVimEnabled}
        showPreviewPosition={settings.showPreviewPosition}
        onShowPreviewPositionChange={settings.changeShowPreviewPosition}
        autoScrollEnabled={settings.autoScrollEnabled}
        onAutoScrollEnabledChange={settings.changeAutoScrollEnabled}
        lightThemeEnabled={settings.lightThemeEnabled}
        onLightThemeEnabledChange={settings.changeLightThemeEnabled}
        foldingEnabled={settings.foldingEnabled}
        onFoldingEnabledChange={settings.changeFoldingEnabled}
      />
      <TabBar
        documents={editor.documents}
        activeId={editor.activeId}
        onActivate={editor.activateDocument}
        onClose={editor.closeDocument}
        onNew={() => editor.addDocument(createDocument())}
        onReorder={editor.reorderDocuments}
      />
      {editor.activeDocument ? (
        <Workspace
          document={editor.activeDocument}
          previewRoots={previewRoots.roots}
          previewRootStatus={previewRoots.status}
          onPreviewRootChange={(filePath) => editor.changePreviewRoot(editor.activeDocument!, filePath)}
          onSourceChange={(source) => editor.changeSource(editor.activeDocument!, source)}
          vimEnabled={settings.vimEnabled}
          previewPositions={sourcePreviewSync.positions}
          sourceCursorLocation={sourcePreviewSync.sourceCursorLocation}
          sourceSyncStatus={sourcePreviewSync.status}
          onCursorPositionChange={sourcePreviewSync.locate}
          onCursorChange={(line, column) => setCursorPosition({ line, column })}
          showPreviewPosition={settings.showPreviewPosition}
          autoScrollEnabled={settings.autoScrollEnabled}
          lightThemeEnabled={settings.lightThemeEnabled}
          foldingEnabled={settings.foldingEnabled}
          compilationOpen={compilation.open}
          compilationAutoSized={compilation.mode === 'error'}
          onSave={() => void files.saveFile()}
        />
      ) : (
        <EmptyWorkspace onCreate={editor.addDocument} />
      )}
      <Footer
        document={editor.activeDocument}
        line={cursorPosition.line}
        column={cursorPosition.column}
        compilationOpen={compilation.open}
        onToggleCompilation={compilation.toggle}
        languageServerStatus={languageServerStatus}
        documentWatchStatus={documentWatchStatus}
      />
      {docsMounted && <DocsView open={docsOpen} onClose={() => setDocsOpen(false)} />}
    </main>
  )
}

export default App
