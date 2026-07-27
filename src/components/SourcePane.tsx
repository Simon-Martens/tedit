import { useEffect, useRef } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { initVimMode, type VimAdapterInstance } from 'monaco-vim'
import { configureTypstLanguage } from '../lib/typstLanguage'
import type { EditorDocument } from '../types'

export function SourcePane({
  document,
  onChange,
  layoutVersion,
  vimEnabled,
}: {
  document: EditorDocument
  onChange(value: string): void
  layoutVersion: number
  vimEnabled: boolean
}) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const vimStatusRef = useRef<HTMLDivElement>(null)
  const vimAdapterRef = useRef<VimAdapterInstance | null>(null)

  const initializeVim = (editor: Parameters<OnMount>[0]) => {
    vimAdapterRef.current?.dispose()
    vimAdapterRef.current = initVimMode(editor, vimStatusRef.current)
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
    return () => vimAdapterRef.current?.dispose()
  }, [])

  return (
    <div className={vimEnabled ? 'source-panel vim-enabled' : 'source-panel'}>
      <div className="panel-heading">
        <span>Source</span>
        <span className="panel-meta">Typst</span>
      </div>
      <div className="editor-wrap">
        <Editor
          onMount={(editor) => {
            editorRef.current = editor
            editor.layout()
            if (vimEnabled) initializeVim(editor)
          }}
          beforeMount={configureTypstLanguage}
          language="typst"
          path={`typst-edit://${document.id}.typ`}
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
