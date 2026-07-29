export function reportError(scope: string, error: unknown) {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  if (
    name === 'AbortError'
    || name === 'AbortException'
    || name === 'RenderingCancelledException'
    || /cancelled|canceled|superseded/i.test(message)
  ) return
  console.error(`[tedit:${scope}]`, error)
}
