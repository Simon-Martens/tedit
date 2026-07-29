import { useEffect, useRef, useState, type DragEvent, type PointerEvent } from 'react'
import { Icon } from './Icon'
import type { EditorDocument } from '../types'

interface TabBarProps {
  documents: EditorDocument[]
  activeId: string
  onActivate(id: string): void
  onClose(id: string): void
  onNew(): void
  onReorder(draggedId: string, targetId: string, after: boolean): void
}

export function TabBar({ documents, activeId, onActivate, onClose, onNew, onReorder }: TabBarProps) {
  const [draggingId, setDraggingId] = useState<string>()
  const [holdingId, setHoldingId] = useState<string>()
  const [dropTarget, setDropTarget] = useState<{ id: string; after: boolean }>()
  const holdTimerRef = useRef<number | undefined>(undefined)

  const finishHold = () => {
    if (holdTimerRef.current !== undefined) window.clearTimeout(holdTimerRef.current)
    holdTimerRef.current = undefined
    setHoldingId(undefined)
  }

  useEffect(() => {
    window.addEventListener('pointerup', finishHold)
    window.addEventListener('pointercancel', finishHold)
    return () => {
      window.removeEventListener('pointerup', finishHold)
      window.removeEventListener('pointercancel', finishHold)
      if (holdTimerRef.current !== undefined) window.clearTimeout(holdTimerRef.current)
    }
  }, [])

  const startHold = (event: PointerEvent<HTMLButtonElement>, documentId: string) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('.tab-close')) return
    finishHold()
    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = undefined
      setHoldingId(documentId)
    }, 30)
  }

  const finishDrag = () => {
    finishHold()
    setDraggingId(undefined)
    setDropTarget(undefined)
  }

  const dropTab = (event: DragEvent, targetId: string) => {
    event.preventDefault()
    const draggedId = draggingId ?? event.dataTransfer.getData('text/plain')
    if (draggedId && draggedId !== targetId) {
      onReorder(draggedId, targetId, dropTarget?.id === targetId && dropTarget.after)
    }
    finishDrag()
  }

  return (
    <nav className="tab-bar" aria-label="Open documents">
      <div className="tab-list" role="tablist">
        {documents.map((document) => (
          <button
            className={`document-tab ${document.id === activeId ? 'active' : ''} ${document.id === draggingId ? 'dragging' : ''} ${document.id === holdingId ? 'holding' : ''} ${document.id === dropTarget?.id ? (dropTarget.after ? 'drop-after' : 'drop-before') : ''}`}
            type="button"
            role="tab"
            aria-selected={document.id === activeId}
            draggable
            key={document.id}
            onPointerDown={(event) => startHold(event, document.id)}
            onClick={() => onActivate(document.id)}
            onDragStart={(event) => {
              setDraggingId(document.id)
              event.dataTransfer.effectAllowed = 'move'
              event.dataTransfer.setData('text/plain', document.id)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = 'move'
              if (draggingId && draggingId !== document.id) {
                const bounds = event.currentTarget.getBoundingClientRect()
                setDropTarget({ id: document.id, after: event.clientX >= bounds.left + bounds.width / 2 })
              }
            }}
            onDrop={(event) => dropTab(event, document.id)}
            onDragEnd={finishDrag}
          >
            <Icon name="file" />
            <span className="tab-name">{document.fileName}</span>
            {document.isDirty && <span className="tab-dirty" aria-label="Unsaved changes" />}
            <span
              className="tab-close"
              role="button"
              tabIndex={0}
              aria-label={`Close ${document.fileName}`}
              onClick={(event) => {
                event.stopPropagation()
                onClose(document.id)
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                event.stopPropagation()
                onClose(document.id)
              }}
            >
              <Icon name="close" />
            </span>
          </button>
        ))}
      </div>
      <button className="new-tab" type="button" aria-label="New document" onClick={onNew}>
        <Icon name="plus" />
      </button>
    </nav>
  )
}
