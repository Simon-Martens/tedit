import { spawn } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(projectRoot, 'tedit.svg')
const outputDirectory = path.join(projectRoot, 'build')
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'tedit-icons-'))
const svg = path.join(temporaryDirectory, 'icon.svg')
const png = path.join(temporaryDirectory, 'icon.png')
const ico = path.join(temporaryDirectory, 'icon.ico')

function run(command, arguments_) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, arguments_, { cwd: projectRoot, stdio: 'inherit' })
    child.once('error', (error) => {
      if (error.code === 'ENOENT') {
        reject(new Error(`${command} is required to generate application icons.`))
      } else reject(error)
    })
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with code ${code}.`))
    })
  })
}

try {
  await run('inkscape', [
    source,
    '--export-text-to-path',
    '--export-plain-svg',
    `--export-filename=${svg}`,
  ])
  await run('inkscape', [
    svg,
    '--export-type=png',
    '--export-width=512',
    '--export-height=512',
    `--export-filename=${png}`,
  ])
  await run('magick', [
    png,
    '-define',
    'icon:auto-resize=256,128,64,48,32,16',
    ico,
  ])

  await mkdir(outputDirectory, { recursive: true })
  await Promise.all([
    copyFile(svg, path.join(outputDirectory, 'icon.svg')),
    copyFile(png, path.join(outputDirectory, 'icon.png')),
    copyFile(ico, path.join(outputDirectory, 'icon.ico')),
  ])
  console.log(`Generated application icons from ${source}.`)
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true })
}
