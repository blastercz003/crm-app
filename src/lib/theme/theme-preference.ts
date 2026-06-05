export const THEME_STORAGE_KEY = 'meeting-crm.theme-mode'
export const THEME_AUTO_OVERRIDE_MODE_STORAGE_KEY =
  'meeting-crm.theme-auto-override-mode'
export const THEME_AUTO_OVERRIDE_UNTIL_STORAGE_KEY =
  'meeting-crm.theme-auto-override-until'
export const THEME_PREFERENCES_CHANGED_EVENT = 'theme-preferences-changed'
export const PRAGUE_TIME_ZONE = 'Europe/Prague'

export type ThemeMode = 'light' | 'dark' | 'auto'
export type ThemeAppearanceMode = 'light' | 'dark'
export type ThemeAutoOverrideMode = ThemeAppearanceMode

export type ThemePreferences = {
  themeMode: ThemeMode
  themeAutoOverrideMode: ThemeAutoOverrideMode | null
  themeAutoOverrideUntil: string | null
}

export const DEFAULT_THEME_MODE: ThemeAppearanceMode = 'light'
export const DEFAULT_THEME_PREFERENCES: ThemePreferences = {
  themeMode: DEFAULT_THEME_MODE,
  themeAutoOverrideMode: null,
  themeAutoOverrideUntil: null,
}
export const THEME_COLORS: Record<ThemeAppearanceMode, string> = {
  light: '#f8fbff',
  dark: '#0b1220',
}

export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'auto'
}

export function isThemeAppearanceMode(value: unknown): value is ThemeAppearanceMode {
  return value === 'light' || value === 'dark'
}

export function normalizeThemeMode(value: unknown): ThemeMode {
  return isThemeMode(value) ? value : DEFAULT_THEME_PREFERENCES.themeMode
}

export function normalizeThemeAppearanceMode(value: unknown): ThemeAppearanceMode {
  return isThemeAppearanceMode(value) ? value : DEFAULT_THEME_MODE
}

function normalizeNullableIso(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null

  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function getTimeZoneOffsetMinutes(dateUtc: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  })

  const parts = formatter.formatToParts(dateUtc)
  const timeZonePart = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+0'
  const match = timeZonePart.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/)

  if (!match) return 0

  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2] ?? 0)
  const minutes = Number(match[3] ?? 0)

  return sign * (hours * 60 + minutes)
}

export function getPragueDateParts(dateUtc: Date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: PRAGUE_TIME_ZONE,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })

  const parts = formatter.formatToParts(dateUtc)
  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0')

  return {
    year: getPart('year'),
    month: getPart('month'),
    day: getPart('day'),
    hour: getPart('hour'),
    minute: getPart('minute'),
    second: getPart('second'),
  }
}

export function getPragueDateForWallTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute = 0,
  second = 0,
) {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const firstOffsetMinutes = getTimeZoneOffsetMinutes(new Date(utcGuess), PRAGUE_TIME_ZONE)
  let utcMs = utcGuess - firstOffsetMinutes * 60_000
  const secondOffsetMinutes = getTimeZoneOffsetMinutes(new Date(utcMs), PRAGUE_TIME_ZONE)

  if (secondOffsetMinutes !== firstOffsetMinutes) {
    utcMs = utcGuess - secondOffsetMinutes * 60_000
  }

  return new Date(utcMs)
}

export function getNextAutoThemeChangeAt(nowUtc: Date = new Date()) {
  const prague = getPragueDateParts(nowUtc)

  if (prague.hour < 9) {
    return getPragueDateForWallTime(prague.year, prague.month, prague.day, 9)
  }

  if (prague.hour < 20) {
    return getPragueDateForWallTime(prague.year, prague.month, prague.day, 20)
  }

  const tomorrowBase = new Date(Date.UTC(prague.year, prague.month - 1, prague.day + 1, 12, 0, 0))
  const tomorrow = getPragueDateParts(tomorrowBase)

  return getPragueDateForWallTime(tomorrow.year, tomorrow.month, tomorrow.day, 9)
}

export function isThemeAutoOverrideActive(
  preferences: Pick<ThemePreferences, 'themeMode' | 'themeAutoOverrideMode' | 'themeAutoOverrideUntil'>,
  nowUtc: Date = new Date()
) {
  if (preferences.themeMode !== 'auto') return false
  if (!preferences.themeAutoOverrideMode || !preferences.themeAutoOverrideUntil) return false

  const until = new Date(preferences.themeAutoOverrideUntil)

  if (Number.isNaN(until.getTime())) return false

  return until.getTime() > nowUtc.getTime()
}

export function resolveThemeAppearanceMode(
  preferences: Pick<ThemePreferences, 'themeMode' | 'themeAutoOverrideMode' | 'themeAutoOverrideUntil'>,
  nowUtc: Date = new Date(),
): ThemeAppearanceMode {
  if (preferences.themeMode === 'light' || preferences.themeMode === 'dark') {
    return preferences.themeMode
  }

  if (isThemeAutoOverrideActive(preferences, nowUtc)) {
    return preferences.themeAutoOverrideMode ?? DEFAULT_THEME_MODE
  }

  const prague = getPragueDateParts(nowUtc)
  return prague.hour >= 20 || prague.hour < 9 ? 'dark' : 'light'
}

export function readStoredThemePreferences(): ThemePreferences {
  if (typeof window === 'undefined') return DEFAULT_THEME_PREFERENCES

  const themeMode = normalizeThemeMode(window.localStorage.getItem(THEME_STORAGE_KEY))
  const themeAutoOverrideMode = normalizeThemeAppearanceMode(
    window.localStorage.getItem(THEME_AUTO_OVERRIDE_MODE_STORAGE_KEY)
  )
  const themeAutoOverrideUntil = normalizeNullableIso(
    window.localStorage.getItem(THEME_AUTO_OVERRIDE_UNTIL_STORAGE_KEY)
  )

  return {
    themeMode,
    themeAutoOverrideMode: themeAutoOverrideUntil ? themeAutoOverrideMode : null,
    themeAutoOverrideUntil,
  }
}

export function readStoredThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return DEFAULT_THEME_PREFERENCES.themeMode

  const rawValue = window.localStorage.getItem(THEME_STORAGE_KEY)
  return normalizeThemeMode(rawValue)
}

export function writeStoredThemeMode(themeMode: ThemeMode) {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(THEME_STORAGE_KEY, themeMode)
  window.dispatchEvent(new Event(THEME_PREFERENCES_CHANGED_EVENT))
}

export function writeStoredThemePreferences(preferences: ThemePreferences) {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(THEME_STORAGE_KEY, preferences.themeMode)

  if (preferences.themeAutoOverrideMode && preferences.themeAutoOverrideUntil) {
    window.localStorage.setItem(
      THEME_AUTO_OVERRIDE_MODE_STORAGE_KEY,
      preferences.themeAutoOverrideMode
    )
    window.localStorage.setItem(
      THEME_AUTO_OVERRIDE_UNTIL_STORAGE_KEY,
      preferences.themeAutoOverrideUntil
    )
  } else {
    window.localStorage.removeItem(THEME_AUTO_OVERRIDE_MODE_STORAGE_KEY)
    window.localStorage.removeItem(THEME_AUTO_OVERRIDE_UNTIL_STORAGE_KEY)
  }

  window.dispatchEvent(new Event(THEME_PREFERENCES_CHANGED_EVENT))
}

export function applyThemeMode(themeMode: ThemeAppearanceMode) {
  if (typeof document === 'undefined') return

  document.documentElement.setAttribute('data-theme', themeMode)
}

export function applyThemeColor(themeMode: ThemeAppearanceMode) {
  if (typeof document === 'undefined') return

  const themeColor = THEME_COLORS[themeMode]
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')

  if (!meta) {
    meta = document.createElement('meta')
    meta.setAttribute('name', 'theme-color')
    document.head.appendChild(meta)
  }

  meta.setAttribute('content', themeColor)
}

export function applyThemePreferences(preferences: ThemePreferences) {
  const themeMode = resolveThemeAppearanceMode(preferences)
  applyThemeMode(themeMode)
  applyThemeColor(themeMode)
}
