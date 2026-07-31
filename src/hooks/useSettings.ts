import { useEffect, useState } from 'react'
import { reportError } from '../lib/logging'
import type { AppSettings } from '../types'

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

export function useSettings() {
  const [vimEnabled, setVimEnabled] = useState(() => (
    window.typstDesktop ? false : browserSetting('tedit.vim-mode', false)
  ))
  const [showPreviewPosition, setShowPreviewPosition] = useState(() => (
    window.typstDesktop ? false : browserSetting('tedit.show-preview-position', false)
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
    if (!window.typstDesktop) localStorage.setItem('tedit.error-highlighting', String(errorHighlightingEnabled))
  }, [errorHighlightingEnabled])

  useEffect(() => {
    if (!window.typstDesktop) localStorage.setItem('tedit.automatic-error-popup', String(automaticErrorPopupEnabled))
  }, [automaticErrorPopupEnabled])

  useEffect(() => {
    if (!window.typstDesktop) localStorage.setItem('tedit.preview-render-backoff-ms', String(previewRenderBackoffMs))
  }, [previewRenderBackoffMs])

  useEffect(() => {
    window.typstDesktop?.getSettings().then((settings) => {
      setVimEnabled(settings.vimEnabled)
      setShowPreviewPosition(settings.showPreviewPosition)
      setAutoScrollEnabled(settings.autoScrollEnabled)
      setLightThemeEnabled(settings.lightThemeEnabled)
      setFoldingEnabled(settings.foldingEnabled)
      setAutocompleteEnabled(settings.autocompleteEnabled)
      setErrorHighlightingEnabled(settings.errorHighlightingEnabled)
      setAutomaticErrorPopupEnabled(settings.automaticErrorPopupEnabled)
      setPreviewRenderBackoffMs(settings.previewRenderBackoffMs)
    }).catch((error) => reportError('settings-load', error))
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
    vimEnabled,
    showPreviewPosition,
    autoScrollEnabled,
    lightThemeEnabled,
    foldingEnabled,
    autocompleteEnabled,
    errorHighlightingEnabled,
    automaticErrorPopupEnabled,
    previewRenderBackoffMs,
    changeVimEnabled: (value: boolean) => changeSetting('vimEnabled', value, setVimEnabled),
    changeShowPreviewPosition: (value: boolean) => changeSetting('showPreviewPosition', value, setShowPreviewPosition),
    changeAutoScrollEnabled: (value: boolean) => changeSetting('autoScrollEnabled', value, setAutoScrollEnabled),
    changeLightThemeEnabled: (value: boolean) => changeSetting('lightThemeEnabled', value, setLightThemeEnabled),
    changeFoldingEnabled: (value: boolean) => changeSetting('foldingEnabled', value, setFoldingEnabled),
    changeAutocompleteEnabled: (value: boolean) => changeSetting('autocompleteEnabled', value, setAutocompleteEnabled),
    changeErrorHighlightingEnabled: (value: boolean) => changeSetting('errorHighlightingEnabled', value, setErrorHighlightingEnabled),
    changeAutomaticErrorPopupEnabled: (value: boolean) => changeSetting('automaticErrorPopupEnabled', value, setAutomaticErrorPopupEnabled),
    changePreviewRenderBackoffMs: (value: number) => changeSetting(
      'previewRenderBackoffMs',
      Math.max(0, Math.min(5_000, Math.round(value))),
      setPreviewRenderBackoffMs,
    ),
  }
}
