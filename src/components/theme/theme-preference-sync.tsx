'use client'

import { useEffect } from 'react'
import {
  applyThemePreferences,
  isThemeAutoOverrideActive,
  readStoredThemePreferences,
  resolveThemeAppearanceMode,
  THEME_PREFERENCES_CHANGED_EVENT,
  writeStoredThemePreferences,
} from '@/lib/theme/theme-preference'

const THEME_SYNC_INTERVAL_MS = 15_000

function syncThemePreferences() {
  const preferences = readStoredThemePreferences()
  const resolvedTheme = resolveThemeAppearanceMode(preferences)

  applyThemePreferences(preferences)

  if (
    preferences.themeMode === 'auto' &&
    preferences.themeAutoOverrideMode &&
    preferences.themeAutoOverrideUntil &&
    !isThemeAutoOverrideActive(preferences)
  ) {
    writeStoredThemePreferences({
      themeMode: 'auto',
      themeAutoOverrideMode: null,
      themeAutoOverrideUntil: null,
    })
    return
  }

  return resolvedTheme
}

export function ThemePreferenceSync() {
  useEffect(() => {
    syncThemePreferences()

    const intervalId = window.setInterval(() => {
      syncThemePreferences()
    }, THEME_SYNC_INTERVAL_MS)

    function handleStorageChange() {
      syncThemePreferences()
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        syncThemePreferences()
      }
    }

    window.addEventListener('storage', handleStorageChange)
    window.addEventListener(THEME_PREFERENCES_CHANGED_EVENT, handleStorageChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('storage', handleStorageChange)
      window.removeEventListener(THEME_PREFERENCES_CHANGED_EVENT, handleStorageChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return null
}
