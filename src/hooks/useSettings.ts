import { useEffect, useState } from 'react'
import { reportError } from '../lib/logging'
import type { AppSettings, PreviewMode } from '../types'

function browserSetting(key: string, fallback: boolean) {
  const value = localStorage.getItem(key)
  return value === null ? fallback : value === 'true'
}

function browserNumberSetting(key: string, fallback: number) {
  const stored = localStorage.getItem(key)
  if (stored === null) return fallback
  const value = Number(stored)
  return Number.isFinite(value) ? value : fallback
}

function browserPreviewMode(): PreviewMode {
  const value = localStorage.getItem('tedit.preview-mode')
  if (value === 'svg' || value === 'canvas' || value === 'dom' || value === 'html') return value
  return browserSetting('tedit.canvas-preview', false) ? 'canvas' : 'svg'
}

export function useSettings() {
  const [loaded, setLoaded] = useState(() => !window.typstDesktop)
  const [vimEnabled, setVimEnabled] = useState(() => (
    window.typstDesktop ? false : browserSetting('tedit.vim-mode', false)
  ))
  const [showPreviewPosition, setShowPreviewPosition] = useState(() => (
    window.typstDesktop ? false : browserSetting('tedit.show-preview-position', false)
  ))
  const [previewClickNavigationEnabled, setPreviewClickNavigationEnabled] = useState(() => (
    window.typstDesktop ? true : browserSetting('tedit.preview-click-navigation', true)
  ))
  const [previewMode, setPreviewMode] = useState<PreviewMode>(() => (
    window.typstDesktop ? 'svg' : browserPreviewMode()
  ))
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(() => (
    window.typstDesktop ? true : browserSetting('tedit.autoscroll', true)
  ))
  const [lightThemeEnabled, setLightThemeEnabled] = useState(() => (
    window.typstDesktop ? false : browserSetting('tedit.light-theme', false)
  ))
  const [foldingEnabled, setFoldingEnabled] = useState(() => (
    window.typstDesktop ? true : browserSetting('tedit.code-folding', true)
  ))
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(() => (
    window.typstDesktop ? true : browserSetting('tedit.autocomplete', true)
  ))
  const [semanticHighlightingEnabled, setSemanticHighlightingEnabled] = useState(() => (
    window.typstDesktop ? true : browserSetting('tedit.semantic-highlighting', true)
  ))
  const [errorHighlightingEnabled, setErrorHighlightingEnabled] = useState(() => (
    window.typstDesktop ? true : browserSetting('tedit.error-highlighting', true)
  ))
  const [automaticErrorPopupEnabled, setAutomaticErrorPopupEnabled] = useState(() => (
    window.typstDesktop ? true : browserSetting('tedit.automatic-error-popup', true)
  ))
  const [previewRenderBackoffMs, setPreviewRenderBackoffMs] = useState(() => (
    window.typstDesktop ? 180 : browserNumberSetting('tedit.preview-render-backoff-ms', 180)
  ))

  useEffect(() => {
    if (!window.typstDesktop) localStorage.setItem('tedit.vim-mode', String(vimEnabled))
  }, [vimEnabled])

  useEffect(() => {
    if (!window.typstDesktop) localStorage.setItem('tedit.show-preview-position', String(showPreviewPosition))
  }, [showPreviewPosition])

  useEffect(() => {
    if (!window.typstDesktop) {
      localStorage.setItem('tedit.preview-click-navigation', String(previewClickNavigationEnabled))
    }
  }, [previewClickNavigationEnabled])

  useEffect(() => {
    if (!window.typstDesktop) localStorage.setItem('tedit.preview-mode', previewMode)
  }, [previewMode])

  useEffect(() => {
    if (!window.typstDesktop) localStorage.setItem('tedit.autoscroll', String(autoScrollEnabled))
  }, [autoScrollEnabled])

  useEffect(() => {
    if (!window.typstDesktop) localStorage.setItem('tedit.light-theme', String(lightThemeEnabled))
  }, [lightThemeEnabled])

  useEffect(() => {
    if (!window.typstDesktop) localStorage.setItem('tedit.code-folding', String(foldingEnabled))
  }, [foldingEnabled])

  useEffect(() => {
    if (!window.typstDesktop) localStorage.setItem('tedit.autocomplete', String(autocompleteEnabled))
  }, [autocompleteEnabled])

  useEffect(() => {
    if (!window.typstDesktop) localStorage.setItem('tedit.semantic-highlighting', String(semanticHighlightingEnabled))
  }, [semanticHighlightingEnabled])

  useEffect(() => {
    if (!window.typstDesktop) localStorage.setItem('tedit.error-highlighting', String(errorHighlightingEnabled))
  }, [errorHighlightingEnabled])

  useEffect(() => {
    if (!window.typstDesktop) localStorage.setItem('tedit.automatic-error-popup', String(automaticErrorPopupEnabled))
  }, [automaticErrorPopupEnabled])

  useEffect(() => {
    if (!window.typstDesktop) localStorage.setItem('tedit.preview-render-backoff-ms', String(previewRenderBackoffMs))
  }, [previewRenderBackoffMs])

  useEffect(() => {
    const desktop = window.typstDesktop
    if (!desktop) return
    let cancelled = false
    desktop.getSettings().then((settings) => {
      if (cancelled) return
      setVimEnabled(settings.vimEnabled)
      setShowPreviewPosition(settings.showPreviewPosition)
      setPreviewClickNavigationEnabled(settings.previewClickNavigationEnabled)
      setPreviewMode(settings.previewMode)
      setAutoScrollEnabled(settings.autoScrollEnabled)
      setLightThemeEnabled(settings.lightThemeEnabled)
      setFoldingEnabled(settings.foldingEnabled)
      setAutocompleteEnabled(settings.autocompleteEnabled)
      setSemanticHighlightingEnabled(settings.semanticHighlightingEnabled)
      setErrorHighlightingEnabled(settings.errorHighlightingEnabled)
      setAutomaticErrorPopupEnabled(settings.automaticErrorPopupEnabled)
      setPreviewRenderBackoffMs(settings.previewRenderBackoffMs)
    }).catch((error) => {
      if (!cancelled) reportError('settings-load', error)
    }).finally(() => {
      if (!cancelled) setLoaded(true)
    })
    return () => { cancelled = true }
  }, [])

  const changeSetting = <Key extends keyof AppSettings>(
    key: Key,
    value: AppSettings[Key],
    setter: (value: AppSettings[Key]) => void,
  ) => {
    setter(value)
    void window.typstDesktop?.updateSettings({ [key]: value }).catch((error) => reportError('settings-update', error))
  }

  return {
    loaded,
    vimEnabled,
    showPreviewPosition,
    previewClickNavigationEnabled,
    previewMode,
    autoScrollEnabled,
    lightThemeEnabled,
    foldingEnabled,
    autocompleteEnabled,
    semanticHighlightingEnabled,
    errorHighlightingEnabled,
    automaticErrorPopupEnabled,
    previewRenderBackoffMs,
    changeVimEnabled: (value: boolean) => changeSetting('vimEnabled', value, setVimEnabled),
    changeShowPreviewPosition: (value: boolean) => changeSetting('showPreviewPosition', value, setShowPreviewPosition),
    changePreviewClickNavigationEnabled: (value: boolean) => changeSetting(
      'previewClickNavigationEnabled',
      value,
      setPreviewClickNavigationEnabled,
    ),
    changePreviewMode: (value: PreviewMode) => changeSetting(
      'previewMode',
      value,
      setPreviewMode,
    ),
    changeAutoScrollEnabled: (value: boolean) => changeSetting('autoScrollEnabled', value, setAutoScrollEnabled),
    changeLightThemeEnabled: (value: boolean) => changeSetting('lightThemeEnabled', value, setLightThemeEnabled),
    changeFoldingEnabled: (value: boolean) => changeSetting('foldingEnabled', value, setFoldingEnabled),
    changeAutocompleteEnabled: (value: boolean) => changeSetting('autocompleteEnabled', value, setAutocompleteEnabled),
    changeSemanticHighlightingEnabled: (value: boolean) => changeSetting(
      'semanticHighlightingEnabled',
      value,
      setSemanticHighlightingEnabled,
    ),
    changeErrorHighlightingEnabled: (value: boolean) => changeSetting('errorHighlightingEnabled', value, setErrorHighlightingEnabled),
    changeAutomaticErrorPopupEnabled: (value: boolean) => changeSetting('automaticErrorPopupEnabled', value, setAutomaticErrorPopupEnabled),
    changePreviewRenderBackoffMs: (value: number) => changeSetting(
      'previewRenderBackoffMs',
      Math.max(0, Math.min(5_000, Math.round(value))),
      setPreviewRenderBackoffMs,
    ),
  }
}
