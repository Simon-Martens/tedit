import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { initVimMode, type VimAdapterInstance } from 'monaco-vim'
import { configureTypstLanguage } from '../lib/typstLanguage'
import type { EditorDocument, SourceCursorLocation } from '../types'
import { Icon } from './Icon'

function findRenderableOffset(text: string, preferredOffset: number) {
  for (const link of text.matchAll(/#link\s*\([^)]*\)\s*\[([^\]]*)\]/g)) {
    const start = link.index ?? 0
    const end = start + link[0].length
    if (preferredOffset < start || preferredOffset > end) continue
    const bodyOffset = link[0].lastIndexOf(link[1])
    const bodyStart = start + bodyOffset
    const bodyCharacters = [...link[1].matchAll(/[\p{L}\p{N}]/gu)]
    if (bodyCharacters.length) {
      const bodyCharacter = bodyCharacters.reduce((closest, candidate) => (
        Math.abs(bodyStart + (candidate.index ?? 0) - preferredOffset)
          < Math.abs(bodyStart + (closest.index ?? 0) - preferredOffset)
          ? candidate
          : closest
      ))
      return new TextEncoder().encode(text.slice(0, bodyStart + (bodyCharacter.index ?? 0))).length
    }
  }

  const characters = [...text.matchAll(/[\p{L}\p{N}]/gu)]
  const candidates = characters.length ? characters : [...text.matchAll(/[^\s#=*_`$\[\]{}()]/gu)]
  if (!candidates.length) return undefined
  const nearest = candidates.reduce((closest, candidate) => (
    Math.abs((candidate.index ?? 0) - preferredOffset) < Math.abs((closest.index ?? 0) - preferredOffset)
      ? candidate
      : closest
  ))
  return new TextEncoder().encode(text.slice(0, nearest.index)).length
}

export function SourcePane({
  document,
  onChange,
  layoutVersion,
  vimEnabled,
  onCursorPositionChange,
}: {
  document: EditorDocument
  onChange(value: string): void
  layoutVersion: number
  vimEnabled: boolean
  onCursorPositionChange(location: SourceCursorLocation): void
}) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const vimStatusRef = useRef<HTMLDivElement>(null)
  const vimAdapterRef = useRef<VimAdapterInstance | null>(null)
  const cursorListenerRef = useRef<{ dispose(): void } | null>(null)
  const mouseListenerRef = useRef<{ dispose(): void } | null>(null)
  const findActionRef = useRef<{ dispose(): void } | null>(null)
  const cursorCallbackRef = useRef(onCursorPositionChange)
  cursorCallbackRef.current = onCursorPositionChange

  const initializeVim = (editor: Parameters<OnMount>[0]) => {
    vimAdapterRef.current?.dispose()
    vimAdapterRef.current = initVimMode(editor, vimStatusRef.current)
  }

  const openFind = () => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    void editor.getAction('actions.find')?.run()
  }

  const openReplace = () => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    void editor.getAction('editor.action.startFindReplaceAction')?.run()
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => editorRef.current?.layout())
    return () => cancelAnimationFrame(frame)
  }, [layoutVersion])

  useEffect(() => {
    const editor = editorRef.current
    if (!editor) return
    if (vimEnabled) initializeVim(editor)
    else {
      vimAdapterRef.current?.dispose()
      vimAdapterRef.current = null
    }
    editor.focus()
  }, [vimEnabled])

  useEffect(() => {
    return () => {
      vimAdapterRef.current?.dispose()
      cursorListenerRef.current?.dispose()
      mouseListenerRef.current?.dispose()
      findActionRef.current?.dispose()
    }
  }, [])

  return (
    <div className={vimEnabled ? 'source-panel vim-enabled' : 'source-panel'}>
      <div className="panel-heading source-heading">
        <span className="source-title">Source</span>
        <span className="source-actions">
          <span className="panel-meta">Typst</span>
          <button
            type="button"
            className="source-search"
            title="Find (Ctrl/Cmd+F)"
            aria-label="Find in source"
            onClick={openFind}
          >
            <Icon name="search" />
          </button>
          <button
            type="button"
            className="source-search"
            title="Find and replace"
            aria-label="Find and replace in source"
            onClick={openReplace}
          >
            <Icon name="replace" />
          </button>
        </span>
      </div>
      <div className="editor-wrap">
        <Editor
          onMount={(editor, monaco) => {
            editorRef.current = editor
            findActionRef.current?.dispose()
            findActionRef.current = editor.addAction({
              id: 'tedit.find',
              label: 'Find',
              keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF],
              run: () => editor.getAction('actions.find')?.run(),
            })
            editor.layout()
            if (vimEnabled) initializeVim(editor)
            cursorListenerRef.current?.dispose()
            mouseListenerRef.current?.dispose()
            const reportPosition = (position: { lineNumber: number; column: number }) => {
              const model = editor.getModel()
              if (!model) return
              const currentLine = position.lineNumber
              for (let distance = 0; distance < model.getLineCount(); distance += 1) {
                const lineNumbers = distance === 0
                  ? [currentLine]
                  : [currentLine - distance, currentLine + distance]
                for (const lineNumber of lineNumbers) {
                  if (lineNumber < 1 || lineNumber > model.getLineCount()) continue
                  const text = model.getLineContent(lineNumber)
                  const preferredOffset = lineNumber === currentLine
                    ? Math.max(0, position.column - 2)
                    : text.length / 2
                  const character = findRenderableOffset(text, preferredOffset)
                  if (character === undefined) continue
                  const cursorText = model.getLineContent(currentLine)
                  cursorCallbackRef.current({
                    cursor: {
                      line: currentLine - 1,
                      character: new TextEncoder().encode(cursorText.slice(0, position.column - 1)).length,
                    },
                    lookup: { line: lineNumber - 1, character },
                  })
                  return
                }
              }
            }
            cursorListenerRef.current = editor.onDidChangeCursorPosition(({ position }) => reportPosition(position))
            mouseListenerRef.current = editor.onMouseDown(({ target }) => {
              const clickedPosition = target.position
              const currentPosition = editor.getPosition()
              if (
                clickedPosition
                && currentPosition
                && clickedPosition.lineNumber === currentPosition.lineNumber
                && clickedPosition.column === currentPosition.column
              ) reportPosition(clickedPosition)
            })
          }}
          beforeMount={configureTypstLanguage}
          language="typst"
          path={`tedit://${document.id}.typ`}
          value={document.source}
          onChange={(value) => onChange(value ?? '')}
          theme="vs-dark"
          loading={<div className="editor-loading">Loading Monaco editor...</div>}
          options={{
            automaticLayout: true,
            wordWrap: 'on',
            wrappingIndent: 'indent',
            minimap: { enabled: false },
            fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
            fontSize: 14,
            lineHeight: 22,
            padding: { top: 14, bottom: 14 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            renderLineHighlight: 'gutter',
            overviewRulerBorder: false,
            scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          }}
        />
      </div>
      <div className="vim-status-bar" ref={vimStatusRef} aria-live="polite" />
    </div>
  )
}
