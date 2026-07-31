import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import type { editor as MonacoEditor, languages as MonacoLanguages, Position } from 'monaco-editor'
import { initVimMode, VimMode, type VimAdapterInstance } from 'monaco-vim'
import { configureTypstLanguage, getTypstFoldingRanges } from '../lib/typstLanguage'
import { reportError } from '../lib/logging'
import { toMonacoCompletions } from '../lib/monacoCompletions'
import type { BibliographyBuffer } from '../hooks/useBibliographies'
import type { EditorDocument, LanguageServerDocument, PreviewSourceReveal, SourceCursorLocation } from '../types'
import { Icon } from './Icon'

interface VimRegister {
  linewise: boolean
  blockwise: boolean
  setText(text: string, linewise?: boolean, blockwise?: boolean): void
  pushText(text: string, linewise?: boolean): void
  clear(): void
  toString(): string
}

interface VimClipboardApi {
  defineRegister(name: string, register: VimRegister): void
  getRegisterController(): { isValidRegister(name: string): boolean }
}

let fallbackClipboard = ''

function createClipboardRegister(): VimRegister {
  let lastWrittenText = ''
  const register: VimRegister = {
    linewise: false,
    blockwise: false,
    setText(text, linewise = false, blockwise = false) {
      lastWrittenText = text
      register.linewise = linewise
      register.blockwise = blockwise
      fallbackClipboard = text
      if (window.typstDesktop) window.typstDesktop.writeClipboard(text)
      else void navigator.clipboard?.writeText(text).catch((error) => reportError('clipboard-write', error))
    },
    pushText(text, linewise = false) {
      register.setText(`${register.toString()}${text}`, register.linewise || linewise, register.blockwise)
    },
    clear() {
      register.setText('')
    },
    toString() {
      const text = window.typstDesktop?.readClipboard() ?? fallbackClipboard
      if (text !== lastWrittenText) {
        register.linewise = false
        register.blockwise = false
      }
      return text
    },
  }
  return register
}

function registerClipboardRegisters() {
  const vim = (VimMode as unknown as { Vim: VimClipboardApi }).Vim
  const controller = vim.getRegisterController()
  if (!controller.isValidRegister('+')) vim.defineRegister('+', createClipboardRegister())
  if (!controller.isValidRegister('*')) vim.defineRegister('*', createClipboardRegister())
}

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
  lightThemeEnabled,
  foldingEnabled,
  autocompleteEnabled,
  errorHighlightingEnabled,
  onCursorPositionChange,
  sourceReveal,
  onCursorChange,
  onSave,
  bibliographies,
  languageServerDocuments,
  bibliographyOpen,
  selectedBibliography,
  onSelectBibliography,
  onToggleBibliography,
}: {
  document: EditorDocument
  onChange(value: string): void
  layoutVersion: number
  vimEnabled: boolean
  lightThemeEnabled: boolean
  foldingEnabled: boolean
  autocompleteEnabled: boolean
  errorHighlightingEnabled: boolean
  onCursorPositionChange(location: SourceCursorLocation): void
  sourceReveal?: PreviewSourceReveal
  onCursorChange(line: number, column: number): void
  onSave(): void
  bibliographies: BibliographyBuffer[]
  languageServerDocuments: LanguageServerDocument[]
  bibliographyOpen: boolean
  selectedBibliography?: BibliographyBuffer
  onSelectBibliography(id: string): void
  onToggleBibliography(): void
}) {
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)
  const monacoRef = useRef<Parameters<OnMount>[1] | null>(null)
  const vimStatusRef = useRef<HTMLDivElement>(null)
  const vimAdapterRef = useRef<VimAdapterInstance | null>(null)
  const cursorListenerRef = useRef<{ dispose(): void } | null>(null)
  const mouseListenerRef = useRef<{ dispose(): void } | null>(null)
  const modelListenerRef = useRef<{ dispose(): void } | null>(null)
  const historyListenerRef = useRef<{ dispose(): void } | null>(null)
  const findActionRef = useRef<{ dispose(): void } | null>(null)
  const completionProviderRef = useRef<{ dispose(): void } | null>(null)
  const documentRef = useRef(document)
  const languageServerDocumentsRef = useRef(languageServerDocuments)
  const initiallyCollapsedModelsRef = useRef(new Set<string>())
  const foldingEnabledRef = useRef(foldingEnabled)
  const autocompleteEnabledRef = useRef(autocompleteEnabled)
  const errorHighlightingEnabledRef = useRef(errorHighlightingEnabled)
  const languageServerDiagnosticsCurrent = document.languageServerDiagnosticsSourceVersion === document.sourceRevision
    && document.languageServerDiagnosticsClientVersion === document.sourceRevision + document.dependencyRevision
  const diagnostics = languageServerDiagnosticsCurrent
    ? document.languageServerDiagnostics ?? []
    : document.diagnostics
  const diagnosticsRef = useRef(diagnostics)
  const cursorCallbackRef = useRef(onCursorPositionChange)
  const cursorPositionCallbackRef = useRef(onCursorChange)
  const saveCallbackRef = useRef(onSave)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  cursorCallbackRef.current = onCursorPositionChange
  cursorPositionCallbackRef.current = onCursorChange
  saveCallbackRef.current = onSave
  documentRef.current = document
  languageServerDocumentsRef.current = languageServerDocuments
  foldingEnabledRef.current = foldingEnabled
  autocompleteEnabledRef.current = autocompleteEnabled
  errorHighlightingEnabledRef.current = errorHighlightingEnabled
  diagnosticsRef.current = diagnostics

  useEffect(() => {
    const editor = editorRef.current
    if (
      !editor
      || !sourceReveal
      || (sourceReveal.filePath && sourceReveal.filePath !== document.filePath)
    ) return
    const selection = {
      startLineNumber: sourceReveal.start.line + 1,
      startColumn: sourceReveal.start.character + 1,
      endLineNumber: sourceReveal.end.line + 1,
      endColumn: sourceReveal.end.character + 1,
    }
    editor.setSelection(selection)
    editor.revealRangeInCenter(selection)
    editor.focus()
  }, [document.filePath, sourceReveal])

  const initializeVim = (editor: Parameters<OnMount>[0]) => {
    vimAdapterRef.current?.dispose()
    registerClipboardRegisters()
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

  const updateHistoryAvailability = (editor = editorRef.current) => {
    const model = editor?.getModel()
    setCanUndo(model?.canUndo() ?? false)
    setCanRedo(model?.canRedo() ?? false)
  }

  const undo = () => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    editor.trigger('tedit', 'undo', null)
  }

  const redo = () => {
    const editor = editorRef.current
    if (!editor) return
    editor.focus()
    editor.trigger('tedit', 'redo', null)
  }

  const setOutermostCollapsed = async (
    editor: Parameters<OnMount>[0],
    collapsed: boolean,
    expandNested = false,
  ) => {
    const model = editor.getModel()
    if (!model) return
    const ranges = getTypstFoldingRanges(model)
    const outermostLines = ranges.filter((range, index) => !ranges.some((candidate, candidateIndex) => (
      candidateIndex !== index
      && candidate.start <= range.start
      && candidate.end >= range.end
      && (candidate.start < range.start || candidate.end > range.end)
    ))).map(({ start }) => start - 1)
    if (!outermostLines.length) return
    if (expandNested) await editor.getAction('editor.unfoldAll')?.run()
    const action = editor.getAction(collapsed ? 'editor.fold' : 'editor.unfold')
    await action?.run({ levels: 1, selectionLines: outermostLines })
  }

  const collapseOutermost = () => {
    const editor = editorRef.current
    if (editor) void setOutermostCollapsed(editor, true, true)
  }

  const expandOutermost = () => {
    const editor = editorRef.current
    if (editor) void setOutermostCollapsed(editor, false)
  }

  const applyDiagnostics = (editor = editorRef.current) => {
    const monaco = monacoRef.current
    const model = editor?.getModel()
    if (!monaco || !model) return
    const visibleDiagnostics = errorHighlightingEnabledRef.current ? diagnosticsRef.current : []
    monaco.editor.setModelMarkers(model, 'typst', visibleDiagnostics.map((diagnostic) => {
      const startLineNumber = Math.min(model.getLineCount(), Math.max(1, diagnostic.startLineNumber))
      const endLineNumber = Math.min(model.getLineCount(), Math.max(startLineNumber, diagnostic.endLineNumber))
      const startColumn = Math.min(
        model.getLineMaxColumn(startLineNumber),
        Math.max(1, diagnostic.startColumn),
      )
      let endColumn = Math.min(
        model.getLineMaxColumn(endLineNumber),
        Math.max(1, diagnostic.endColumn),
      )
      if (startLineNumber === endLineNumber && endColumn <= startColumn) {
        endColumn = Math.min(model.getLineMaxColumn(endLineNumber), startColumn + 1)
      }
      return {
        severity: diagnostic.severity === 'error'
          ? monaco.MarkerSeverity.Error
          : diagnostic.severity === 'warning'
            ? monaco.MarkerSeverity.Warning
            : monaco.MarkerSeverity.Info,
        message: diagnostic.message,
        source: 'Typst',
        startLineNumber,
        startColumn,
        endLineNumber,
        endColumn,
      }
    }))
  }

  useLayoutEffect(() => {
    const editor = editorRef.current
    const position = editor?.getPosition()
    if (!editor) return
    if (!position) {
      const frame = requestAnimationFrame(() => editor.layout())
      return () => cancelAnimationFrame(frame)
    }
    const oldHeight = editor.getLayoutInfo().height
    const lineHeight = monacoRef.current
      ? editor.getOption(monacoRef.current.editor.EditorOption.lineHeight)
      : 22
    const oldCursorTop = editor.getTopForPosition(position.lineNumber, position.column)
    const oldScrollTop = editor.getScrollTop()
    const oldUsableHeight = Math.max(1, oldHeight - lineHeight)
    const relativeCursorTop = Math.min(1, Math.max(0, (oldCursorTop - oldScrollTop) / oldUsableHeight))
    const frame = requestAnimationFrame(() => {
      editor.layout()
      const newHeight = editor.getLayoutInfo().height
      const newCursorTop = editor.getTopForPosition(position.lineNumber, position.column)
      const targetCursorTop = relativeCursorTop * Math.max(0, newHeight - lineHeight)
      editor.setScrollTop(newCursorTop - targetCursorTop)
    })
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
    const editor = editorRef.current
    if (!editor) return
    if (!foldingEnabled) {
      void editor.getAction('editor.unfoldAll')?.run().finally(() => {
        editor.updateOptions({ folding: false, showFoldingControls: 'never' })
      })
      return
    }
    editor.updateOptions({ folding: true, showFoldingControls: 'always' })
    const modelId = editor.getModel()?.uri.toString()
    if (modelId) initiallyCollapsedModelsRef.current.add(modelId)
    collapseOutermost()
  }, [foldingEnabled])

  useEffect(() => {
    applyDiagnostics()
  }, [diagnostics, document.sourceRevision, document.dependencyRevision, errorHighlightingEnabled])

  useEffect(() => {
    editorRef.current?.updateOptions({
      quickSuggestions: autocompleteEnabled,
      suggestOnTriggerCharacters: autocompleteEnabled,
      wordBasedSuggestions: autocompleteEnabled ? 'matchingDocuments' : 'off',
    })
  }, [autocompleteEnabled])

  useEffect(() => {
    const commands = VimMode.commands as typeof VimMode.commands & { save?: () => void }
    const save = () => saveCallbackRef.current()
    commands.save = save
    return () => {
      if (commands.save === save) delete commands.save
    }
  }, [])

  useEffect(() => {
    return () => {
      vimAdapterRef.current?.dispose()
      cursorListenerRef.current?.dispose()
      mouseListenerRef.current?.dispose()
      modelListenerRef.current?.dispose()
      historyListenerRef.current?.dispose()
      findActionRef.current?.dispose()
      completionProviderRef.current?.dispose()
      const model = editorRef.current?.getModel()
      if (model) monacoRef.current?.editor.setModelMarkers(model, 'typst', [])
    }
  }, [])

  return (
    <div className={vimEnabled ? 'source-panel vim-enabled' : 'source-panel'}>
      <div className="panel-heading source-heading">
        <span className="source-title">Source</span>
          <span className="source-actions">
            {bibliographies.length === 1 && (
              <button
                type="button"
                className={`bibliography-toggle${bibliographyOpen ? ' active' : ''}`}
                title={`${bibliographyOpen ? 'Hide' : 'Show'} ${bibliographies[0].relativePath}`}
                aria-label={`${bibliographyOpen ? 'Hide' : 'Show'} bibliography`}
                aria-pressed={bibliographyOpen}
                onClick={onToggleBibliography}
              >
                <Icon name="file" />
                <span>{bibliographies[0].name}</span>
                {bibliographies[0].isDirty && <i aria-label="Unsaved changes" />}
              </button>
            )}
            {bibliographies.length > 1 && (
              <select
                className="bibliography-select"
                aria-label="Open bibliography"
                title="Choose a bibliography to show, or hide the bibliography pane"
                value={bibliographyOpen ? selectedBibliography?.id ?? '' : ''}
                onChange={(event) => onSelectBibliography(event.target.value)}
              >
                <option value="">Bibliography...</option>
                {bibliographies.map((file) => (
                  <option key={file.id} value={file.id}>{file.name}{file.isDirty ? ' *' : ''}</option>
                ))}
              </select>
            )}
            <button
              type="button"
              className="source-search"
              title="Undo (Ctrl/Cmd+Z)"
              aria-label="Undo source edit"
              disabled={!canUndo}
              onClick={undo}
            >
              <Icon name="undo" />
            </button>
            <button
              type="button"
              className="source-search"
              title="Redo (Ctrl/Cmd+Shift+Z)"
              aria-label="Redo source edit"
              disabled={!canRedo}
              onClick={redo}
            >
              <Icon name="redo" />
            </button>
            {foldingEnabled && (
            <>
              <button
                type="button"
                className="source-search"
                title="Collapse top-level blocks"
                aria-label="Collapse top-level blocks"
                onClick={collapseOutermost}
              >
                <Icon name="minus" />
              </button>
              <button
                type="button"
                className="source-search"
                title="Expand top-level blocks"
                aria-label="Expand top-level blocks"
                onClick={expandOutermost}
              >
                <Icon name="plus" />
              </button>
            </>
          )}
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
            monacoRef.current = monaco
            findActionRef.current?.dispose()
            findActionRef.current = editor.addAction({
              id: 'tedit.find',
              label: 'Find',
              keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF],
              run: () => editor.getAction('actions.find')?.run(),
            })
            completionProviderRef.current?.dispose()
            completionProviderRef.current = monaco.languages.registerCompletionItemProvider('typst', {
              triggerCharacters: ['#', '@', '.', ':', '"', '<', '/', '('],
              provideCompletionItems: async (
                model: MonacoEditor.ITextModel,
                position: Position,
                context: MonacoLanguages.CompletionContext,
              ) => {
                const desktop = window.typstDesktop
                if (!autocompleteEnabledRef.current || !desktop || model !== editor.getModel()) {
                  return { suggestions: [] }
                }
                const currentDocument = documentRef.current
                const source = model.getValue()
                let activeDocumentFound = false
                const openDocuments = languageServerDocumentsRef.current.map((openDocument) => {
                  if (openDocument.documentId !== currentDocument.id) return openDocument
                  activeDocumentFound = true
                  if (openDocument.source === source) return openDocument
                  return {
                    ...openDocument,
                    source,
                    version: openDocument.version + 1,
                    sourceVersion: openDocument.sourceVersion + 1,
                  }
                })
                if (currentDocument.filePath && !activeDocumentFound) return { suggestions: [] }
                const word = model.getWordUntilPosition(position)
                const range = {
                  startLineNumber: position.lineNumber,
                  startColumn: word.startColumn,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column,
                }
                try {
                  const result = await desktop.completeWithLanguageServer({
                    documentId: currentDocument.id,
                    line: position.lineNumber - 1,
                    character: position.column - 1,
                    source,
                    sourceVersion: activeDocumentFound
                      ? openDocuments.find(({ documentId }) => documentId === currentDocument.id)!.sourceVersion
                      : currentDocument.sourceRevision + (currentDocument.source === source ? 0 : 1),
                    triggerCharacter: context.triggerCharacter,
                    openDocuments,
                  })
                  return toMonacoCompletions(monaco, result, range)
                } catch (error) {
                  reportError('tinymist-completion', error)
                  return { suggestions: [] }
                }
              },
            })
            const collapseInitialModel = () => {
              const model = editor.getModel()
              const modelId = model?.uri.toString()
              if (
                !foldingEnabledRef.current
                || !model
                || !modelId
                || initiallyCollapsedModelsRef.current.has(modelId)
              ) return
              initiallyCollapsedModelsRef.current.add(modelId)
              void setOutermostCollapsed(editor, true, true)
            }
            modelListenerRef.current?.dispose()
            modelListenerRef.current = editor.onDidChangeModel(() => {
              collapseInitialModel()
              applyDiagnostics(editor)
              updateHistoryAvailability(editor)
            })
            historyListenerRef.current?.dispose()
            historyListenerRef.current = editor.onDidChangeModelContent(() => updateHistoryAvailability(editor))
            editor.layout()
            if (vimEnabled) initializeVim(editor)
            cursorListenerRef.current?.dispose()
            mouseListenerRef.current?.dispose()
            collapseInitialModel()
            applyDiagnostics(editor)
            updateHistoryAvailability(editor)
            const reportPosition = (position: { lineNumber: number; column: number }) => {
              const model = editor.getModel()
              if (!model) return
              cursorPositionCallbackRef.current(position.lineNumber, position.column)
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
            const initialPosition = editor.getPosition()
            if (initialPosition) reportPosition(initialPosition)
          }}
          beforeMount={configureTypstLanguage}
          language="typst"
          path={`tedit://${document.id}.typ`}
          value={document.source}
          onChange={(value) => onChange(value ?? '')}
          theme={lightThemeEnabled ? 'vs' : 'vs-dark'}
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
            folding: foldingEnabled,
            showFoldingControls: foldingEnabled ? 'always' : 'never',
            quickSuggestions: autocompleteEnabled,
            suggestOnTriggerCharacters: autocompleteEnabled,
            wordBasedSuggestions: autocompleteEnabled ? 'matchingDocuments' : 'off',
            scrollBeyondLastLine: false,
            smoothScrolling: true,
            renderLineHighlight: 'none',
            overviewRulerBorder: false,
            guides: {
              indentation: false,
              bracketPairs: false,
              bracketPairsHorizontal: false,
              highlightActiveIndentation: false,
              highlightActiveBracketPair: false,
            },
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
      <div className="vim-status-bar" ref={vimStatusRef} aria-live="polite" />
    </div>
  )
}
