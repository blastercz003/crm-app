import 'server-only'

import type {
  NormalizedPowerOutage,
  NormalizedPowerOutageAddress,
} from './cez-normalizer'
import type { PreOutageRow } from './pre-source'
import {
  normalizePowerOutageText,
  powerOutageAddressKey,
  powerOutageSha256,
  powerOutageStatus,
} from './normalization'
import { powerOutageSourceUrl } from './public-links'

export type NormalizedPreOutage = Omit<NormalizedPowerOutage, 'source'> & {
  source: 'pre'
}

const PRAGUE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Prague',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function pragueOffsetMs(instantMs: number) {
  const parts = Object.fromEntries(
    PRAGUE_FORMATTER.formatToParts(new Date(instantMs))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  )
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - instantMs
}

export function parsePreLocalDate(value: string, label: string) {
  const match = value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!match) throw new Error(`${label} PRE obsahuje neplatné datum „${value}“.`)
  const [, day, month, year, hour, minute, second = '0'] = match
  const localAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second))
  let instant = localAsUtc - pragueOffsetMs(localAsUtc)
  instant = localAsUtc - pragueOffsetMs(instant)
  const date = new Date(instant)
  if (!Number.isFinite(date.getTime())) throw new Error(`${label} PRE obsahuje neplatné datum.`)
  return date
}

function localityHeader(value: string) {
  const [rawArea, ...partSegments] = value.split(/\s+-\s+/)
  const area = rawArea.trim()
  const townPart = partSegments.join(' - ').trim() || null
  const prague = /^praha(?:\s+\d+)?$/i.test(area)
  return {
    municipality: prague ? 'Praha' : area,
    district: prague && !/^praha$/i.test(area) ? area : null,
    townPart,
  }
}

function numberTokens(value: string) {
  return [...new Set((value.match(/\b\d+[a-z]?(?:\s*\/\s*\d+[a-z]?)?/gi) ?? [])
    .flatMap((token) => token.split('/'))
    .map((token) => token.trim().toLocaleLowerCase('cs-CZ'))
    .filter(Boolean))]
}

function technicalLine(value: string) {
  const normalized = normalizePowerOutageText(value)
  return /^(?:parc|parcela|prac|ev|zbvo)\b/.test(normalized)
    || /\b(?:prepoint|trafostanice)\b/.test(normalized)
    || /\b(?:regulacni stanice|byvala teplarna)\b/.test(normalized)
    || /(?:^|\s)ts\s*\d+/.test(normalized)
}

function splitStreetLine(value: string) {
  const clean = value.replace(/\s+/g, ' ').replace(/[,;]\s*$/, '').trim()
  if (!clean || technicalLine(clean)) return null

  // PRE kombinuje adresní a technické údaje v jednom řádku. Část od první
  // parcely/PREpointu dál nesmí sloužit jako důkaz čísla domu.
  const technicalIndex = clean.search(/\b(?:parc(?:ela)?\.?\s*(?:č\.?)?|prepoint|zbvo)\b/i)
  const addressPart = (technicalIndex >= 0 ? clean.slice(0, technicalIndex) : clean)
    .replace(/[,;\s]+$/, '')
    .trim()
  if (!addressPart || /^\d/.test(addressPart) || technicalLine(addressPart)) return null

  // První číslo musí být samostatný adresní token. Tím se neplete například
  // ulice „28. října“ s číslem domu, protože za 28 následuje tečka.
  const numberStart = /\s+(\d+[a-z]?(?:\s*\/\s*\d+[a-z]?)?)(?=\s*(?:,|$|\())/i.exec(addressPart)
  if (!numberStart) {
    if (!/[a-zá-ž]/i.test(addressPart) || /^\d/.test(addressPart)) return null
    return {
      street: addressPart.replace(/\s+(?:č\.?\s*ev\.?)$/i, '').trim(),
      numbers: [] as string[],
      allowContinuation: technicalIndex < 0,
    }
  }

  const street = addressPart
    .slice(0, numberStart.index)
    .replace(/\s+(?:č\.?\s*ev\.?)$/i, '')
    .trim()
  if (!street || technicalLine(street)) return null

  const numbers: string[] = []
  const numberList = addressPart.slice(numberStart.index).trim()
  for (const segment of numberList.split(',')) {
    const token = segment.trim()
    const tokenMatch = token.match(/^(\d+[a-z]?(?:\s*\/\s*\d+[a-z]?)?)(?:\s*\([^)]*\))?$/i)
    if (!tokenMatch) break
    numbers.push(...numberTokens(tokenMatch[1]))
  }
  return {
    street,
    numbers: [...new Set(numbers)],
    allowContinuation: technicalIndex < 0,
  }
}

function normalizeAddresses(row: PreOutageRow) {
  const lines = row.locality.split('\n').map((line) => line.trim()).filter(Boolean)
  const header = localityHeader(lines[0] ?? '')
  if (!header.municipality) throw new Error(`Řádek ${row.rowNumber} PRE nemá platnou lokalitu.`)

  const byStreet = new Map<string, { street: string; numbers: Set<string>; raw: string[] }>()
  let previousKey: string | null = null
  for (const line of lines.slice(1)) {
    if (/^\d/.test(line) && previousKey && !technicalLine(line)) {
      const previous = byStreet.get(previousKey)
      if (previous) {
        numberTokens(line).forEach((number) => previous.numbers.add(number))
        previous.raw.push(line)
      }
      continue
    }
    const parsed = splitStreetLine(line)
    if (!parsed) {
      previousKey = null
      continue
    }
    const key = normalizePowerOutageText(parsed.street)
    if (!key) continue
    const existing = byStreet.get(key) ?? { street: parsed.street, numbers: new Set<string>(), raw: [] }
    parsed.numbers.forEach((number) => existing.numbers.add(number))
    existing.raw.push(line)
    byStreet.set(key, existing)
    previousKey = parsed.allowContinuation ? key : null
  }

  const addresses = [...byStreet.values()].map((entry) => {
    const evidenceNumbers = [...entry.numbers]
    return {
      externalAddressId: null,
      addressKey: powerOutageAddressKey([header.municipality, header.townPart, entry.street]),
      municipality: header.municipality,
      municipalityCode: null,
      townPart: header.townPart,
      street: entry.street,
      houseNumber: null,
      orientationNumber: null,
      postalCode: null,
      rawAddress: entry.raw.join(' '),
      normalizedMunicipality: normalizePowerOutageText(header.municipality),
      normalizedStreet: normalizePowerOutageText(entry.street),
      latitude: null,
      longitude: null,
      metadata: { evidenceNumbers, sourceLines: entry.raw },
    } satisfies NormalizedPowerOutageAddress
  })
  return { ...header, addresses }
}

export function normalizePreOutage(row: PreOutageRow, now = new Date()): NormalizedPreOutage {
  const startsAt = parsePreLocalDate(row.startsAtLocal, 'Začátek odstávky')
  const endsAt = parsePreLocalDate(row.endsAtLocal, 'Konec odstávky')
  if (endsAt <= startsAt) throw new Error(`Řádek ${row.rowNumber} PRE nemá platné časové rozmezí.`)
  const locality = normalizeAddresses(row)
  const identity = {
    locality: row.locality.replace(/\s+/g, ' ').trim(),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  }
  return {
    source: 'pre',
    externalId: powerOutageSha256(identity),
    sourceStatus: powerOutageStatus(startsAt, endsAt, now),
    title: 'Plánovaná odstávka elektřiny',
    description: row.reason,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    archiveAt: endsAt.toISOString(),
    municipality: locality.municipality,
    municipalityCode: null,
    district: locality.district,
    region: locality.municipality === 'Praha' ? 'Hlavní město Praha' : 'Středočeský kraj',
    sourceUrl: powerOutageSourceUrl('pre'),
    announcementUrl: null,
    payloadSha256: powerOutageSha256(row),
    sourceUpdatedAt: null,
    metadata: {
      contract: 'pre-public-xlsx-v1',
      contractor: row.contractor,
      reason: row.reason,
      rawLocality: row.locality,
      sourceRowNumber: row.rowNumber,
      addressCount: locality.addresses.length,
    },
    addresses: locality.addresses,
  }
}
