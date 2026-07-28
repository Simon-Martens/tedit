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
  filePath: string
  name: string
  content: string
  commit?: string
  repoName?: string
}

export interface DesktopFileMetadata {
  filePath: string
  name: string
  commit?: string
  repoName?: string
}

export interface AppSettings {
  vimEnabled: boolean
  showPreviewPosition: boolean
  autoScrollEnabled: boolean
}

export interface DesktopSession {
  documents: DesktopDocument[]
  activeFilePath?: string
}

export interface DesktopApi {
  openDocument(): Promise<DesktopDocument | null>
  saveDocument(request: {
    filePath?: string
    name: string
    content: string
  }): Promise<DesktopFileMetadata | null>
  startSourceSync(request: { documentId: string; filePath: string; source: string }): Promise<void>
  updateSourceSync(request: { documentId: string; source: string }): void
  locateSource(request: { documentId: string; requestId: number; line: number; character: number }): void
  stopSourceSync(): void
  onSourceJump(listener: (jump: SourceJump) => void): () => void
  onSourceSyncStatus(listener: (status: SourceSyncStatus) => void): () => void
  getSettings(): Promise<AppSettings>
  updateSettings(settings: Partial<AppSettings>): Promise<AppSettings>
  restoreSession(): Promise<DesktopSession>
  saveSession(session: { filePaths: string[]; activeFilePath?: string }): Promise<void>
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

export interface SourceSyncStatus {
  documentId: string
  state: 'disabled' | 'installing' | 'starting' | 'ready' | 'error'
  message: string
}

export interface EditorDocument {
  id: string
  fileName: string
  filePath?: string
  fileHandle?: WritableFileHandle
  source: string
  sourceRevision: number
  attemptedRevision?: number
  isDirty: boolean
  repoCommit?: string
  repoName?: string
  fallbackUuid: string
  compileState: CompilationState
  messages: string[]
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
