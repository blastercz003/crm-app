'use server'

import { createClient } from '@/lib/supabase/server'
import { getServiceRoleClient } from '@/lib/supabase/service'
import {
  DEFAULT_THEME_MODE,
  normalizeThemeAppearanceMode,
  normalizeThemeMode,
  type ThemeAppearanceMode,
  type ThemeMode,
} from '@/lib/theme/theme-preference'

async function requireAuthenticatedUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { user: null, error: 'Uživatel není přihlášen.' }
  }

  return { user, error: null }
}

export async function updateMyThemeModeAction(input: { themeMode: ThemeMode }) {
  return updateMyThemePreferencesAction({ themeMode: input.themeMode })
}

export async function updateMyThemePreferencesAction(input: {
  themeMode: ThemeMode
  themeAutoOverrideMode?: ThemeAppearanceMode | null
  themeAutoOverrideUntil?: string | null
}) {
  try {
    const { user, error: accessError } = await requireAuthenticatedUser()

    if (!user) {
      return { success: false, error: accessError, themeMode: DEFAULT_THEME_MODE }
    }

    const themeMode = normalizeThemeMode(input.themeMode)
    const themeAutoOverrideMode = input.themeAutoOverrideMode
      ? normalizeThemeAppearanceMode(input.themeAutoOverrideMode)
      : null
    const themeAutoOverrideUntil = (() => {
      if (typeof input.themeAutoOverrideUntil !== 'string' || !input.themeAutoOverrideUntil) {
        return null
      }

      const date = new Date(input.themeAutoOverrideUntil)
      return Number.isNaN(date.getTime()) ? null : date.toISOString()
    })()
    const supabase = getServiceRoleClient()

    if (!supabase) {
      return {
        success: false,
        error: 'Chybí serverová konfigurace pro uložení theme.',
        themeMode: DEFAULT_THEME_MODE,
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        theme_mode: themeMode,
        theme_auto_override_mode: themeAutoOverrideMode,
        theme_auto_override_until: themeAutoOverrideUntil,
      })
      .eq('id', user.id)

    if (error) {
      return {
        success: false,
        error: 'Theme se nepodařilo uložit do profilu.',
        themeMode: DEFAULT_THEME_MODE,
      }
    }

    return { success: true, error: null, themeMode }
  } catch {
    return {
      success: false,
      error: 'Theme se nepodařilo uložit do profilu.',
      themeMode: DEFAULT_THEME_MODE,
    }
  }
}
