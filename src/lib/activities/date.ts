const PRAGUE_TIME_ZONE = 'Europe/Prague'

function getPragueOffsetMinutes(dateUtc: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PRAGUE_TIME_ZONE,
    timeZoneName: 'shortOffset',
  })
  const timeZoneName = formatter
    .formatToParts(dateUtc)
    .find((part) => part.type === 'timeZoneName')
    ?.value

  if (!timeZoneName || timeZoneName === 'GMT' || timeZoneName === 'UTC') return 0

  const match = timeZoneName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)
  if (!match) throw new Error('Nepodařilo se určit časové pásmo Europe/Prague.')

  const sign = match[1] === '-' ? -1 : 1
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? '0'))
}

function isValidWallTime(parts: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}) {
  const candidate = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  ))

  return candidate.getUTCFullYear() === parts.year
    && candidate.getUTCMonth() === parts.month - 1
    && candidate.getUTCDate() === parts.day
    && candidate.getUTCHours() === parts.hour
    && candidate.getUTCMinutes() === parts.minute
    && candidate.getUTCSeconds() === parts.second
}

function pragueWallTimeToIso(parts: {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  millisecond: number
}) {
  if (!isValidWallTime(parts)) return null

  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond,
  )
  const firstOffset = getPragueOffsetMinutes(new Date(utcGuess))
  let utcTime = utcGuess - firstOffset * 60_000
  const secondOffset = getPragueOffsetMinutes(new Date(utcTime))

  if (firstOffset !== secondOffset) {
    utcTime = utcGuess - secondOffset * 60_000
  }

  return new Date(utcTime).toISOString()
}

export function normalizeActivityDateTime(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null

  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    const timestamp = Date.parse(normalized)
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString()
  }

  const match = normalized.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/,
  )
  if (!match) return null

  return pragueWallTimeToIso({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? '0'),
    millisecond: Number((match[7] ?? '0').padEnd(3, '0')),
  })
}

export function normalizeActivityDateBoundary(
  value: string | null | undefined,
  endOfDay: boolean,
) {
  const normalized = String(value ?? '').trim()
  if (!normalized) return null

  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return normalizeActivityDateTime(normalized)

  return pragueWallTimeToIso({
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: endOfDay ? 23 : 0,
    minute: endOfDay ? 59 : 0,
    second: endOfDay ? 59 : 0,
    millisecond: endOfDay ? 999 : 0,
  })
}

export function getPragueDateKey(value: Date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value)
}

function utcDateKey(value: Date) {
  return value.toISOString().slice(0, 10)
}

export function getPragueWeekDateKeys(value: Date = new Date()) {
  const todayKey = getPragueDateKey(value)
  const [year, month, day] = todayKey.split('-').map(Number)
  const today = new Date(Date.UTC(year, month - 1, day))
  const daysSinceMonday = (today.getUTCDay() + 6) % 7
  const monday = new Date(today)
  monday.setUTCDate(today.getUTCDate() - daysSinceMonday)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)

  return {
    start: utcDateKey(monday),
    end: utcDateKey(sunday),
  }
}
