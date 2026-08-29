import { createHash } from 'node:crypto'
import { fetchChmiResource } from './chmi-resource'

export const CHMI_RADAR_OBSERVATION_DIRECTORY =
  'https://opendata.chmi.cz/meteorology/weather/radar/composite/pseudocappi2km/png/'
export const CHMI_RADAR_FORECAST_DIRECTORY =
  'https://opendata.chmi.cz/meteorology/weather/radar/composite/fct_pseudocappi2km/png/'

const OBSERVATION_FILE_PATTERN =
  /^pacz2gmaps3\.z_cappi020\.(\d{8})\.(\d{4})\.0\.png$/
const FORECAST_ARCHIVE_PATTERN =
  /^pacz2gmaps3\.fct_z_cappi020\.(\d{8})\.(\d{4})\.ft60s10\.tar$/
const FORECAST_FRAME_PATTERN =
  /^pacz2gmaps3\.fct_z_cappi020\.(\d{8})\.(\d{4})\.(10|20|30|40|50|60)\.png$/

const MAX_FORECAST_ARCHIVE_ENTRIES = 20
const MAX_RADAR_PNG_BYTES = 8 * 1024 * 1024

export type ChmiRadarCandidate = {
  fileName: string
  url: string
  timestamp: string
}

export type ChmiRadarForecastFrame = ChmiRadarCandidate & {
  bytes: Uint8Array
  payloadSha256: string
  leadMinutes: number
  archiveFileName: string
  archiveUrl: string
  archivePayloadSha256: string
}

function parseUtcTimestamp(dateText: string, timeText: string) {
  const year = Number(dateText.slice(0, 4))
  const month = Number(dateText.slice(4, 6))
  const day = Number(dateText.slice(6, 8))
  const hour = Number(timeText.slice(0, 2))
  const minute = Number(timeText.slice(2, 4))
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  ) {
    return null
  }
  return date.toISOString()
}

function decodeHtmlAttribute(value: string) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}

export function parseChmiRadarDirectory(params: {
  html: string
  directoryUrl: string
  kind: 'observation' | 'forecast'
}) {
  const pattern =
    params.kind === 'observation'
      ? OBSERVATION_FILE_PATTERN
      : FORECAST_ARCHIVE_PATTERN
  const candidates = new Map<string, ChmiRadarCandidate>()

  for (const match of params.html.matchAll(/href=["']([^"']+)["']/gi)) {
    const href = decodeHtmlAttribute(match[1])
    const fileName = href.split('/').at(-1) ?? ''
    const fileMatch = fileName.match(pattern)
    if (!fileMatch) continue
    const timestamp = parseUtcTimestamp(fileMatch[1], fileMatch[2])
    if (!timestamp) continue

    const url = new URL(href, params.directoryUrl)
    if (url.origin !== new URL(params.directoryUrl).origin) continue
    if (!url.pathname.startsWith(new URL(params.directoryUrl).pathname)) continue

    candidates.set(fileName, { fileName, url: url.toString(), timestamp })
  }

  return [...candidates.values()].sort(
    (left, right) =>
      new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime() ||
      right.fileName.localeCompare(left.fileName),
  )
}

export async function discoverChmiRadarTimeline() {
  const [observationDirectory, forecastDirectory] = await Promise.all([
    fetchChmiResource({
      feedKey: 'radar',
      url: CHMI_RADAR_OBSERVATION_DIRECTORY,
      kind: 'html',
    }),
    fetchChmiResource({
      feedKey: 'radar',
      url: CHMI_RADAR_FORECAST_DIRECTORY,
      kind: 'html',
    }),
  ])

  const observations = parseChmiRadarDirectory({
    html: new TextDecoder().decode(observationDirectory.bytes),
    directoryUrl: CHMI_RADAR_OBSERVATION_DIRECTORY,
    kind: 'observation',
  }).slice(0, 12)
  const forecastArchive = parseChmiRadarDirectory({
    html: new TextDecoder().decode(forecastDirectory.bytes),
    directoryUrl: CHMI_RADAR_FORECAST_DIRECTORY,
    kind: 'forecast',
  })[0]

  if (observations.length === 0) {
    throw new Error('ČHMÚ neposkytlo žádný měřený radarový snímek.')
  }
  if (!forecastArchive) {
    throw new Error('ČHMÚ neposkytlo archiv krátkodobé radarové předpovědi.')
  }

  return { observations, forecastArchive }
}

function tarText(bytes: Uint8Array, start: number, length: number) {
  return new TextDecoder()
    .decode(bytes.slice(start, start + length))
    .replace(/\0[\s\S]*$/, '')
    .trim()
}

function tarOctal(bytes: Uint8Array, start: number, length: number) {
  const value = tarText(bytes, start, length).replace(/\0/g, '').trim()
  if (!/^[0-7]+$/.test(value)) return null
  const parsed = Number.parseInt(value, 8)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function isZeroTarBlock(bytes: Uint8Array, offset: number) {
  for (let index = offset; index < offset + 512; index += 1) {
    if (bytes[index] !== 0) return false
  }
  return true
}

export function extractChmiRadarForecastFrames(params: {
  archive: Uint8Array
  archiveCandidate: ChmiRadarCandidate
  archivePayloadSha256: string
}) {
  const frames: ChmiRadarForecastFrame[] = []
  const seenNames = new Set<string>()
  let offset = 0
  let entryCount = 0

  while (offset + 512 <= params.archive.byteLength) {
    if (isZeroTarBlock(params.archive, offset)) break
    entryCount += 1
    if (entryCount > MAX_FORECAST_ARCHIVE_ENTRIES) {
      throw new Error('Radarový archiv ČHMÚ obsahuje příliš mnoho položek.')
    }

    const rawName = tarText(params.archive, offset, 100)
    const prefix = tarText(params.archive, offset + 345, 155)
    const archivePath = prefix ? `${prefix}/${rawName}` : rawName
    const size = tarOctal(params.archive, offset + 124, 12)
    const type = tarText(params.archive, offset + 156, 1)
    if (size == null || size < 0) {
      throw new Error('Radarový archiv ČHMÚ obsahuje neplatnou velikost položky.')
    }

    const dataStart = offset + 512
    const dataEnd = dataStart + size
    if (dataEnd > params.archive.byteLength) {
      throw new Error('Radarový archiv ČHMÚ je neúplný.')
    }

    if (type === '' || type === '0') {
      if (
        archivePath.startsWith('/') ||
        archivePath.split('/').some((part) => part === '..')
      ) {
        throw new Error('Radarový archiv ČHMÚ obsahuje nepovolenou cestu.')
      }
      const fileName = archivePath.split('/').at(-1) ?? ''
      const match = fileName.match(FORECAST_FRAME_PATTERN)
      if (match) {
        if (size <= 0 || size > MAX_RADAR_PNG_BYTES) {
          throw new Error('Předpovědní radarový snímek překračuje bezpečný limit.')
        }
        if (seenNames.has(fileName)) {
          throw new Error('Radarový archiv ČHMÚ obsahuje duplicitní snímek.')
        }
        const timestamp = parseUtcTimestamp(match[1], match[2])
        if (!timestamp) throw new Error('Radarový snímek má neplatný čas.')
        const leadMinutes = Number(match[3])
        const expectedTimestamp =
          new Date(params.archiveCandidate.timestamp).getTime() + leadMinutes * 60_000
        if (new Date(timestamp).getTime() !== expectedTimestamp) {
          throw new Error('Čas radarové předpovědi neodpovídá délce předpovědi.')
        }

        const bytes = params.archive.slice(dataStart, dataEnd)
        const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
        if (!pngSignature.every((value, index) => bytes[index] === value)) {
          throw new Error('Radarový archiv ČHMÚ obsahuje neplatný PNG snímek.')
        }
        seenNames.add(fileName)
        frames.push({
          fileName,
          url: params.archiveCandidate.url,
          timestamp,
          bytes,
          payloadSha256: createHash('sha256').update(bytes).digest('hex'),
          leadMinutes,
          archiveFileName: params.archiveCandidate.fileName,
          archiveUrl: params.archiveCandidate.url,
          archivePayloadSha256: params.archivePayloadSha256,
        })
      }
    }

    offset = dataStart + Math.ceil(size / 512) * 512
  }

  frames.sort((left, right) => left.leadMinutes - right.leadMinutes)
  const expectedLeads = [10, 20, 30, 40, 50, 60]
  if (
    frames.length !== expectedLeads.length ||
    frames.some((frame, index) => frame.leadMinutes !== expectedLeads[index])
  ) {
    throw new Error('Radarový archiv ČHMÚ neobsahuje všech šest předpovědních kroků.')
  }
  return frames
}

export async function downloadChmiRadarObservation(candidate: ChmiRadarCandidate) {
  const resource = await fetchChmiResource({
    feedKey: 'radar',
    url: candidate.url,
    kind: 'png',
    maxBytes: MAX_RADAR_PNG_BYTES,
  })
  return { ...candidate, bytes: resource.bytes, payloadSha256: resource.payloadSha256 }
}

export async function downloadChmiRadarForecast(candidate: ChmiRadarCandidate) {
  const archive = await fetchChmiResource({
    feedKey: 'radar',
    url: candidate.url,
    kind: 'archive',
  })
  return extractChmiRadarForecastFrames({
    archive: archive.bytes,
    archiveCandidate: candidate,
    archivePayloadSha256: archive.payloadSha256,
  })
}
