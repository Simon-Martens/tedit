import { useEffect } from 'react'

interface ShortcutCommands {
  open(): void
  save(): void
  create(): void
  close(): void
}

export function useShortcuts(commands: ShortcutCommands) {
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const key = event.key.toLowerCase()
      if (key === 'o') {
        event.preventDefault()
        commands.open()
      } else if (key === 's') {
        event.preventDefault()
        commands.save()
      } else if (key === 'n') {
        event.preventDefault()
        commands.create()
      } else if (key === 'w') {
        event.preventDefault()
        commands.close()
      }
    }

    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  })
}
