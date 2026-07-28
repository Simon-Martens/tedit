export interface TypstWorkerDiagnostic {
  severity: string
  path: string
  range: string
  message: string
}

export interface TypstCompileRequest {
  type: 'compile'
  requestId: number
  documentId: string
  source: string
  fontKey: string
  fontMessage: string
  systemFonts: ArrayBuffer[]
}

export interface TypstCompileResponse {
  type: 'result'
  requestId: number
  durationMs: number
  diagnostics: TypstWorkerDiagnostic[]
  fontMessage: string
  pdf?: ArrayBuffer
  error?: string
}
