import type { BeforeMount } from '@monaco-editor/react'

const CLOSING_DELIMITERS: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
}

interface FoldingModel {
  getLineCount(): number
  getLineContent(line: number): string
}

export function getTypstFoldingRanges(model: FoldingModel) {
  const stack: Array<{ delimiter: string; line: number }> = []
  const ranges: Array<{ start: number; end: number }> = []
  let inBlockComment = false

  for (let line = 1; line <= model.getLineCount(); line += 1) {
    const text = model.getLineContent(line)
    let inString = false
    let escaped = false

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index]
      const nextCharacter = text[index + 1]
      if (inBlockComment) {
        if (character === '*' && nextCharacter === '/') {
          inBlockComment = false
          index += 1
        }
        continue
      }
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '/' && nextCharacter === '/') break
      if (character === '/' && nextCharacter === '*') {
        inBlockComment = true
        index += 1
        continue
      }
      if (character === '"') {
        inString = true
        continue
      }
      if (character === '(' || character === '[' || character === '{') {
        stack.push({ delimiter: character, line })
        continue
      }
      const openingDelimiter = CLOSING_DELIMITERS[character]
      if (!openingDelimiter || stack.at(-1)?.delimiter !== openingDelimiter) continue
      const opening = stack.pop()
      if (opening && opening.line < line) ranges.push({ start: opening.line, end: line })
    }
  }

  return ranges
}

export const configureTypstLanguage: BeforeMount = (monaco) => {
  monaco.editor.defineTheme('tedit-semantic-light', {
    base: 'vs',
    inherit: true,
    colors: {},
    rules: [
      { token: 'function', foreground: '795E26' },
      { token: 'namespace', foreground: '267F99' },
      { token: 'bool', foreground: '0000FF' },
      { token: 'escape', foreground: 'AF00DB' },
      { token: 'link', foreground: '0563C1', fontStyle: 'underline' },
      { token: 'raw', foreground: 'A31515' },
      { token: 'label', foreground: '001188' },
      { token: 'ref', foreground: '0563C1' },
      { token: 'heading', foreground: '267F99', fontStyle: 'bold' },
      { token: 'marker', foreground: 'AF00DB' },
      { token: 'term', fontStyle: 'bold' },
      { token: 'pol', foreground: '001188' },
      { token: 'error', foreground: 'CD3131', fontStyle: 'underline' },
      { token: 'text.strong', fontStyle: 'bold' },
      { token: 'text.emph', fontStyle: 'italic' },
    ],
  })
  monaco.editor.defineTheme('tedit-semantic-dark', {
    base: 'vs-dark',
    inherit: true,
    colors: {},
    rules: [
      { token: 'function', foreground: 'DCDCAA' },
      { token: 'namespace', foreground: '4EC9B0' },
      { token: 'bool', foreground: '569CD6' },
      { token: 'escape', foreground: 'D7BA7D' },
      { token: 'link', foreground: '4EC9B0', fontStyle: 'underline' },
      { token: 'raw', foreground: 'CE9178' },
      { token: 'label', foreground: '9CDCFE' },
      { token: 'ref', foreground: '4EC9B0' },
      { token: 'heading', foreground: '4EC9B0', fontStyle: 'bold' },
      { token: 'marker', foreground: 'C586C0' },
      { token: 'term', fontStyle: 'bold' },
      { token: 'pol', foreground: '9CDCFE' },
      { token: 'error', foreground: 'F44747', fontStyle: 'underline' },
      { token: 'text.strong', fontStyle: 'bold' },
      { token: 'text.emph', fontStyle: 'italic' },
    ],
  })
  if (monaco.languages.getLanguages().some(({ id }: { id: string }) => id === 'typst')) return

  monaco.languages.register({ id: 'typst', extensions: ['.typ'] })
  monaco.languages.setMonarchTokensProvider('typst', {
    tokenizer: {
      root: [
        [/\/\/.*$/, 'comment'],
        [/#(?:set|show|let|import|include|if|else|for|while|return|context)\b/, 'keyword'],
        [/#[a-zA-Z_][\w-]*/, 'function'],
        [/\b(?:true|false|none|auto)\b/, 'constant'],
        [/\b\d+(?:\.\d+)?(?:pt|mm|cm|in|em|fr|deg|%)?\b/, 'number'],
        [/"([^"\\]|\\.)*"/, 'string'],
        [/^\s*=+\s.*$/, 'type.identifier'],
        [/\$[^$]*\$/, 'string.math'],
        [/[{}()[\]]/, '@brackets'],
      ],
    },
  })
  monaco.languages.setLanguageConfiguration('typst', {
    comments: { lineComment: '//' },
    brackets: [['{', '}'], ['[', ']'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: '$', close: '$' },
    ],
  })
  monaco.languages.registerFoldingRangeProvider('typst', {
    provideFoldingRanges(model: { getLineCount(): number; getLineContent(line: number): string }) {
      return getTypstFoldingRanges(model)
    },
  })
}
