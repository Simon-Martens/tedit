import { useEffect } from 'react'
import type { EditorDocument } from '../types'

export function useDocumentTitle(document?: EditorDocument) {
  useEffect(() => {
    const fileTitle = document
      ? [document.repoName, document.fileName].filter(Boolean).join(' / ')
      : undefined
    window.document.title = fileTitle ? `${fileTitle} - tedit` : 'tedit'
  }, [document?.fileName, document?.repoName])
}
