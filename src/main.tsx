import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { loader } from '@monaco-editor/react'
import * as monaco from 'monaco-editor/editor/editor.api'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import 'monaco-editor/features/find/register'
import 'monaco-editor/features/folding/register'
import 'monaco-editor/features/hover/register'
import 'monaco-editor/features/gotoError/register'
import App from './App'
import { reportError } from './lib/logging'
import './styles.css'

self.MonacoEnvironment = {
  getWorker: () => new EditorWorker(),
}
loader.config({ monaco })

window.addEventListener('error', (event) => reportError('renderer-error', event.error ?? event.message))
window.addEventListener('unhandledrejection', (event) => reportError('unhandled-rejection', event.reason))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
