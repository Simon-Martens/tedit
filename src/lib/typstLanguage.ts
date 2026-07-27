import type { BeforeMount } from '@monaco-editor/react'

export const configureTypstLanguage: BeforeMount = (monaco) => {
  if (monaco.languages.getLanguages().some(({ id }) => id === 'typst')) return

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
}
