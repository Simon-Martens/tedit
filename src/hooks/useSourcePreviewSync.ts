import { useEffect, useRef, useState } from 'react'
import type { EditorDocument, PreviewPosition, SourceCursorLocation, SourceSyncStatus } from '../types'

const DISABLED_STATUS: SourceSyncStatus = {
  documentId: '',
  state: 'disabled',
  message: 'Save the document to enable source synchronization.',
}

export function useSourcePreviewSync(
  document: EditorDocument | undefined,
  documents: EditorDocument[],
  enabled: boolean,
) {
  const [positions, setPositions] = useState<PreviewPosition[]>([])
  const [sourceCursorLocation, setSourceCursorLocation] = useState<SourceCursorLocation>()
  const [status, setStatus] = useState<SourceSyncStatus>(DISABLED_STATUS)
  const lastLocationRef = useRef<SourceCursorLocation | undefined>(undefined)
  const requestIdRef = useRef(0)
  const memoryFiles = documents.flatMap((openDocument) => openDocument.filePath ? [{
    filePath: openDocument.filePath,
    source: openDocument.source,
  }] : [])
  const memoryFilesKey = documents
    .flatMap((openDocument) => openDocument.filePath
      ? [`${openDocument.filePath}\0${openDocument.sourceRevision}`]
      : [])
    .join('\u0001')
  const previewFilePath = document?.previewRootPath ?? document?.filePath
  const canLocate = enabled
    && document !== undefined
    && status.state === 'ready'
    && document.compileState === 'success'
    && document.attemptedRevision === document.sourceRevision
    && document.attemptedDependencyRevision === document.dependencyRevision
  const canLocateRef = useRef(canLocate)
  canLocateRef.current = canLocate

  useEffect(() => {
    const desktop = window.typstDesktop
    lastLocationRef.current = undefined
    setSourceCursorLocation(undefined)
    requestIdRef.current = 0
    setPositions([])
    if (!document) {
      setStatus(DISABLED_STATUS)
      return
    }
    setStatus({ documentId: document.id, state: 'starting', message: 'Starting source synchronization...' })
    if (!desktop || !document.filePath || !previewFilePath) {
      setStatus({ ...DISABLED_STATUS, documentId: document.id })
      return
    }

    const removeJumpListener = desktop.onSourceJump((jump) => {
      if (jump.documentId === document.id && jump.requestId === requestIdRef.current) {
        setPositions(jump.positions)
        setSourceCursorLocation(lastLocationRef.current)
      }
    })
    const removeStatusListener = desktop.onSourceSyncStatus((nextStatus) => {
      if (nextStatus.documentId !== document.id) return
      setStatus(nextStatus)
    })
    void desktop.startSourceSync({
      documentId: document.id,
      filePath: previewFilePath,
      sourceFilePath: document.filePath,
      memoryFiles,
    }).catch((error) => {
      setStatus({
        documentId: document.id,
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    })

    return () => {
      removeJumpListener()
      removeStatusListener()
      desktop.stopSourceSync()
    }
  }, [document?.id, document?.filePath, previewFilePath, enabled])

  useEffect(() => {
    if (!window.typstDesktop || !document?.filePath) return
    window.typstDesktop.updateSourceSync({ documentId: document.id, memoryFiles })
  }, [document?.id, document?.filePath, memoryFilesKey])

  useEffect(() => {
    if (enabled && document && (
      status.state === 'ready'
      && document.compileState === 'success'
      && document.attemptedRevision === document.sourceRevision
      && document.attemptedDependencyRevision === document.dependencyRevision
      && lastLocationRef.current
    )) {
      requestIdRef.current += 1
      window.typstDesktop?.locateSource({
        documentId: document.id,
        requestId: requestIdRef.current,
        ...lastLocationRef.current.lookup,
      })
    }
  }, [
    document?.id,
    document?.compileState,
    document?.attemptedRevision,
    document?.sourceRevision,
    document?.attemptedDependencyRevision,
    document?.dependencyRevision,
    status.state,
    enabled,
  ])

  const locate = (location: SourceCursorLocation) => {
    if (!enabled) return
    lastLocationRef.current = location
    requestIdRef.current += 1
    setPositions([])
    setSourceCursorLocation(location)
    if (!window.typstDesktop || !canLocate || !document) return
    if (!canLocateRef.current) return
    window.typstDesktop.locateSource({
      documentId: document.id,
      requestId: requestIdRef.current,
      ...location.lookup,
    })
  }

  return { positions, sourceCursorLocation, status, locate }
}
