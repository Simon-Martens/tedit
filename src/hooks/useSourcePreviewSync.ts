import { useEffect, useRef, useState } from 'react'
import type { EditorDocument, PreviewPosition, PreviewSourceReveal, SourceCursorLocation, SourceSyncStatus } from '../types'

const DISABLED_STATUS: SourceSyncStatus = {
  documentId: '',
  state: 'disabled',
  message: 'The live preview requires the tedit desktop app.',
}
const SOURCE_UPDATE_SETTLE_MS = 120
const SOURCE_LOCATE_SETTLE_MS = 80

export function useSourcePreviewSync(
  document: EditorDocument | undefined,
  documents: EditorDocument[],
  enabled: boolean,
) {
  const [positions, setPositions] = useState<PreviewPosition[]>([])
  const [sourceReveal, setSourceReveal] = useState<PreviewSourceReveal>()
  const [status, setStatus] = useState<SourceSyncStatus>(DISABLED_STATUS)
  const lastLocationRef = useRef<SourceCursorLocation | undefined>(undefined)
  const pendingLocationRef = useRef<SourceCursorLocation | undefined>(undefined)
  const locateTimerRef = useRef<number | undefined>(undefined)
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
  const canLocateRef = useRef(canLocate)
  canLocateRef.current = canLocate

  useEffect(() => {
    const desktop = window.typstDesktop
    lastLocationRef.current = undefined
    setSourceReveal(undefined)
    requestIdRef.current = 0
    setPositions([])
    if (!document) {
      setStatus(DISABLED_STATUS)
      return
    }
    setStatus({ documentId: document.id, state: 'starting', message: 'Starting source synchronization...' })
    if (!desktop) {
      setStatus({ ...DISABLED_STATUS, documentId: document.id })
      return
    }

    const removeJumpListener = desktop.onSourceJump((jump) => {
      if (jump.documentId === document.id && jump.requestId === requestIdRef.current) {
        setPositions((current) => current.length === jump.positions.length
          && current.every((position, index) => (
            position.page === jump.positions[index].page
            && position.x === jump.positions[index].x
            && position.y === jump.positions[index].y
          )) ? current : jump.positions)
      }
    })
    const removeStatusListener = desktop.onSourceSyncStatus((nextStatus) => {
      if (nextStatus.documentId !== document.id) return
      setStatus(nextStatus)
    })
    const removeSourceRevealListener = desktop.onPreviewSourceReveal((reveal) => {
      if (reveal.documentId === document.id) setSourceReveal(reveal)
    })
    void desktop.startSourceSync({
      documentId: document.id,
      filePath: previewFilePath,
      sourceFilePath: document.filePath,
      source: document.source,
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
      removeSourceRevealListener()
      window.clearTimeout(locateTimerRef.current)
      locateTimerRef.current = undefined
      pendingLocationRef.current = undefined
      desktop.stopSourceSync({ documentId: document.id })
    }
  }, [document?.id, document?.filePath, previewFilePath, enabled])

  useEffect(() => {
    if (!window.typstDesktop || !document) return
    const timeout = window.setTimeout(() => {
      window.typstDesktop?.updateSourceSync({ documentId: document.id, source: document.source, memoryFiles })
    }, SOURCE_UPDATE_SETTLE_MS)
    return () => window.clearTimeout(timeout)
  }, [document?.id, document?.sourceRevision, memoryFilesKey])

  useEffect(() => {
    if (enabled && document && (
      status.state === 'ready'
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
    status.state,
    enabled,
  ])

  const locate = (location: SourceCursorLocation) => {
    if (!enabled) return
    lastLocationRef.current = location
    pendingLocationRef.current = location
    requestIdRef.current += 1
    window.clearTimeout(locateTimerRef.current)
    locateTimerRef.current = window.setTimeout(() => {
      locateTimerRef.current = undefined
      const pending = pendingLocationRef.current
      if (!pending || !window.typstDesktop || !canLocateRef.current || !document) return
      window.typstDesktop.locateSource({
        documentId: document.id,
        requestId: requestIdRef.current,
        ...pending.lookup,
      })
    }, SOURCE_LOCATE_SETTLE_MS)
  }

  const revealPreviewSource = (position: PreviewPosition) => {
    if (!document) return
    window.typstDesktop?.revealPreviewSource({ documentId: document.id, ...position })
  }

  return { positions, sourceReveal, status, locate, revealPreviewSource }
}
