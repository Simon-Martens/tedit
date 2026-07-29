const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { logFailure } = require('./logging.cjs')

function registerDocumentationScheme(protocol) {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'tedit-docs',
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  }])
}

function configureDocumentationProtocol({ isDevelopment, net, protocol, resourcesPath }) {
  const docsRoot = path.resolve(isDevelopment
    ? path.join(__dirname, '..', 'resources', 'typst-docs', 'site')
    : path.join(resourcesPath, 'typst-docs', 'site'))
  protocol.handle('tedit-docs', async (request) => {
    const url = new URL(request.url)
    if (url.protocol !== 'tedit-docs:' || url.hostname !== 'docs') {
      logFailure('docs-protocol', new Error(`Rejected documentation URL ${request.url}.`))
      return new Response('Forbidden', { status: 403 })
    }
    let relativePath
    try {
      relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    } catch (error) {
      logFailure('docs-decode', error, { url: request.url })
      return new Response('Bad request', { status: 400 })
    }
    let filePath = path.resolve(docsRoot, relativePath || 'index.html')
    if (filePath !== docsRoot && !filePath.startsWith(`${docsRoot}${path.sep}`)) {
      return new Response('Forbidden', { status: 403 })
    }
    try {
      const stats = await fs.stat(filePath)
      if (stats.isDirectory()) filePath = path.join(filePath, 'index.html')
    } catch (error) {
      if (!path.extname(filePath)) filePath = path.join(filePath, 'index.html')
      else logFailure('docs-stat', error, { filePath })
    }
    try {
      const response = await net.fetch(pathToFileURL(filePath).href)
      const headers = new Headers(response.headers)
      headers.set(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
      )
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    } catch (error) {
      logFailure('docs-protocol', error, { filePath })
      return new Response('Documentation unavailable', { status: 500 })
    }
  })
}

function configurePermissions({ appEntryUrl, isDevelopment, session, trustedWebContentsIds }) {
  function isAppOrigin(webContents, origin) {
    if (!webContents || !trustedWebContentsIds.has(webContents.id)) return false
    try {
      const url = new URL(origin)
      return isDevelopment
        ? url.origin === new URL(appEntryUrl).origin
        : url.protocol === 'file:'
    } catch {
      return false
    }
  }

  const appSession = session.defaultSession
  appSession.webRequest.onErrorOccurred((details) => {
    if (trustedWebContentsIds.has(details.webContentsId)) {
      logFailure('network', new Error(details.error), {
        method: details.method,
        resourceType: details.resourceType,
        url: details.url,
      })
    }
  })
  appSession.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    if (permission === 'local-fonts' || permission === 'localFonts') {
      return isAppOrigin(webContents, requestingOrigin)
    }
    return false
  })
  appSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (permission === 'local-fonts' || permission === 'localFonts') {
      const origin = details.requestingUrl || webContents.getURL()
      callback(isAppOrigin(webContents, origin))
      return
    }
    callback(false)
  })
}

module.exports = { configureDocumentationProtocol, configurePermissions, registerDocumentationScheme }
