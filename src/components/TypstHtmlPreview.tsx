import type { EditorDocument, PreviewRoot } from '../types'

const HTML_PREVIEW_CSP = "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"

function securedHtml(html: string) {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${HTML_PREVIEW_CSP}">`
  return /<head(?:\s[^>]*)?>/i.test(html)
    ? html.replace(/<head(\s[^>]*)?>/i, (head) => `${head}${policy}`)
    : `${policy}${html}`
}

export function TypstHtmlPreview({
  document,
  previewRoots,
  onPreviewRootChange,
}: {
  document: EditorDocument
  previewRoots?: PreviewRoot[]
  onPreviewRootChange(filePath: string): void
}) {
  const html = document.html ? securedHtml(document.html) : undefined
  const current = document.htmlRevision === document.sourceRevision
    && document.htmlDependencyRevision === document.dependencyRevision
  const failed = document.compileTarget === 'html'
    && document.compileState === 'error'
    && document.attemptedRevision === document.sourceRevision
    && document.attemptedDependencyRevision === document.dependencyRevision
  const message = failed ? document.messages[0] : undefined

  return (
    <section className="preview-panel" aria-label="Typst HTML preview">
      <div className="panel-heading preview-heading">
        <span className="preview-title">
          <span className="preview-label">Typst HTML Preview</span>
          {previewRoots?.length === 1 && (
            <span className="preview-root-name" title={previewRoots[0].filePath}>
              <span className="preview-root-filename">{previewRoots[0].relativePath}</span>
            </span>
          )}
          {previewRoots && previewRoots.length > 1 && document.filePath && (
            <select
              className="preview-root-select"
              aria-label="Document to preview"
              value={document.previewRootPath ?? document.filePath}
              onChange={(event) => onPreviewRootChange(event.target.value)}
            >
              {previewRoots.map((root) => (
                <option key={root.filePath} value={root.filePath}>
                  {root.relativePath}{root.filePath === document.filePath ? ' (current)' : ''}
                </option>
              ))}
            </select>
          )}
        </span>
        <span className="html-preview-badge">Experimental</span>
      </div>
      <div className="preview-surface html-preview-surface">
        {html && (
          <iframe
            className="html-preview-frame"
            title="Rendered Typst HTML"
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={html}
          />
        )}
        {html && (!current || message) && (
          <div className={message ? 'preview-error' : 'html-preview-status'} role={message ? 'alert' : 'status'}>
            {message ?? 'Updating HTML preview...'}
          </div>
        )}
        {!html && (
          <div className="preview-empty">
            <div className={`loader ${message ? 'loader-error' : ''}`} />
            <strong>{message ? 'HTML preview unavailable' : 'Building HTML preview'}</strong>
            <span>{message ?? 'Typst HTML export is experimental and may take a moment.'}</span>
          </div>
        )}
      </div>
    </section>
  )
}
