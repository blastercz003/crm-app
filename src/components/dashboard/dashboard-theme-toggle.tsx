'use client'

import { useEffect, useState } from 'react'
import { updateMyThemePreferencesAction } from '@/app/dashboard/theme-actions'
import {
  applyThemePreferences,
  getNextAutoThemeChangeAt,
  resolveThemeAppearanceMode,
  type ThemeAppearanceMode,
  type ThemePreferences,
  writeStoredThemePreferences,
} from '@/lib/theme/theme-preference'

type DashboardThemeToggleProps = {
  initialThemePreferences: ThemePreferences
}

export function DashboardThemeToggle({
  initialThemePreferences,
}: DashboardThemeToggleProps) {
  const [themePreferences, setThemePreferences] = useState<ThemePreferences>(
    initialThemePreferences
  )
  const [, setThemeClockTick] = useState(0)
  const [isSaving, setIsSaving] = useState(false)
  const effectiveThemeMode = resolveThemeAppearanceMode(themePreferences)

  useEffect(() => {
    applyThemePreferences(themePreferences)
    writeStoredThemePreferences(themePreferences)
  }, [themePreferences])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setThemeClockTick((value) => value + 1)
    }, 15_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [])

  async function handleToggle() {
    if (isSaving) return

    const previousPreferences = themePreferences
    const currentAppearanceThemeMode = resolveThemeAppearanceMode(themePreferences)
    const nextAppearanceThemeMode: ThemeAppearanceMode =
      currentAppearanceThemeMode === 'light' ? 'dark' : 'light'
    const nextPreferences: ThemePreferences =
      themePreferences.themeMode === 'auto'
        ? {
            themeMode: 'auto',
            themeAutoOverrideMode: nextAppearanceThemeMode,
            themeAutoOverrideUntil: getNextAutoThemeChangeAt().toISOString(),
          }
        : {
            themeMode: nextAppearanceThemeMode,
            themeAutoOverrideMode: null,
            themeAutoOverrideUntil: null,
          }

    setThemePreferences(nextPreferences)
    setIsSaving(true)

    const result = await updateMyThemePreferencesAction(nextPreferences)

    if (!result.success) {
      setThemePreferences(previousPreferences)
    }

    setIsSaving(false)
  }

  const isDark = effectiveThemeMode === 'dark'
  const isAuto = themePreferences.themeMode === 'auto'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={`Theme ${isDark ? 'dark' : 'light'}${isAuto ? ' (auto)' : ''}`}
      onClick={handleToggle}
      disabled={isSaving}
      className={[
        'dashboard-theme-toggle relative inline-flex h-7 w-[132px] shrink-0 items-center rounded-full border p-[2px] text-[9px] font-semibold uppercase tracking-[0.14em] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_8px_18px_rgba(0,0,0,0.28)] transition duration-300 ease-out sm:w-[160px]',
        isDark
          ? 'dashboard-theme-toggle--dark border-[#2f77af]/70 bg-[linear-gradient(180deg,rgba(15,23,42,0.96)_0%,rgba(12,20,34,0.98)_100%)] text-white/90'
          : 'dashboard-theme-toggle--light border-white/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.18)_0%,rgba(255,255,255,0.08)_100%)] text-white/90',
        isSaving ? 'opacity-90' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <span
        className={`dashboard-theme-toggle__label dashboard-theme-toggle__label--light absolute inset-y-0 left-0 flex w-1/2 items-center justify-center pl-2.5 ${
          isDark ? 'text-white/40' : 'text-[#1f4f73]'
        }`}
      >
        LIGHT
      </span>
      <span
        className={`dashboard-theme-toggle__label dashboard-theme-toggle__label--dark absolute inset-y-0 right-0 flex w-1/2 items-center justify-center pr-2.5 ${
          isDark ? 'text-white/92' : 'text-white/42'
        }`}
      >
        DARK
      </span>
      <span
        className={[
          'dashboard-theme-toggle__thumb relative z-10 inline-flex h-[22px] w-[calc(50%)] items-center justify-center rounded-full px-2 text-[9px] font-semibold uppercase tracking-[0.14em] transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
          isDark
            ? 'translate-x-[calc(100%+0px)] border border-[#2f77af]/55 bg-[linear-gradient(180deg,rgba(44,96,141,0.98)_0%,rgba(22,43,68,0.98)_100%)] text-[#e0f2fe] shadow-[inset_0_1px_0_rgba(186,230,253,0.14),0_6px_12px_rgba(0,0,0,0.24)]'
            : 'translate-x-0 border border-white/70 bg-[linear-gradient(180deg,rgba(255,255,255,0.98)_0%,rgba(241,245,249,0.92)_100%)] text-[#1f4f73] shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_6px_12px_rgba(15,23,42,0.16)]',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {isAuto ? 'AUTO' : isDark ? 'DARK' : 'LIGHT'}
      </span>
    </button>
  )
}
