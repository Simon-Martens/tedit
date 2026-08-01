import { useEffect, useState } from 'react'
import { reportError } from '../lib/logging'
import type { PreviewRoot, WatchHealthStatus } from '../types'
import type { EditorDocumentsController } from './useEditorDocuments'

interface PreviewRootDiscovery {
  documentId: string
  roots: PreviewRoot[]
  status: WatchHealthStatus
}

export function usePreviewRootDiscovery(editor: EditorDocumentsController) {
  const { activeDocument, documents } = editor
  const [discovery, setDiscovery] = useState<PreviewRootDiscovery>()
  const discoveryKey = documents
    .flatMap((document) => document.filePath && document.id !== activeDocument?.id
      ? [`${document.filePath}\0${document.sourceRevision}`]
      : [])
    .join('\u0001')

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!desktop || !activeDocument?.filePath) return
    const documentId = activeDocument.id
    const filePath = activeDocument.filePath
    let cancelled = false
    const applyRoots = (roots: PreviewRoot[], status: WatchHealthStatus) => {
      if (cancelled) return
      setDiscovery((current) => current?.documentId === documentId
        && current.roots.length === roots.length
        && current.roots.every((root, index) => (
          root.filePath === roots[index].filePath
          && root.name === roots[index].name
          && root.relativePath === roots[index].relativePath
        ))
        && current.status.state === status.state
        && current.status.message === status.message
        && current.status.watchedDirectories === status.watchedDirectories
        && current.status.requestedDirectories === status.requestedDirectories
        && current.status.truncated === status.truncated
        ? current
        : { documentId, roots, status })
      editor.transformDocuments((current) => {
        let changed = false
        const next = current.map((document) => {
          if (
            document.id !== documentId
            || !document.previewRootPath
            || roots.some((root) => root.filePath === document.previewRootPath)
          ) return document
          changed = true
          return {
            ...document,
            previewRootPath: undefined,
            dependencyRevision: document.dependencyRevision + 1,
          }
        })
        return changed ? next : current
      })
    }
    const removeRootListener = desktop.onPreviewRootsChanged((update) => {
      if (update.filePath === filePath) applyRoots(update.roots, update.status)
    })
    const timeout = window.setTimeout(() => {
      void desktop.discoverPreviewRoots({
        filePath,
        openDocuments: documents.flatMap((document) => document.filePath ? [{
          filePath: document.filePath,
          source: document.source,
        }] : []),
      }).then((result) => applyRoots(result.roots, result.status)).catch((error) => {
        if (cancelled) return
        reportError('preview-root-discovery', error)
        setDiscovery({
          documentId,
          roots: [],
          status: {
            state: 'error',
            message: error instanceof Error ? error.message : String(error),
            watchedDirectories: 0,
            requestedDirectories: 0,
          },
        })
      })
    }, 150)
    return () => {
      cancelled = true
      window.clearTimeout(timeout)
      removeRootListener()
      desktop.stopPreviewRootDiscovery()
    }
  }, [activeDocument?.id, activeDocument?.filePath, discoveryKey])

  const activeDiscovery = discovery?.documentId === activeDocument?.id ? discovery : undefined
  return { roots: activeDiscovery?.roots, status: activeDiscovery?.status }
}
