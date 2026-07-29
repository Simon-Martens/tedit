import { useEffect, useRef, useState } from 'react'
import { reportError } from '../lib/logging'
import type { BibliographyChange, BibliographyConflict, BibliographyFile } from '../types'
import type { EditorDocumentsController } from './useEditorDocuments'

export interface BibliographyBuffer extends BibliographyFile {
  savedContent: string
  isDirty: boolean
}

export interface BibliographiesController {
  files: BibliographyBuffer[]
  selectedFile?: BibliographyBuffer
  open: boolean
  saving: boolean
  select(id: string): void
  toggle(): void
  close(): void
  prepareDocumentClose(documentId: string): boolean
  getDirtyFiles(): BibliographyBuffer[]
  getDirtyNames(): string[]
  changeContent(content: string): void
  save(): Promise<boolean>
  saveAll(): Promise<boolean>
}

function toBuffer(file: BibliographyFile): BibliographyBuffer {
  return { ...file, savedContent: file.content, isDirty: false }
}

export function useBibliographies(editor: EditorDocumentsController): BibliographiesController {
  const { activeDocument } = editor
  const [files, setFiles] = useState<BibliographyBuffer[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [open, setOpen] = useState(false)
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set())
  const filesRef = useRef(files)
  const dirtyBuffersRef = useRef(new Map<string, BibliographyBuffer>())
  const activeDocumentRef = useRef(activeDocument)
  const selectedIdRef = useRef(selectedId)
  const visibleDocumentRef = useRef('')
  const requestRef = useRef(0)
  const conflictQueueRef = useRef(Promise.resolve())
  const savingIdsRef = useRef(new Set<string>())
  filesRef.current = files
  for (const file of files) {
    if (file.isDirty) dirtyBuffersRef.current.set(file.filePath, file)
    else dirtyBuffersRef.current.delete(file.filePath)
  }
  activeDocumentRef.current = activeDocument
  selectedIdRef.current = selectedId

  const discoveryKey = activeDocument?.filePath
    ? `${activeDocument.filePath}\0${activeDocument.sourceRevision}`
    : ''

  const incrementDependencyRevision = (documentId: string) => {
    editor.transformDocuments((current) => current.map((document) => document.id === documentId ? {
      ...document,
      dependencyRevision: document.dependencyRevision + 1,
    } : document))
  }

  const applyExternalChange = (
    documentId: string,
    change: BibliographyConflict,
    discardDirty = false,
  ) => {
    const reloaded = filesRef.current.some((file) => (
      file.filePath === change.filePath && (!file.isDirty || discardDirty)
    ))
    setFiles((current) => current.map((file) => {
      if (file.filePath !== change.filePath || (file.isDirty && !discardDirty)) return file
      const content = change.kind === 'deleted' ? '' : change.content ?? ''
      return {
        ...file,
        content,
        savedContent: content,
        diskVersion: change.diskVersion,
        exists: change.exists,
        isDirty: false,
      }
    }))
    if (reloaded) incrementDependencyRevision(documentId)
  }

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!desktop) return
    return desktop.onBibliographyChange((update: BibliographyChange) => {
      const documentId = update.documentId
      if (documentId !== activeDocumentRef.current?.id) return
      const change = update
      const currentFile = filesRef.current.find(({ filePath }) => filePath === change.filePath)
      if (!currentFile) return
      if (!currentFile.isDirty) {
        applyExternalChange(documentId, change)
        return
      }

      conflictQueueRef.current = conflictQueueRef.current.then(async () => {
        const latest = filesRef.current.find(({ filePath }) => filePath === change.filePath)
        if (!latest) return
        const resolution = await desktop.resolveDocumentConflict({
          name: latest.name,
          deleted: change.kind === 'deleted',
        })
        if (resolution === 'reload') {
          applyExternalChange(documentId, change, true)
        } else {
          setFiles((current) => current.map((file) => file.filePath === change.filePath ? {
            ...file,
            diskVersion: change.diskVersion,
            exists: change.exists,
          } : file))
          incrementDependencyRevision(documentId)
        }
      }).catch((error) => reportError('bibliography-external-change', error))
    })
  }, [])

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!desktop || !activeDocument?.filePath) {
      requestRef.current += 1
      visibleDocumentRef.current = ''
      setFiles([])
      setSelectedId('')
      setOpen(false)
      return
    }
    const documentId = activeDocument.id
    if (visibleDocumentRef.current !== documentId) {
      const previousDocumentId = visibleDocumentRef.current
      const dirtyFiles = filesRef.current.filter(({ isDirty }) => isDirty)
      if (previousDocumentId && dirtyFiles.length) {
        const names = dirtyFiles.map(({ name }) => name).join(', ')
        if (!window.confirm(`Switch documents without saving bibliography changes in ${names}?`)) {
          editor.activateDocument(previousDocumentId)
          return
        }
        for (const file of dirtyFiles) dirtyBuffersRef.current.delete(file.filePath)
      }
      visibleDocumentRef.current = documentId
      setFiles([])
      setSelectedId('')
      setOpen(false)
    }
    const request = ++requestRef.current
    const timeout = window.setTimeout(() => {
      void desktop.discoverBibliographies({
        documentId,
        sourceFilePath: activeDocument.filePath!,
        rootFilePath: activeDocument.filePath!,
        documents: [{
          filePath: activeDocument.filePath!,
          source: activeDocument.source,
        }],
        retainedIds: filesRef.current.filter(({ isDirty }) => isDirty).map(({ id }) => id),
      }).then((result) => {
        if (request !== requestRef.current || result.documentId !== documentId) return
        const selectedPath = filesRef.current.find(({ id }) => id === selectedIdRef.current)?.filePath
        const externallyReloaded = result.files.some((file) => {
          const existing = filesRef.current.find(({ filePath }) => filePath === file.filePath)
          return existing && !existing.isDirty && existing.diskVersion !== file.diskVersion
        })
        const dirtyChanges = result.files.flatMap((file) => {
          const existing = filesRef.current.find(({ filePath }) => filePath === file.filePath)
            ?? dirtyBuffersRef.current.get(file.filePath)
          if (!existing?.isDirty || (existing.diskVersion === file.diskVersion && existing.exists === file.exists)) return []
          return [{
            id: file.id,
            filePath: file.filePath,
            name: file.name,
            kind: file.exists ? 'changed' as const : 'deleted' as const,
            content: file.exists ? file.content : undefined,
            diskVersion: file.diskVersion,
            exists: file.exists,
          }]
        })
        setFiles((current) => {
          const discoveredPaths = new Set(result.files.map(({ filePath }) => filePath))
          const discovered = result.files.map((file) => {
            const existing = current.find(({ filePath }) => filePath === file.filePath)
              ?? dirtyBuffersRef.current.get(file.filePath)
            return existing?.isDirty ? { ...file, ...existing, id: file.id } : toBuffer(file)
          })
          const dirtyOrphans = current.filter(({ filePath, isDirty }) => isDirty && !discoveredPaths.has(filePath))
          return [...discovered, ...dirtyOrphans]
        })
        setSelectedId(result.files.find(({ filePath }) => filePath === selectedPath)?.id
          ?? filesRef.current.find(({ filePath, isDirty }) => filePath === selectedPath && isDirty)?.id
          ?? result.files[0]?.id
          ?? filesRef.current.find(({ isDirty }) => isDirty)?.id
          ?? '')
        if (!result.files.length && !filesRef.current.some(({ isDirty }) => isDirty)) setOpen(false)
        if (externallyReloaded) incrementDependencyRevision(documentId)
        for (const change of dirtyChanges) {
          conflictQueueRef.current = conflictQueueRef.current.then(async () => {
            if (activeDocumentRef.current?.id !== documentId) return
            const current = filesRef.current.find(({ filePath }) => filePath === change.filePath)
              ?? dirtyBuffersRef.current.get(change.filePath)
            if (!current?.isDirty) return
            const resolution = await desktop.resolveDocumentConflict({
              name: current.name,
              deleted: change.kind === 'deleted',
            })
            if (resolution === 'reload') {
              applyExternalChange(documentId, change, true)
            } else {
              setFiles((files) => files.map((file) => file.filePath === change.filePath ? {
                ...file,
                diskVersion: change.diskVersion,
                exists: change.exists,
              } : file))
              incrementDependencyRevision(documentId)
            }
          }).catch((error) => reportError('bibliography-rediscovery-conflict', error))
        }
      }).catch((error) => {
        if (request === requestRef.current) reportError('bibliography-discovery', error)
      })
    }, 180)
    return () => {
      window.clearTimeout(timeout)
    }
  }, [activeDocument?.id, activeDocument?.filePath, discoveryKey])

  useEffect(() => {
    const desktop = window.typstDesktop
    const documentId = activeDocument?.id
    if (!desktop || !documentId) return
    return () => desktop.stopBibliographies({ documentId })
  }, [activeDocument?.id])

  const visibleFiles = visibleDocumentRef.current === activeDocument?.id ? files : []
  const selectedFile = visibleFiles.find(({ id }) => id === selectedId) ?? visibleFiles[0]

  const saveFile = async (file: BibliographyBuffer) => {
    const desktop = window.typstDesktop
    const document = activeDocumentRef.current
    if (!desktop || !document) return false
    if (!file.isDirty) return true
    if (savingIdsRef.current.has(file.id)) return false
    savingIdsRef.current.add(file.id)
    setSavingIds(new Set(savingIdsRef.current))
    const savedContent = file.content
    try {
      let result = await desktop.saveBibliography({
        documentId: document.id,
        id: file.id,
        content: savedContent,
        expectedDiskVersion: file.exists ? file.diskVersion ?? null : null,
      })
      if ('conflict' in result) {
        const { conflict } = result
        const resolution = await desktop.resolveDocumentConflict({
          name: conflict.name,
          deleted: conflict.kind === 'deleted',
        })
        if (resolution === 'reload') {
          applyExternalChange(document.id, conflict, true)
          return true
        }
        result = await desktop.saveBibliography({
          documentId: document.id,
          id: file.id,
          content: savedContent,
          expectedDiskVersion: conflict.kind === 'deleted' ? null : conflict.diskVersion,
        })
        if ('conflict' in result) throw new Error('The bibliography changed again before it could be saved.')
      }
      const snapshot = result
      setFiles((current) => current.map((entry) => entry.id === file.id ? {
        ...entry,
        ...snapshot,
        content: entry.content,
        savedContent,
        isDirty: entry.content !== savedContent,
      } : entry))
      incrementDependencyRevision(document.id)
      return true
    } catch (error) {
      reportError('bibliography-save', error)
      return false
    } finally {
      savingIdsRef.current.delete(file.id)
      setSavingIds(new Set(savingIdsRef.current))
    }
  }

  const save = async () => {
    const file = filesRef.current.find(({ id }) => id === selectedIdRef.current) ?? filesRef.current[0]
    return file ? saveFile(file) : true
  }

  const saveAll = async () => {
    for (const file of filesRef.current.filter(({ isDirty }) => isDirty)) {
      if (!await saveFile(file)) return false
    }
    return true
  }

  return {
    files: visibleFiles,
    selectedFile,
    open: open && Boolean(selectedFile),
    saving: Boolean(selectedFile && savingIds.has(selectedFile.id)),
    select: (id) => {
      if (!id) {
        setOpen(false)
        return
      }
      setSelectedId(id)
      setOpen(true)
    },
    toggle: () => {
      if (filesRef.current.length) setOpen((current) => !current)
    },
    close: () => setOpen(false),
    prepareDocumentClose: (documentId) => {
      if (activeDocumentRef.current?.id !== documentId) return true
      const dirtyFiles = filesRef.current.filter(({ isDirty }) => isDirty)
      if (!dirtyFiles.length) return true
      const names = dirtyFiles.map(({ name }) => name).join(', ')
      if (!window.confirm(`Close without saving bibliography changes in ${names}?`)) return false
      for (const file of dirtyFiles) dirtyBuffersRef.current.delete(file.filePath)
      setFiles((current) => current.map((file) => file.isDirty ? {
        ...file,
        content: file.savedContent,
        isDirty: false,
      } : file))
      return true
    },
    getDirtyFiles: () => filesRef.current.filter(({ isDirty }) => isDirty),
    getDirtyNames: () => filesRef.current.filter(({ isDirty }) => isDirty).map(({ name }) => name),
    changeContent: (content) => setFiles((current) => current.map((file) => file.id === selectedFile?.id ? {
      ...file,
      content,
      isDirty: content !== file.savedContent,
    } : file)),
    save,
    saveAll,
  }
}
