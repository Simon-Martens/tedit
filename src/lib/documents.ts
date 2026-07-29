import type { EditorDocument } from '../types'
import typstIntroSource from '../assets/typst-intro.typ?raw'

export const INITIAL_SOURCE = ''
export const TYPST_INTRO_SOURCE = typstIntroSource

function parseTypstString(value: string) {
  try {
    return JSON.parse(`"${value}"`) as string
  } catch {
    return value.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
}

function extractDocumentAuthors(source: string) {
  const documentCall = /#set\s+document\s*\(/g
  let authors: string[] = []

  for (const match of source.matchAll(documentCall)) {
    let depth = 1
    let inString = false
    let escaped = false
    let end = match.index + match[0].length

    for (; end < source.length && depth > 0; end += 1) {
      const character = source[end]
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
      } else if (character === '"') inString = true
      else if (character === '(') depth += 1
      else if (character === ')') depth -= 1
    }

    const body = source.slice(match.index + match[0].length, end - 1)
    const authorStart = /\bauthor\s*:/.exec(body)
    if (!authorStart) continue

    const authorValue = body.slice(authorStart.index + authorStart[0].length).trimStart()
    const candidate = authorValue[0] === '('
      ? authorValue.slice(0, authorValue.indexOf(')') + 1)
      : authorValue.match(/^"(?:\\.|[^"\\])*"/)?.[0] ?? ''
    const parsed = [...candidate.matchAll(/"((?:\\.|[^"\\])*)"/g)]
      .map((author) => parseTypstString(author[1]).trim())
      .filter(Boolean)
    if (parsed.length) authors = parsed
  }

  return authors
}

function sanitizeFilenamePart(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
    .slice(0, 80)
}

export function createPdfFilename(document: EditorDocument) {
  const baseName = sanitizeFilenamePart(document.fileName.replace(/\.typ$/i, ''))
  const author = extractDocumentAuthors(document.source)
    .map(sanitizeFilenamePart)
    .filter(Boolean)
    .join('-')
  const parts = [
    baseName && baseName.toLowerCase() !== 'untitled' ? baseName : '',
    author,
    document.repoCommit ? `v${sanitizeFilenamePart(document.repoCommit)}` : '',
  ].filter(Boolean)

  return `${parts.length ? parts.join('-') : document.fallbackUuid}.pdf`
}

export function createDocument(input?: {
  fileName?: string
  filePath?: string
  fileHandle?: EditorDocument['fileHandle']
  source?: string
  repoCommit?: string
  repoName?: string
}): EditorDocument {
  return {
    id: crypto.randomUUID(),
    fileName: input?.fileName ?? 'untitled.typ',
    filePath: input?.filePath,
    fileHandle: input?.fileHandle,
    source: input?.source ?? INITIAL_SOURCE,
    sourceRevision: 0,
    isDirty: false,
    repoCommit: input?.repoCommit,
    repoName: input?.repoName,
    fallbackUuid: crypto.randomUUID(),
    compileState: 'loading',
    messages: ['Initializing Tinymist...'],
    diagnostics: [],
  }
}

export function formatError(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}
