import { useEffect, useState } from 'react'
import { reportError } from '../lib/logging'
import type { AppSettings } from '../types'

function browserSetting(key: string, fallback: boolean) {
  const value = localStorage.getItem(key)
  return value === null ? fallback : value === 'true'
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
    window.typstDesktop?.getSettings().then((settings) => {
      setVimEnabled(settings.vimEnabled)
      setShowPreviewPosition(settings.showPreviewPosition)
      setAutoScrollEnabled(settings.autoScrollEnabled)
      setLightThemeEnabled(settings.lightThemeEnabled)
      setFoldingEnabled(settings.foldingEnabled)
      setAutocompleteEnabled(settings.autocompleteEnabled)
      setErrorHighlightingEnabled(settings.errorHighlightingEnabled)
      setAutomaticErrorPopupEnabled(settings.automaticErrorPopupEnabled)
    }).catch((error) => reportError('settings-load', error))
  }, [])

  const changeSetting = <Key extends keyof AppSettings>(
    key: Key,
    value: boolean,
    setter: (value: boolean) => void,
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
    changeVimEnabled: (value: boolean) => changeSetting('vimEnabled', value, setVimEnabled),
    changeShowPreviewPosition: (value: boolean) => changeSetting('showPreviewPosition', value, setShowPreviewPosition),
    changeAutoScrollEnabled: (value: boolean) => changeSetting('autoScrollEnabled', value, setAutoScrollEnabled),
    changeLightThemeEnabled: (value: boolean) => changeSetting('lightThemeEnabled', value, setLightThemeEnabled),
    changeFoldingEnabled: (value: boolean) => changeSetting('foldingEnabled', value, setFoldingEnabled),
    changeAutocompleteEnabled: (value: boolean) => changeSetting('autocompleteEnabled', value, setAutocompleteEnabled),
    changeErrorHighlightingEnabled: (value: boolean) => changeSetting('errorHighlightingEnabled', value, setErrorHighlightingEnabled),
    changeAutomaticErrorPopupEnabled: (value: boolean) => changeSetting('automaticErrorPopupEnabled', value, setAutomaticErrorPopupEnabled),
  }
}
