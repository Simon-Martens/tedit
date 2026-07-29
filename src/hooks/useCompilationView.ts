import { useLayoutEffect, useState } from 'react'
import type { EditorDocument } from '../types'

export function useCompilationView(activeDocument?: EditorDocument) {
  const [compilationView, setCompilationView] = useState<{
    documentId: string
    mode: 'closed' | 'manual' | 'error'
  }>({ documentId: '', mode: 'closed' })
  const hasCurrentError = activeDocument?.compileState === 'error'
    && activeDocument.attemptedRevision === activeDocument.sourceRevision
    && activeDocument.attemptedDependencyRevision === activeDocument.dependencyRevision
  const mode = compilationView.documentId === activeDocument?.id
    ? compilationView.mode
    : hasCurrentError ? 'error' : 'closed'
  const open = mode !== 'closed'

  useLayoutEffect(() => {
    const documentId = activeDocument?.id ?? ''
    setCompilationView((current) => {
      let nextMode = current.documentId === documentId ? current.mode : 'closed'
      if (hasCurrentError) nextMode = 'error'
      else if (!activeDocument || (activeDocument.compileState === 'success' && nextMode === 'error')) nextMode = 'closed'
      if (current.documentId === documentId && current.mode === nextMode) return current
      return { documentId, mode: nextMode }
    })
  }, [activeDocument?.id, activeDocument?.compileState, hasCurrentError])

  return {
    mode,
    open,
    toggle: () => setCompilationView({
      documentId: activeDocument?.id ?? '',
      mode: open ? 'closed' : 'manual',
    }),
  }
}
