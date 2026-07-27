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
}

export interface DesktopFileMetadata {
  filePath: string
  name: string
  commit?: string
}

export interface DesktopApi {
  openDocument(): Promise<DesktopDocument | null>
  saveDocument(request: {
    filePath?: string
    name: string
    content: string
  }): Promise<DesktopFileMetadata | null>
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
