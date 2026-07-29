import type { BeforeMount } from '@monaco-editor/react'

interface FoldingModel {
  getLineCount(): number
  getLineContent(line: number): string
}

export function getBibtexFoldingRanges(model: FoldingModel) {
  const ranges: Array<{ start: number; end: number }> = []
  for (let startLine = 1; startLine <= model.getLineCount(); startLine += 1) {
    const firstLine = model.getLineContent(startLine)
    const entry = firstLine.match(/^\s*@[a-zA-Z][\w-]*\s*([({])/)
    if (!entry || entry.index === undefined) continue
    const delimiters: string[] = []
    let inString = false
    let escaped = false
    let foundOpening = false

    for (let line = startLine; line <= model.getLineCount(); line += 1) {
      const text = model.getLineContent(line)
      const firstIndex = line === startLine ? entry.index + entry[0].lastIndexOf(entry[1]) : 0
      for (let index = firstIndex; index < text.length; index += 1) {
        const character = text[index]
        if (inString) {
          if (escaped) escaped = false
          else if (character === '\\') escaped = true
          else if (character === '"') inString = false
          continue
        }
        if (character === '%') break
        if (character === '"') {
          inString = true
          continue
        }
        if (character === '{') {
          delimiters.push('{')
          foundOpening = true
        } else if (character === '}' && delimiters.at(-1) === '{') {
          delimiters.pop()
        } else if (character === '(' && !foundOpening) {
          delimiters.push('(')
          foundOpening = true
        } else if (character === ')' && delimiters.at(-1) === '(') {
          delimiters.pop()
        }
        if (foundOpening && delimiters.length === 0) {
            if (line > startLine) ranges.push({ start: startLine, end: line })
            startLine = line
            break
        }
      }
      if (foundOpening && delimiters.length === 0) break
    }
  }
  return ranges
}

export const configureBibtexLanguage: BeforeMount = (monaco) => {
  if (monaco.languages.getLanguages().some(({ id }: { id: string }) => id === 'bibtex')) return

  monaco.languages.register({ id: 'bibtex', extensions: ['.bib'] })
  monaco.languages.setMonarchTokensProvider('bibtex', {
    tokenizer: {
      root: [
        [/%.*$/, 'comment'],
        [/@(?:article|book|booklet|conference|inbook|incollection|inproceedings|manual|mastersthesis|misc|phdthesis|proceedings|techreport|unpublished|string|preamble|comment)\b/i, 'keyword'],
        [/[a-zA-Z][\w-]*(?=\s*=)/, 'attribute.name'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/\d+/, 'number'],
        [/[{}()]/, '@brackets'],
        [/[#,=]/, 'delimiter'],
      ],
    },
  })
  monaco.languages.setLanguageConfiguration('bibtex', {
    comments: { lineComment: '%' },
    brackets: [['{', '}'], ['(', ')']],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
    ],
  })
  monaco.languages.registerFoldingRangeProvider('bibtex', {
    provideFoldingRanges(model: FoldingModel) {
      return getBibtexFoldingRanges(model)
    },
  })
}
