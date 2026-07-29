import type * as Monaco from 'monaco-editor'
import type {
  LanguageServerCompletionItem,
  LanguageServerCompletionRange,
  LanguageServerCompletionResult,
} from '../types'

function toRange(range: LanguageServerCompletionRange): Monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  }
}

function completionKind(monaco: typeof Monaco, kind?: number) {
  const kinds = monaco.languages.CompletionItemKind
  return [
    kinds.Text,
    kinds.Method,
    kinds.Function,
    kinds.Constructor,
    kinds.Field,
    kinds.Variable,
    kinds.Class,
    kinds.Interface,
    kinds.Module,
    kinds.Property,
    kinds.Unit,
    kinds.Value,
    kinds.Enum,
    kinds.Keyword,
    kinds.Snippet,
    kinds.Color,
    kinds.File,
    kinds.Reference,
    kinds.Folder,
    kinds.EnumMember,
    kinds.Constant,
    kinds.Struct,
    kinds.Event,
    kinds.Operator,
    kinds.TypeParameter,
  ][Math.max(0, (kind ?? 1) - 1)] ?? kinds.Text
}

function itemRange(
  item: LanguageServerCompletionItem,
  defaultRange: Monaco.IRange,
  defaultEditRange?: LanguageServerCompletionRange | {
    insert: LanguageServerCompletionRange
    replace: LanguageServerCompletionRange
  },
) {
  if (item.textEdit?.insert && item.textEdit.replace) {
    return { insert: toRange(item.textEdit.insert), replace: toRange(item.textEdit.replace) }
  }
  if (item.textEdit?.range) return toRange(item.textEdit.range)
  if (defaultEditRange && 'replace' in defaultEditRange) {
    return { insert: toRange(defaultEditRange.insert), replace: toRange(defaultEditRange.replace) }
  }
  if (defaultEditRange) return toRange(defaultEditRange)
  return defaultRange
}

export function toMonacoCompletions(
  monaco: typeof Monaco,
  result: LanguageServerCompletionResult,
  defaultRange: Monaco.IRange,
): Monaco.languages.CompletionList {
  const list = Array.isArray(result) ? undefined : result
  const items = Array.isArray(result) ? result : result?.items ?? []
  return {
    incomplete: list?.isIncomplete,
    suggestions: items.map((item) => {
      const label = typeof item.label === 'string' ? item.label : item.label.label
      const documentation = typeof item.documentation === 'string'
        ? item.documentation
        : item.documentation?.value ? { value: item.documentation.value } : undefined
      const insertTextFormat = item.insertTextFormat ?? list?.itemDefaults?.insertTextFormat
      return {
        label: item.label,
        kind: completionKind(monaco, item.kind),
        detail: item.detail,
        documentation,
        sortText: item.sortText,
        filterText: item.filterText,
        preselect: item.preselect,
        commitCharacters: item.commitCharacters ?? list?.itemDefaults?.commitCharacters,
        insertText: item.textEdit?.newText ?? item.textEditText ?? item.insertText ?? label,
        insertTextRules: insertTextFormat === 2
          ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
        range: itemRange(item, defaultRange, list?.itemDefaults?.editRange),
        additionalTextEdits: item.additionalTextEdits?.map((edit) => ({
          text: edit.newText,
          range: toRange(edit.range),
        })),
      }
    }),
  }
}
