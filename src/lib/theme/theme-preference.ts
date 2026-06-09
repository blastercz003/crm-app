export const THEME_STORAGE_KEY = 'meeting-crm.theme-mode'
export const THEME_AUTO_OVERRIDE_MODE_STORAGE_KEY =
  'meeting-crm.theme-auto-override-mode'
export const THEME_AUTO_OVERRIDE_UNTIL_STORAGE_KEY =
  'meeting-crm.theme-auto-override-until'
export const THEME_PREFERENCES_CHANGED_EVENT = 'theme-preferences-changed'
export const PRAGUE_TIME_ZONE = 'Europe/Prague'
const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365
const PRAGUE_LATITUDE = 50.0755
const PRAGUE_LONGITUDE = 14.4378
const SUNSET_SUNRISE_ZENITH = 90.833

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

function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function getPragueDayOfYear(dateParts: ReturnType<typeof getPragueDateParts>) {
  const monthLengths = [31, isLeapYear(dateParts.year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

  return (
    monthLengths
      .slice(0, Math.max(0, dateParts.month - 1))
      .reduce((sum, value) => sum + value, 0) + dateParts.day
  )
}

function normalizeDegrees(value: number) {
  let result = value % 360

  if (result < 0) result += 360

  return result
}

function normalizeHours(value: number) {
  let result = value % 24

  if (result < 0) result += 24

  return result
}

function degreesToRadians(value: number) {
  return (value * Math.PI) / 180
}

function radiansToDegrees(value: number) {
  return (value * 180) / Math.PI
}

function decimalHoursToClockParts(decimalHours: number) {
  let hour = Math.floor(decimalHours)
  let minute = Math.round((decimalHours - hour) * 60)

  if (minute >= 60) {
    hour += 1
    minute -= 60
  }

  return { hour, minute }
}

function getPragueUtcOffsetMinutesForDate(dateParts: ReturnType<typeof getPragueDateParts>) {
  const noonUtc = getPragueDateForWallTime(dateParts.year, dateParts.month, dateParts.day, 12)
  return getTimeZoneOffsetMinutes(noonUtc, PRAGUE_TIME_ZONE)
}

function calculatePragueSunEventUtcHours(
  dateParts: ReturnType<typeof getPragueDateParts>,
  event: 'sunrise' | 'sunset',
) {
  const dayOfYear = getPragueDayOfYear(dateParts)
  const lngHour = PRAGUE_LONGITUDE / 15
  const approxTime = dayOfYear + ((event === 'sunrise' ? 6 : 18) - lngHour) / 24
  const meanAnomaly = 0.9856 * approxTime - 3.289
  const trueLongitude = normalizeDegrees(
    meanAnomaly +
      1.916 * Math.sin(degreesToRadians(meanAnomaly)) +
      0.02 * Math.sin(degreesToRadians(2 * meanAnomaly)) +
      282.634
  )
  let rightAscension = radiansToDegrees(
    Math.atan(0.91764 * Math.tan(degreesToRadians(trueLongitude)))
  )
  rightAscension = normalizeDegrees(rightAscension)

  const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90
  const rightAscensionQuadrant = Math.floor(rightAscension / 90) * 90
  rightAscension = (rightAscension + longitudeQuadrant - rightAscensionQuadrant) / 15

  const sinDec = 0.39782 * Math.sin(degreesToRadians(trueLongitude))
  const cosDec = Math.cos(Math.asin(sinDec))
  const cosHourAngle =
    (Math.cos(degreesToRadians(SUNSET_SUNRISE_ZENITH)) -
      sinDec * Math.sin(degreesToRadians(PRAGUE_LATITUDE))) /
    (cosDec * Math.cos(degreesToRadians(PRAGUE_LATITUDE)))

  if (cosHourAngle > 1 || cosHourAngle < -1) return null

  let hourAngle =
    event === 'sunrise'
      ? 360 - radiansToDegrees(Math.acos(cosHourAngle))
      : radiansToDegrees(Math.acos(cosHourAngle))
  hourAngle /= 15

  const localMeanTime = hourAngle + rightAscension - 0.06571 * approxTime - 6.622
  return normalizeHours(localMeanTime - lngHour)
}

function getPragueSunTimes(dateUtc: Date = new Date()) {
  const dateParts = getPragueDateParts(dateUtc)
  const offsetMinutes = getPragueUtcOffsetMinutesForDate(dateParts)
  const offsetHours = offsetMinutes / 60
  const sunriseUtcHours = calculatePragueSunEventUtcHours(dateParts, 'sunrise')
  const sunsetUtcHours = calculatePragueSunEventUtcHours(dateParts, 'sunset')

  if (sunriseUtcHours === null || sunsetUtcHours === null) return null

  const sunriseLocalHours = normalizeHours(sunriseUtcHours + offsetHours)
  const sunsetLocalHours = normalizeHours(sunsetUtcHours + offsetHours)
  const sunriseClockParts = decimalHoursToClockParts(sunriseLocalHours)
  const sunsetClockParts = decimalHoursToClockParts(sunsetLocalHours)

  return {
    sunriseAt: getPragueDateForWallTime(
      dateParts.year,
      dateParts.month,
      dateParts.day,
      sunriseClockParts.hour,
      sunriseClockParts.minute
    ),
    sunsetAt: getPragueDateForWallTime(
      dateParts.year,
      dateParts.month,
      dateParts.day,
      sunsetClockParts.hour,
      sunsetClockParts.minute
    ),
  }
}

function getFallbackAutoThemeChangeAt(nowUtc: Date = new Date()) {
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
  const sunTimes = getPragueSunTimes(nowUtc)

  if (!sunTimes) return getFallbackAutoThemeChangeAt(nowUtc)

  const nowMs = nowUtc.getTime()

  if (nowMs < sunTimes.sunriseAt.getTime()) {
    return sunTimes.sunriseAt
  }

  if (nowMs < sunTimes.sunsetAt.getTime()) {
    return sunTimes.sunsetAt
  }

  const prague = getPragueDateParts(nowUtc)
  const tomorrowBase = new Date(Date.UTC(prague.year, prague.month - 1, prague.day + 1, 12, 0, 0))
  const tomorrowSunTimes = getPragueSunTimes(tomorrowBase)

  return tomorrowSunTimes?.sunriseAt ?? getFallbackAutoThemeChangeAt(nowUtc)
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

  const sunTimes = getPragueSunTimes(nowUtc)

  if (!sunTimes) {
    const prague = getPragueDateParts(nowUtc)
    return prague.hour >= 20 || prague.hour < 9 ? 'dark' : 'light'
  }

  const nowMs = nowUtc.getTime()
  return nowMs >= sunTimes.sunriseAt.getTime() && nowMs < sunTimes.sunsetAt.getTime()
    ? 'light'
    : 'dark'
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

function writeThemePreferenceCookie(name: string, value: string | null) {
  if (typeof document === 'undefined') return

  if (value === null) {
    document.cookie = `${encodeURIComponent(name)}=; Path=/; Max-Age=0; SameSite=Lax`
    return
  }

  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`
}

export function writeStoredThemeMode(themeMode: ThemeMode) {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(THEME_STORAGE_KEY, themeMode)
  writeThemePreferenceCookie(THEME_STORAGE_KEY, themeMode)
  writeThemePreferenceCookie(THEME_AUTO_OVERRIDE_MODE_STORAGE_KEY, null)
  writeThemePreferenceCookie(THEME_AUTO_OVERRIDE_UNTIL_STORAGE_KEY, null)
  window.dispatchEvent(new Event(THEME_PREFERENCES_CHANGED_EVENT))
}

export function writeStoredThemePreferences(preferences: ThemePreferences) {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(THEME_STORAGE_KEY, preferences.themeMode)
  writeThemePreferenceCookie(THEME_STORAGE_KEY, preferences.themeMode)

  if (preferences.themeAutoOverrideMode && preferences.themeAutoOverrideUntil) {
    window.localStorage.setItem(
      THEME_AUTO_OVERRIDE_MODE_STORAGE_KEY,
      preferences.themeAutoOverrideMode
    )
    window.localStorage.setItem(
      THEME_AUTO_OVERRIDE_UNTIL_STORAGE_KEY,
      preferences.themeAutoOverrideUntil
    )
    writeThemePreferenceCookie(
      THEME_AUTO_OVERRIDE_MODE_STORAGE_KEY,
      preferences.themeAutoOverrideMode
    )
    writeThemePreferenceCookie(
      THEME_AUTO_OVERRIDE_UNTIL_STORAGE_KEY,
      preferences.themeAutoOverrideUntil
    )
  } else {
    window.localStorage.removeItem(THEME_AUTO_OVERRIDE_MODE_STORAGE_KEY)
    window.localStorage.removeItem(THEME_AUTO_OVERRIDE_UNTIL_STORAGE_KEY)
    writeThemePreferenceCookie(THEME_AUTO_OVERRIDE_MODE_STORAGE_KEY, null)
    writeThemePreferenceCookie(THEME_AUTO_OVERRIDE_UNTIL_STORAGE_KEY, null)
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
