import type { SourceCursorLocation } from '../types'

export const WORD_PATTERN = /[\p{L}\p{N}\p{M}_]+/gu

export interface SourceSignature {
  before: string[]
  target: string
  after: string[]
  targetIndex: number
  targetOffset: number
  wordCount: number
  usesNearbyLine: boolean
}

const textEncoder = new TextEncoder()

export function normalizeWord(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase()
}

function utf8ByteToStringIndex(text: string, byteOffset: number) {
  let bytes = 0
  let index = 0
  for (const character of text) {
    const nextBytes = bytes + textEncoder.encode(character).length
    if (nextBytes > byteOffset) break
    bytes = nextBytes
    index += character.length
  }
  return index
}

export function sourceSignature(source: string, location: SourceCursorLocation): SourceSignature | undefined {
  const lines = source.split(/\r?\n/)
  let sourcePosition = location.cursor
  const cursorLine = lines[location.cursor.line]
  if (cursorLine === undefined || !/[\p{L}\p{N}\p{M}_]/u.test(cursorLine)) {
    sourcePosition = location.lookup
  }
  if (cursorLine !== undefined && location.cursor.line === location.lookup.line) {
    const cursorIndex = utf8ByteToStringIndex(cursorLine, location.cursor.character)
    for (const link of cursorLine.matchAll(/#link\s*\([^)]*\)\s*\[([^\]]*)\]/g)) {
      const start = link.index ?? 0
      const bodyStart = start + link[0].lastIndexOf(link[1])
      if (cursorIndex >= start && cursorIndex < bodyStart) sourcePosition = location.lookup
    }
  }
  const line = lines[sourcePosition.line]
  if (line === undefined) return undefined
  const index = utf8ByteToStringIndex(line, sourcePosition.character)
  const words = [...line.matchAll(WORD_PATTERN)]
  if (!words.length) return undefined
  let targetIndex = words.findIndex((word) => {
    const start = word.index ?? 0
    return start <= index && index <= start + word[0].length
  })
  if (targetIndex < 0) {
    targetIndex = words.reduce((closest, word, candidateIndex) => (
      Math.abs((word.index ?? 0) - index) < Math.abs((words[closest].index ?? 0) - index)
        ? candidateIndex
        : closest
    ), 0)
  }
  const targetWord = words[targetIndex]
  const targetStart = targetWord.index ?? 0
  return {
    before: words.slice(Math.max(0, targetIndex - 4), targetIndex).map((word) => normalizeWord(word[0])),
    target: normalizeWord(targetWord[0]),
    after: words.slice(targetIndex + 1, targetIndex + 5).map((word) => normalizeWord(word[0])),
    targetIndex,
    targetOffset: Math.max(0, Math.min(targetWord[0].length, index - targetStart)),
    wordCount: words.length,
    usesNearbyLine: sourcePosition.line !== location.cursor.line,
  }
}
