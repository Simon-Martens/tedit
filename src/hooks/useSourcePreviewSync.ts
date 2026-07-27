import { useEffect, useRef, useState } from 'react'
import type { EditorDocument, PreviewPosition, SourceCursorLocation, SourceSyncStatus } from '../types'

const DISABLED_STATUS: SourceSyncStatus = {
  documentId: '',
  state: 'disabled',
  message: 'Save the document to enable source synchronization.',
}

export function useSourcePreviewSync(document: EditorDocument) {
  const [positions, setPositions] = useState<PreviewPosition[]>([])
  const [sourceCursorLocation, setSourceCursorLocation] = useState<SourceCursorLocation>()
  const [status, setStatus] = useState<SourceSyncStatus>(DISABLED_STATUS)
  const lastLocationRef = useRef<SourceCursorLocation | undefined>(undefined)
  const requestIdRef = useRef(0)
  const canLocate = status.state === 'ready'
    && document.compileState === 'success'
    && document.attemptedRevision === document.sourceRevision
  const canLocateRef = useRef(canLocate)
  canLocateRef.current = canLocate

  useEffect(() => {
    const desktop = window.typstDesktop
    lastLocationRef.current = undefined
    setSourceCursorLocation(undefined)
    requestIdRef.current = 0
    setPositions([])
    setStatus({ documentId: document.id, state: 'starting', message: 'Starting source synchronization...' })
    if (!desktop || !document.filePath) {
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
      filePath: document.filePath,
      source: document.source,
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
  }, [document.id, document.filePath])

  useEffect(() => {
    if (!window.typstDesktop || !document.filePath) return
    window.typstDesktop.updateSourceSync({ documentId: document.id, source: document.source })
  }, [document.id, document.filePath, document.sourceRevision])

  useEffect(() => {
    if (
      status.state === 'ready'
      && document.compileState === 'success'
      && document.attemptedRevision === document.sourceRevision
      && lastLocationRef.current
    ) {
      requestIdRef.current += 1
      window.typstDesktop?.locateSource({
        documentId: document.id,
        requestId: requestIdRef.current,
        ...lastLocationRef.current.lookup,
      })
    }
  }, [document.id, document.compileState, document.attemptedRevision, document.sourceRevision, status.state])

  const locate = (location: SourceCursorLocation) => {
    lastLocationRef.current = location
    requestIdRef.current += 1
    setSourceCursorLocation(location)
    setPositions([])
    if (!window.typstDesktop || !canLocate) return
    if (!canLocateRef.current) return
    window.typstDesktop.locateSource({
      documentId: document.id,
      requestId: requestIdRef.current,
      ...location.lookup,
    })
  }

  return { positions, sourceCursorLocation, status, locate }
}
