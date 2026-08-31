import 'server-only'

import { createHash } from 'node:crypto'

export function normalizePowerOutageText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ')
    .replace(/\b(?:ulice|ul)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function powerOutageSha256(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex')
}

export function parsePowerOutageDate(value: string, label: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${label} obsahuje neplatné datum.`)
  }
  return date
}

export function powerOutageStatus(
  startsAt: Date,
  endsAt: Date,
  now = new Date(),
) {
  if (now < startsAt) return 'scheduled' as const
  if (now <= endsAt) return 'active' as const
  return 'completed' as const
}

export function powerOutageAddressKey(parts: Array<string | null | undefined>) {
  return powerOutageSha256(parts.map(normalizePowerOutageText)).slice(0, 40)
}
