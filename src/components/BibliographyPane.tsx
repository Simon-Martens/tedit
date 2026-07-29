import Editor, { type OnMount } from '@monaco-editor/react'
import { useEffect, useRef, useState } from 'react'
import type { BibliographyBuffer } from '../hooks/useBibliographies'
import { configureBibtexLanguage } from '../lib/bibtexLanguage'
import { Icon } from './Icon'

export function BibliographyPane({
  file,
  layoutVersion,
  lightThemeEnabled,
  saving,
  maximized,
  onChange,
  onSave,
  onToggleMaximized,
  onClose,
}: {
  file: BibliographyBuffer
  layoutVersion: number
  lightThemeEnabled: boolean
  saving: boolean
  maximized: boolean
  onChange(content: string): void
  onSave(): void
  onToggleMaximized(): void
  onClose(): void
}) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const saveRef = useRef(onSave)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  saveRef.current = onSave

  const updateHistory = (editor = editorRef.current) => {
    const model = editor?.getModel()
    setCanUndo(model?.canUndo() ?? false)
    setCanRedo(model?.canRedo() ?? false)
  }

  const run = (action: 'undo' | 'redo') => {
    editorRef.current?.focus()
    editorRef.current?.trigger('tedit', action, null)
  }

  const foldAll = () => void editorRef.current?.getAction('editor.foldAll')?.run()
  const unfoldAll = () => void editorRef.current?.getAction('editor.unfoldAll')?.run()

  useEffect(() => {
    const frame = requestAnimationFrame(() => editorRef.current?.layout())
    return () => cancelAnimationFrame(frame)
  }, [layoutVersion])

  return (
    <section className="bibliography-panel" aria-label={`Bibliography ${file.name}`}>
      <div className="panel-heading source-heading bibliography-heading">
        <span className="source-title" title={file.relativePath}>
          Bibliography
          <span className="bibliography-name">{file.name}{file.isDirty ? ' *' : ''}</span>
        </span>
        <span className="source-actions">
          <span className="panel-meta">BibTeX</span>
          <button type="button" className="source-search" title="Save bibliography (Ctrl/Cmd+S)" aria-label="Save bibliography" disabled={!file.isDirty || saving} onClick={onSave}>
            <Icon name="save" />
          </button>
          <button type="button" className="source-search" title="Undo (Ctrl/Cmd+Z)" aria-label="Undo bibliography edit" disabled={!canUndo} onClick={() => run('undo')}>
            <Icon name="undo" />
          </button>
          <button type="button" className="source-search" title="Redo (Ctrl/Cmd+Shift+Z)" aria-label="Redo bibliography edit" disabled={!canRedo} onClick={() => run('redo')}>
            <Icon name="redo" />
          </button>
          <button type="button" className="source-search" title="Collapse all bibliography entries" aria-label="Collapse all bibliography entries" onClick={foldAll}>
            <Icon name="minus" />
          </button>
          <button type="button" className="source-search" title="Expand all bibliography entries" aria-label="Expand all bibliography entries" onClick={unfoldAll}>
            <Icon name="plus" />
          </button>
          <button type="button" className="source-search" title="Find (Ctrl/Cmd+F)" aria-label="Find in bibliography" onClick={() => void editorRef.current?.getAction('actions.find')?.run()}>
            <Icon name="search" />
          </button>
          <button
            type="button"
            className="source-search"
            title={maximized ? 'Show bibliography in split view' : 'Maximize bibliography editor'}
            aria-label={maximized ? 'Show bibliography in split view' : 'Maximize bibliography editor'}
            aria-pressed={maximized}
            onClick={onToggleMaximized}
          >
            <Icon name={maximized ? 'collapse' : 'expand'} />
          </button>
          <button type="button" className="source-search" title="Close bibliography" aria-label="Close bibliography" onClick={onClose}>
            <Icon name="close" />
          </button>
        </span>
      </div>
      <div className="editor-wrap">
        <Editor
          beforeMount={configureBibtexLanguage}
          language="bibtex"
          path={`tedit-bibliography://${encodeURIComponent(file.filePath)}`}
          keepCurrentModel={false}
          value={file.content}
          onChange={(value) => onChange(value ?? '')}
          onMount={(editor, monaco) => {
            editorRef.current = editor
            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
            editor.onDidChangeModel(() => updateHistory(editor))
            editor.onDidChangeModelContent(() => updateHistory(editor))
            updateHistory(editor)
            editor.layout()
            requestAnimationFrame(() => void editor.getAction('editor.foldAll')?.run())
          }}
          theme={lightThemeEnabled ? 'vs' : 'vs-dark'}
          loading={<div className="editor-loading">Loading bibliography editor...</div>}
          options={{
            automaticLayout: true,
            wordWrap: 'on',
            minimap: { enabled: false },
            fontFamily: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
            fontSize: 14,
            lineHeight: 22,
            padding: { top: 14, bottom: 14 },
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            renderLineHighlight: 'none',
            folding: true,
            showFoldingControls: 'always',
            overviewRulerBorder: false,
            scrollbar: {
              vertical: 'visible',
              horizontal: 'visible',
              verticalScrollbarSize: 10,
              horizontalScrollbarSize: 10,
              useShadows: false,
            },
          }}
        />
      </div>
    </section>
  )
}
