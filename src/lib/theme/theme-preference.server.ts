import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import {
  normalizeThemeAppearanceMode,
  normalizeThemeMode,
  resolveThemeAppearanceMode,
  THEME_AUTO_OVERRIDE_MODE_STORAGE_KEY,
  THEME_AUTO_OVERRIDE_UNTIL_STORAGE_KEY,
  THEME_STORAGE_KEY,
  type ThemePreferences,
} from './theme-preference'

type ThemePreferenceRow = {
  theme_mode: 'light' | 'dark' | 'auto' | null
  theme_auto_override_mode: 'light' | 'dark' | null
  theme_auto_override_until: string | null
}

function normalizeNullableIso(value: string | null | undefined) {
  if (!value) return null

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

async function readThemePreferencesFromCookies() {
  const cookieStore = await cookies()

  const themeMode = normalizeThemeMode(cookieStore.get(THEME_STORAGE_KEY)?.value)
  const themeAutoOverrideUntil = normalizeNullableIso(
    cookieStore.get(THEME_AUTO_OVERRIDE_UNTIL_STORAGE_KEY)?.value
  )
  const themeAutoOverrideMode = themeAutoOverrideUntil
    ? normalizeThemeAppearanceMode(cookieStore.get(THEME_AUTO_OVERRIDE_MODE_STORAGE_KEY)?.value)
    : null

  return {
    themeMode,
    themeAutoOverrideMode,
    themeAutoOverrideUntil,
  } satisfies ThemePreferences
}

export async function getServerThemePreferences(): Promise<ThemePreferences> {
  try {
    const supabase = await createClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return await readThemePreferencesFromCookies()
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('theme_mode, theme_auto_override_mode, theme_auto_override_until')
      .eq('id', user.id)
      .maybeSingle<ThemePreferenceRow>()

    if (!profile) {
      return await readThemePreferencesFromCookies()
    }

    const themePreferences: ThemePreferences = {
      themeMode: normalizeThemeMode(profile.theme_mode),
      themeAutoOverrideMode: profile.theme_auto_override_until
        ? normalizeThemeAppearanceMode(profile.theme_auto_override_mode)
        : null,
      themeAutoOverrideUntil: normalizeNullableIso(profile.theme_auto_override_until),
    }

    return themePreferences
  } catch {
    return await readThemePreferencesFromCookies()
  }
}

export function resolveServerThemeAppearanceMode(themePreferences: ThemePreferences) {
  return resolveThemeAppearanceMode(themePreferences)
}
