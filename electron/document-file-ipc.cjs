const { execFile } = require('node:child_process')
const fs = require('node:fs/promises')
const path = require('node:path')
const { promisify } = require('node:util')
const { logFailure } = require('./logging.cjs')

const execFileAsync = promisify(execFile)

async function getGitMetadata(filePath) {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', path.dirname(filePath), 'rev-parse', '--show-toplevel', '--short=8', 'HEAD'],
      { timeout: 3000 },
    )
    const [root, commit] = stdout.trim().split(/\r?\n/)
    return { repoName: path.basename(root), commit: commit || undefined, workspaceRoot: root }
  } catch {
    return { workspaceRoot: path.dirname(filePath) }
  }
}

function createDocumentFileIpc({ BrowserWindow, dialog, handleIpc, registry, shell }) {
  const documentSaveQueues = new Map()

  function queueDocumentSave(filePath, save) {
    const previous = documentSaveQueues.get(filePath) ?? Promise.resolve()
    const queued = previous.catch(() => undefined).then(save)
    const tracked = queued.finally(() => {
      if (documentSaveQueues.get(filePath) === tracked) documentSaveQueues.delete(filePath)
    })
    documentSaveQueues.set(filePath, tracked)
    return tracked
  }

  handleIpc('document:open', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Open Typst document',
      properties: ['openFile'],
      filters: [{ name: 'Typst documents', extensions: ['typ'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null

    const filePath = registry.normalizeDocumentPath(result.filePaths[0])
    const [content, gitMetadata] = await Promise.all([
      fs.readFile(filePath, 'utf8'),
      getGitMetadata(filePath),
    ])
    const remembered = registry.rememberDocument(filePath, content)
    registry.setWorkspaceRoot(remembered.filePath, gitMetadata.workspaceRoot)
    return {
      ...remembered,
      name: path.basename(filePath),
      content,
      ...gitMetadata,
    }
  })

  handleIpc('document:save', async (_event, request) => {
    let filePath = request.filePath ? registry.normalizeDocumentPath(request.filePath) : undefined
    const shouldValidateDiskVersion = Boolean(filePath)
    if (filePath && !registry.isAllowed(filePath)) {
      throw new Error('Refusing to write a file that was not opened by tedit.')
    }
    if (!filePath) {
      const result = await dialog.showSaveDialog({
        title: 'Save Typst document',
        defaultPath: request.name,
        filters: [{ name: 'Typst documents', extensions: ['typ'] }],
      })
      if (result.canceled || !result.filePath) return null
      filePath = registry.normalizeDocumentPath(result.filePath.toLowerCase().endsWith('.typ')
        ? result.filePath
        : `${result.filePath}.typ`)
    }

    return queueDocumentSave(filePath, async () => {
      if (shouldValidateDiskVersion && 'expectedDiskVersion' in request) {
        try {
          const content = await fs.readFile(filePath, 'utf8')
          const diskVersion = registry.contentVersion(content)
          if (request.expectedDiskVersion === null || diskVersion !== request.expectedDiskVersion) {
            registry.setDiskVersion(filePath, diskVersion)
            return { filePath, kind: 'changed', content, diskVersion }
          }
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
          if (request.expectedDiskVersion !== null) return { filePath, kind: 'deleted' }
        }
      }

      const temporaryPath = `${filePath}.tedit-${process.pid}-${Date.now()}.tmp`
      try {
        await fs.writeFile(temporaryPath, request.content, 'utf8')
        await fs.rename(temporaryPath, filePath)
      } finally {
        await fs.rm(temporaryPath, { force: true }).catch((error) => {
          logFailure('document-save-cleanup', error, { temporaryPath })
        })
      }
      const remembered = registry.rememberDocument(filePath, request.content)
      const gitMetadata = await getGitMetadata(filePath)
      registry.setWorkspaceRoot(remembered.filePath, gitMetadata.workspaceRoot)
      return {
        ...remembered,
        name: path.basename(filePath),
        ...gitMetadata,
      }
    })
  })

  handleIpc('document:delete', async (event, request) => {
    if (
      typeof request?.filePath !== 'string'
      || typeof request.expectedDiskVersion !== 'string'
    ) throw new Error('Invalid document deletion request.')
    const filePath = registry.normalizeDocumentPath(request.filePath)
    if (!registry.isAllowed(filePath)) throw new Error('Refusing to delete a file that was not opened by tedit.')

    return queueDocumentSave(filePath, async () => {
      const inspect = async () => {
        const stat = await fs.lstat(filePath, { bigint: true })
        if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Only regular Typst files can be deleted.')
        const content = await fs.readFile(filePath, 'utf8')
        if (registry.contentVersion(content) !== request.expectedDiskVersion) {
          throw new Error('The file changed on disk. Reload it before deleting.')
        }
        return { device: stat.dev, inode: stat.ino }
      }
      const identity = await inspect()
      const owner = BrowserWindow.fromWebContents(event.sender)
      const options = {
        type: 'warning',
        title: 'Delete Typst file',
        message: `Move ${path.basename(filePath)} to the trash?`,
        detail: 'Unsaved source and bibliography changes will be discarded.',
        buttons: ['Cancel', 'Move to Trash'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      }
      const result = owner
        ? await dialog.showMessageBox(owner, options)
        : await dialog.showMessageBox(options)
      if (result.response !== 1) return false
      const confirmedIdentity = await inspect()
      if (confirmedIdentity.device !== identity.device || confirmedIdentity.inode !== identity.inode) {
        throw new Error('The file was replaced while deletion was being confirmed.')
      }
      await shell.trashItem(filePath)
      registry.forgetDocument(filePath)
      return true
    })
  })

  handleIpc('document:resolve-conflict', async (event, request) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const deleted = Boolean(request?.deleted)
    const options = {
      type: 'warning',
      title: deleted ? 'File deleted outside tedit' : 'File changed outside tedit',
      message: deleted
        ? `${request.name} was deleted outside tedit.`
        : `${request.name} changed on disk while you have unsaved edits.`,
      detail: deleted
        ? 'Keep the editor version to recreate it on the next save.'
        : 'Reloading discards your unsaved edits. Keeping them allows the next save to replace the disk version.',
      buttons: deleted ? ['Keep Editor Version'] : ['Reload from Disk', 'Keep My Changes'],
      defaultId: 0,
      cancelId: deleted ? 0 : 1,
      noLink: true,
    }
    const result = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options)
    return !deleted && result.response === 0 ? 'reload' : 'keep'
  })
}

module.exports = { createDocumentFileIpc, getGitMetadata }
