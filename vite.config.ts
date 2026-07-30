import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
  optimizeDeps: {
    include: ['monaco-editor/editor/contrib/suggest/browser/suggestController'],
  },
  resolve: {
    alias: {
      'monaco-editor/esm/vs/editor/editor.api': 'monaco-editor/editor/editor.api',
    },
  },
})
