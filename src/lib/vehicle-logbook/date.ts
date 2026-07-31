const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isValidDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_KEY_PATTERN.test(value)) return false

  const parsed = new Date(`${value}T12:00:00Z`)
  return (
    !Number.isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  )
}

export function parseDateKey(value: unknown, fallback: string) {
  return isValidDateKey(value) ? value : fallback
}
