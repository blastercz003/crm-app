'use client'

import { useEffect, useState } from 'react'
import { updateMyThemePreferencesAction } from '@/app/dashboard/theme-actions'
import { createClient } from '@/lib/supabase/client'
import {
  applyThemePreferences,
  readStoredThemePreferences,
  resolveThemeAppearanceMode,
  type ThemePreferences,
  writeStoredThemePreferences,
} from '@/lib/theme/theme-preference'

type ThemePreferenceRow = {
  theme_mode: 'light' | 'dark' | 'auto' | null
  theme_auto_override_mode: 'light' | 'dark' | null
  theme_auto_override_until: string | null
}

export function ThemeAutoToggleWidget() {
  const supabase = createClient()
  const [themePreferences, setThemePreferences] = useState<ThemePreferences>(() =>
    readStoredThemePreferences()
  )
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isReady, setIsReady] = useState(false)

  const isEnabled = themePreferences.themeMode === 'auto'

  useEffect(() => {
    let cancelled = false

    async function loadThemePreferences() {
      const { data: authData } = await supabase.auth.getUser()
      const user = authData.user

      if (!user) {
        if (!cancelled) setIsLoading(false)
        if (!cancelled) setIsReady(true)
        return
      }

      const { data } = await supabase
        .from('profiles')
        .select('theme_mode, theme_auto_override_mode, theme_auto_override_until')
        .eq('id', user.id)
        .maybeSingle<ThemePreferenceRow>()

      if (!cancelled && data) {
        setThemePreferences({
          themeMode: data.theme_mode ?? 'light',
          themeAutoOverrideMode: data.theme_auto_override_mode ?? null,
          themeAutoOverrideUntil: data.theme_auto_override_until ?? null,
        })
      }

      if (!cancelled) setIsLoading(false)
      if (!cancelled) setIsReady(true)
    }

    void loadThemePreferences()

    return () => {
      cancelled = true
    }
  }, [supabase])

  useEffect(() => {
    if (!isReady) return

    applyThemePreferences(themePreferences)
    writeStoredThemePreferences(themePreferences)
  }, [isReady, themePreferences])

  async function handleToggle() {
    if (isSaving || isLoading) return

    const previousPreferences = themePreferences
    const currentAppearanceThemeMode = resolveThemeAppearanceMode(themePreferences)
    const nextPreferences: ThemePreferences = isEnabled
      ? {
          themeMode: currentAppearanceThemeMode,
          themeAutoOverrideMode: null,
          themeAutoOverrideUntil: null,
        }
      : {
          themeMode: 'auto',
          themeAutoOverrideMode: null,
          themeAutoOverrideUntil: null,
        }

    setThemePreferences(nextPreferences)
    setIsSaving(true)

    const result = await updateMyThemePreferencesAction({
      themeMode: nextPreferences.themeMode,
      themeAutoOverrideMode: nextPreferences.themeAutoOverrideMode,
      themeAutoOverrideUntil: nextPreferences.themeAutoOverrideUntil,
    })

    if (!result.success) {
      setThemePreferences(previousPreferences)
    }

    setIsSaving(false)
  }

  const statusLabel = isEnabled ? 'Aktivní' : 'Neaktivní'
  const toggleAriaLabel = `Automaticky měnit barvu appky ${isEnabled ? 'vypnuto' : 'zapnuto'}`
  const thumbLabel = isEnabled ? 'ON' : 'OFF'
  const toggleSwitchClass = isEnabled
    ? 'border-[#5f9dca] bg-[linear-gradient(160deg,#5fa4d3_0%,#3f84bb_100%)]'
    : 'border-zinc-300 bg-zinc-200/90'

  return (
    <div className="password-page__widget-card rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="password-page__widget-title text-sm font-semibold text-zinc-900">
            Automaticky měnit barvu appky
          </div>
          <p className="password-page__widget-subtitle mt-1 text-xs text-zinc-500">
            DARK: 20:00 - 9:00.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span className="password-page__toggle-state text-xs font-semibold text-zinc-600">
            {statusLabel}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={isEnabled}
            aria-label={toggleAriaLabel}
            onClick={handleToggle}
            disabled={isSaving || isLoading}
            className={`password-page__toggle relative inline-flex h-7 w-12 items-center rounded-full border transition duration-200 ${toggleSwitchClass}`}
          >
            <span
              className={`password-page__toggle-thumb inline-block h-5 w-5 transform rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.22)] transition duration-200 ${
                isEnabled ? 'translate-x-[24px]' : 'translate-x-[2px]'
              }`}
            >
              <span className="sr-only">{thumbLabel}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}
