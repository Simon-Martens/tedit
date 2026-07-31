export type CompilationState = 'loading' | 'compiling' | 'success' | 'error'

export interface WritableFileHandle {
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<{
    write(data: string): Promise<void>
    close(): Promise<void>
  }>
}

export interface DesktopDocument {
  recoveryId?: string
  filePath?: string
  name: string
  content: string
  diskVersion?: string
  isDirty?: boolean
  commit?: string
  repoName?: string
}

export interface DesktopFileMetadata {
  filePath: string
  name: string
  diskVersion: string
  commit?: string
  repoName?: string
}

export interface DesktopFileChange {
  filePath: string
  kind: 'changed' | 'deleted'
  content?: string
  diskVersion?: string
}

export interface BibliographySnapshot {
  id: string
  filePath: string
  name: string
  content: string
  diskVersion?: string
  exists: boolean
}

export interface BibliographyFile extends BibliographySnapshot {
  relativePath: string
}

export interface BibliographyConflict {
  id: string
  filePath: string
  name: string
  kind: 'changed' | 'deleted'
  content?: string
  diskVersion?: string
  exists: boolean
}

export type BibliographyChange = { documentId: string } & BibliographyConflict

export interface LanguageServerDocument {
  documentId: string
  filePath?: string
  source: string
  version: number
  sourceVersion: number
}

export interface LanguageServerCompletionRange {
  start: SourcePosition
  end: SourcePosition
}

export interface LanguageServerCompletionItem {
  label: string | { label: string; detail?: string; description?: string }
  kind?: number
  detail?: string
  documentation?: string | { kind?: string; value: string }
  sortText?: string
  filterText?: string
  insertText?: string
  textEditText?: string
  insertTextFormat?: number
  preselect?: boolean
  commitCharacters?: string[]
  textEdit?: {
    newText: string
    range?: LanguageServerCompletionRange
    insert?: LanguageServerCompletionRange
    replace?: LanguageServerCompletionRange
  }
  additionalTextEdits?: Array<{ newText: string; range: LanguageServerCompletionRange }>
}

export type LanguageServerCompletionResult = LanguageServerCompletionItem[] | {
  isIncomplete?: boolean
  items: LanguageServerCompletionItem[]
  itemDefaults?: {
    commitCharacters?: string[]
    editRange?: LanguageServerCompletionRange | {
      insert: LanguageServerCompletionRange
      replace: LanguageServerCompletionRange
    }
    insertTextFormat?: number
  }
} | null

export interface PreviewRoot {
  filePath: string
  name: string
  relativePath: string
}

export interface WatchHealthStatus {
  state: 'disabled' | 'ready' | 'degraded' | 'error'
  message: string
  watchedDirectories: number
  requestedDirectories: number
  truncated?: boolean
}

export interface PreviewRootDiscoveryResult {
  roots: PreviewRoot[]
  status: WatchHealthStatus
}

export interface AppSettings {
  vimEnabled: boolean
  showPreviewPosition: boolean
  autoScrollEnabled: boolean
  lightThemeEnabled: boolean
  foldingEnabled: boolean
  autocompleteEnabled: boolean
  errorHighlightingEnabled: boolean
  automaticErrorPopupEnabled: boolean
  previewRenderBackoffMs: number
}

export interface DesktopSession {
  documents: DesktopDocument[]
  activeFilePath?: string
}

export interface DesktopApi {
  printPdf(pdf: Uint8Array): Promise<{ success: boolean; failureReason?: string }>
  openDocument(): Promise<DesktopDocument | null>
  saveDocument(request: {
    filePath?: string
    name: string
    content: string
    expectedDiskVersion?: string | null
  }): Promise<DesktopFileMetadata | DesktopFileChange | null>
  deleteDocument(request: { filePath: string; expectedDiskVersion: string }): Promise<boolean>
  watchDocuments(filePaths: string[]): Promise<WatchHealthStatus>
  onDocumentWatchStatus(listener: (status: WatchHealthStatus) => void): () => void
  onDocumentChange(listener: (change: DesktopFileChange) => void): () => void
  discoverBibliographies(request: {
    documentId: string
    sourceFilePath: string
    rootFilePath: string
    documents: Array<{ filePath: string; source: string }>
    retainedFiles: Array<{ id: string; filePath: string }>
  }): Promise<{
    documentId: string
    files: BibliographyFile[]
    defaultBibliographyExists: boolean
  }>
  createDefaultBibliography(request: {
    documentId: string
    sourceFilePath: string
  }): Promise<{ reference: string; filePath: string }>
  saveBibliography(request: {
    documentId: string
    id: string
    content: string
    expectedDiskVersion?: string | null
  }): Promise<BibliographySnapshot | { conflict: BibliographyConflict }>
  stopBibliographies(request: { documentId: string }): void
  onBibliographyChange(listener: (change: BibliographyChange) => void): () => void
  resolveDocumentConflict(request: {
    name: string
    deleted: boolean
  }): Promise<'reload' | 'keep'>
  saveRecovery(session: {
    documents: Array<{ recoveryId: string; filePath?: string; name: string; content: string }>
    activeFilePath?: string
  }): Promise<void>
  clearRecovery(): Promise<void>
  onAppCloseRequested(listener: () => void): () => void
  acknowledgeAppClose(): void
  resolveAppClose(request: { dirtyNames: string[] }): Promise<'save' | 'discard' | 'cancel'>
  completeAppClose(close: boolean): void
  discoverPreviewRoots(request: {
    filePath: string
    openDocuments: Array<{ filePath: string; source: string }>
  }): Promise<PreviewRootDiscoveryResult>
  onPreviewRootsChanged(listener: (update: {
    filePath: string
    roots: PreviewRoot[]
    status: WatchHealthStatus
  }) => void): () => void
  stopPreviewRootDiscovery(): void
  startSourceSync(request: {
    documentId: string
    filePath?: string
    sourceFilePath?: string
    source: string
    memoryFiles: Array<{ filePath: string; source: string }>
  }): Promise<void>
  updateSourceSync(request: {
    documentId: string
    source: string
    memoryFiles: Array<{ filePath: string; source: string }>
  }): void
  locateSource(request: { documentId: string; requestId: number; line: number; character: number }): void
  revealPreviewSource(request: { documentId: string; page: number; x: number; y: number }): void
  stopSourceSync(request: { documentId: string }): void
  onSourceJump(listener: (jump: SourceJump) => void): () => void
  onPreviewUpdate(listener: (update: PreviewUpdate) => void): () => void
  onPreviewSourceReveal(listener: (reveal: PreviewSourceReveal) => void): () => void
  onSourceSyncStatus(listener: (status: SourceSyncStatus) => void): () => void
  onSourceDependencyChange(listener: (update: { documentId: string }) => void): () => void
  refreshSourceSync(request: { documentId: string }): void
  getSettings(): Promise<AppSettings>
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>
  restoreSession(): Promise<DesktopSession>
  saveSession(session: { filePaths: string[]; activeFilePath?: string }): Promise<void>
  readClipboard(): string
  writeClipboard(text: string): void
  startLanguageServer(request: {
    documentId: string
    filePath?: string
    previewFilePath?: string
    source: string
    version: number
    sourceVersion: number
    openDocuments: LanguageServerDocument[]
  }): Promise<void>
  syncLanguageServerDocuments(request: {
    documentId: string
    openDocuments: LanguageServerDocument[]
  }): Promise<void>
  completeWithLanguageServer(request: {
    documentId: string
    line: number
    character: number
    source: string
    sourceVersion: number
    triggerCharacter?: string
    openDocuments: LanguageServerDocument[]
  }): Promise<LanguageServerCompletionResult>
  compileWithLanguageServer(request: {
    documentId: string
    source: string
    version: number
    previewFilePath?: string
    openDocuments: LanguageServerDocument[]
  }): Promise<
    | { version: number; durationMs: number; pdf: ArrayBuffer; error?: never }
    | { cancelled: true; error?: never }
    | { error: string }
  >
  stopLanguageServer(request: { documentId: string }): void
  onLanguageServerStatus(listener: (status: LanguageServerStatus) => void): () => void
  onLanguageServerDiagnostics(listener: (update: {
    documentId: string
    sourceVersion: number
    clientVersion: number
    diagnostics: LanguageServerDiagnostic[]
  }) => void): () => void
  onLanguageServerDependencyChange(listener: (update: { documentId: string }) => void): () => void
}

export interface PreviewPosition {
  page: number
  x: number
  y: number
}

export interface SourcePosition {
  line: number
  character: number
}

export interface SourceCursorLocation {
  cursor: SourcePosition
  lookup: SourcePosition
}

export interface SourceJump {
  documentId: string
  requestId: number
  positions: PreviewPosition[]
}

export interface PreviewUpdate {
  documentId: string
  kind: 'new' | 'diff-v1'
  data: Uint8Array
}

export interface PreviewSourceReveal {
  documentId: string
  filePath?: string
  start: SourcePosition
  end: SourcePosition
}

export interface SourceSyncStatus {
  documentId: string
  state: 'disabled' | 'installing' | 'starting' | 'ready' | 'error'
  message: string
}

export interface LanguageServerStatus {
  documentId: string
  state: 'disabled' | 'installing' | 'starting' | 'ready' | 'error'
  message: string
}

export interface LanguageServerDiagnostic {
  range: { start: SourcePosition; end: SourcePosition }
  severity?: number
  message: string
}

export interface EditorDiagnostic {
  severity: 'error' | 'warning' | 'info'
  message: string
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface EditorDocument {
  id: string
  fileName: string
  filePath?: string
  fileHandle?: WritableFileHandle
  source: string
  sourceRevision: number
  attemptedRevision?: number
  dependencyRevision: number
  attemptedDependencyRevision?: number
  isDirty: boolean
  diskVersion?: string
  previewRootPath?: string
  repoCommit?: string
  repoName?: string
  fallbackUuid: string
  compileState: CompilationState
  messages: string[]
  diagnostics: EditorDiagnostic[]
  languageServerDiagnostics?: EditorDiagnostic[]
  languageServerDiagnosticsSourceVersion?: number
  languageServerDiagnosticsClientVersion?: number
  pdfUrl?: string
  compiledAt?: string
  compileDurationMs?: number
}

declare global {
  interface LocalFontData {
    family: string
    fullName: string
    postscriptName: string
    style: string
    blob(): Promise<Blob>
  }

  interface Window {
    typstDesktop?: DesktopApi
    showOpenFilePicker?: (options: {
      multiple: boolean
      types: Array<{
        description: string
        accept: Record<string, string[]>
      }>
    }) => Promise<WritableFileHandle[]>
    queryLocalFonts?: () => Promise<LocalFontData[]>
  }
}
