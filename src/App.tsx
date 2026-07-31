import { useEffect, useState } from 'react'
import { DocsView } from './components/DocsView'
import { EmptyWorkspace } from './components/EmptyWorkspace'
import { Footer } from './components/Footer'
import { TabBar } from './components/TabBar'
import { Toolbar } from './components/Toolbar'
import { Workspace } from './components/Workspace'
import { useCompilationView } from './hooks/useCompilationView'
import { useBibliographies } from './hooks/useBibliographies'
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
import { toLanguageServerDocuments } from './lib/languageServerDocuments'
import { reportError } from './lib/logging'

function App() {
  const editor = useEditorDocuments()
  const settings = useSettings()
  const [cursorPosition, setCursorPosition] = useState({ line: 1, column: 1 })
  const [docsOpen, setDocsOpen] = useState(false)
  const [docsMounted, setDocsMounted] = useState(false)
  const compilation = useCompilationView(editor.activeDocument, settings.automaticErrorPopupEnabled)
  const languageServer = useTinymistLanguageServer(
    editor.activeDocument,
    editor.documents,
    editor.updateDocument,
  )
  useTypstCompilation(
    editor.activeDocument,
    editor.documents,
    editor.updateDocument,
    languageServer.status,
  )
  const sourcePreviewSync = useSourcePreviewSync(
    editor.activeDocument,
    editor.documents,
    true,
  )
  const files = useFileCommands(editor)
  const desktopSession = useDesktopSession(editor)
  const bibliographies = useBibliographies(editor)
  useDesktopRecovery(editor, desktopSession.persistenceEnabled, files.saveDesktopDocument, bibliographies)
  const documentWatcher = useDocumentWatching({
    editor,
    sessionRestored: desktopSession.restored,
    sessionFilePaths: desktopSession.filePaths,
    sessionKey: desktopSession.filePathsKey,
  })
  const previewRoots = usePreviewRootDiscovery(editor)
  const closeDocument = (id: string) => editor.closeDocument(
    id,
    () => bibliographies.prepareDocumentClose(id),
  )
  const deleteActiveDocument = async () => {
    const document = editor.activeDocument
    if (!document || bibliographies.isBusy() || !await files.deleteFile(document)) return
    bibliographies.discardDocument(document.id)
    const currentDocuments = editor.getDocuments()
    const deletedIndex = currentDocuments.findIndex(({ id }) => id === document.id)
    const remaining = currentDocuments.filter(({ id }) => id !== document.id)
    const nextActive = remaining[Math.min(deletedIndex, remaining.length - 1)]
    editor.removeDocument(document.id)
    try {
      await Promise.all([
        window.typstDesktop?.saveSession({
          filePaths: remaining.flatMap(({ filePath }) => filePath ? [filePath] : []),
          activeFilePath: nextActive?.filePath,
        }),
        window.typstDesktop?.saveRecovery({
          documents: remaining.filter((entry) => entry.isDirty || !entry.filePath).map((entry) => ({
            recoveryId: entry.id,
            filePath: entry.filePath,
            name: entry.fileName,
            content: entry.source,
          })),
          activeFilePath: nextActive?.filePath,
        }),
      ])
    } catch (error) {
      reportError('document-delete-persistence', error)
    }
  }

  useDocumentTitle(editor.activeDocument)
  useShortcuts({
    open: () => void files.openFile(),
    save: () => void files.saveFile(),
    create: () => editor.addDocument(createDocument()),
    close: () => closeDocument(editor.activeId),
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
        autocompleteEnabled={settings.autocompleteEnabled}
        onAutocompleteEnabledChange={settings.changeAutocompleteEnabled}
        errorHighlightingEnabled={settings.errorHighlightingEnabled}
        onErrorHighlightingEnabledChange={settings.changeErrorHighlightingEnabled}
        automaticErrorPopupEnabled={settings.automaticErrorPopupEnabled}
        onAutomaticErrorPopupEnabledChange={settings.changeAutomaticErrorPopupEnabled}
        previewRenderBackoffMs={settings.previewRenderBackoffMs}
        onPreviewRenderBackoffMsChange={settings.changePreviewRenderBackoffMs}
      />
      <TabBar
        documents={editor.documents}
        activeId={editor.activeId}
        onActivate={editor.activateDocument}
        onClose={closeDocument}
        onNew={() => editor.addDocument(createDocument())}
        onReorder={editor.reorderDocuments}
      />
      {editor.activeDocument ? (
        <Workspace
          document={editor.activeDocument}
          previewRoots={previewRoots.roots}
          onPreviewRootChange={(filePath) => editor.changePreviewRoot(editor.activeDocument!, filePath)}
          onSourceChange={(source) => editor.changeSource(editor.activeDocument!, source)}
          vimEnabled={settings.vimEnabled}
          previewPositions={sourcePreviewSync.positions}
          previewStatus={sourcePreviewSync.status}
          sourceCursorLocation={sourcePreviewSync.sourceCursorLocation}
          sourceReveal={sourcePreviewSync.sourceReveal}
          onCursorPositionChange={sourcePreviewSync.locate}
          onPreviewPoint={sourcePreviewSync.revealPreviewSource}
          onCursorChange={(line, column) => setCursorPosition({ line, column })}
          showPreviewPosition={settings.showPreviewPosition}
          autoScrollEnabled={settings.autoScrollEnabled}
          lightThemeEnabled={settings.lightThemeEnabled}
          foldingEnabled={settings.foldingEnabled}
          autocompleteEnabled={settings.autocompleteEnabled}
          errorHighlightingEnabled={settings.errorHighlightingEnabled}
          previewRenderBackoffMs={settings.previewRenderBackoffMs}
          compilationOpen={compilation.open}
          onSave={() => void files.saveFile()}
          onDeleteFile={() => void deleteActiveDocument()}
          bibliographies={bibliographies}
          languageServerDocuments={toLanguageServerDocuments(editor.documents)}
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
        languageServerStatus={languageServer.status}
        documentWatchStatus={documentWatcher.status}
        onRestartLanguageServer={languageServer.restart}
        onRestartDocumentWatcher={documentWatcher.restart}
      />
      {docsMounted && <DocsView open={docsOpen} onClose={() => setDocsOpen(false)} />}
    </main>
  )
}

export default App
