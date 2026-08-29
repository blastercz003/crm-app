import { fetchChmiResource } from './chmi-resource'

const CHMI_CLIMATE_DATA_DIRECTORY =
  'https://opendata.chmi.cz/meteorology/climate/now/data/'
const CHMI_CLIMATE_METADATA_DIRECTORY =
  'https://opendata.chmi.cz/meteorology/climate/now/metadata/'

const STATION_FILE_PATTERN = /^(10m|1h)-(0-20000-0-\d{5})-(\d{8})\.json$/
const METADATA_FILE_PATTERN = /^meta1-(\d{8})\.json$/

export const MONITORED_CHMI_STATION_CODES = [
  '0-20000-0-11406', // Cheb
  '0-20000-0-11414', // Karlovy Vary
  '0-20000-0-11450', // Plzeň
  '0-20000-0-11457', // Churáňov
  '0-20000-0-11464', // Milešovka
  '0-20000-0-11518', // Praha-Ruzyně
  '0-20000-0-11546', // České Budějovice
  '0-20000-0-11603', // Liberec
  '0-20000-0-11652', // Pardubice
  '0-20000-0-11683', // Svratouch
  '0-20000-0-11698', // Kuchařovice
  '0-20000-0-11723', // Brno-Tuřany
  '0-20000-0-11747', // Prostějov
  '0-20000-0-11774', // Holešov
  '0-20000-0-11782', // Mošnov
  '0-20000-0-11787', // Lysá hora
] as const

type ClimateFrequency = '10m' | '1h'

export type ChmiClimateFileCandidate = {
  fileName: string
  url: string
  dateKey: string
  stationCode: string
  frequency: ClimateFrequency
}

export type ChmiStationMetadata = {
  stationCode: string
  name: string
  longitude: number
  latitude: number
  elevation: number | null
}

export type ChmiObservation = {
  stationCode: string
  element: string
  observedAt: string
  value: number
  flag: string
  quality: number
}

export type ChmiStationMeasurements = {
  candidate: ChmiClimateFileCandidate
  payloadSha256: string
  observations: ChmiObservation[]
}

function decodeHtmlAttribute(value: string) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
}

function linksFromHtml(html: string) {
  return [...html.matchAll(/href=["']([^"']+)["']/gi)].map((match) =>
    decodeHtmlAttribute(match[1]),
  )
}

export function parseChmiClimateDataDirectory(html: string) {
  const selected = new Set<string>(MONITORED_CHMI_STATION_CODES)
  const latest = new Map<string, ChmiClimateFileCandidate>()

  for (const href of linksFromHtml(html)) {
    const fileName = href.split('/').at(-1) ?? ''
    const match = fileName.match(STATION_FILE_PATTERN)
    if (!match || !selected.has(match[2])) continue
    const frequency = match[1] as ClimateFrequency
    const stationCode = match[2]
    const dateKey = match[3]
    const key = `${frequency}:${stationCode}`
    const previous = latest.get(key)
    if (previous && previous.dateKey >= dateKey) continue
    const url = new URL(href, CHMI_CLIMATE_DATA_DIRECTORY)
    if (
      url.origin !== new URL(CHMI_CLIMATE_DATA_DIRECTORY).origin ||
      !url.pathname.startsWith(new URL(CHMI_CLIMATE_DATA_DIRECTORY).pathname)
    ) {
      continue
    }
    latest.set(key, { fileName, url: url.toString(), dateKey, stationCode, frequency })
  }
  return [...latest.values()].sort((left, right) =>
    left.stationCode.localeCompare(right.stationCode) ||
    left.frequency.localeCompare(right.frequency),
  )
}

export function parseLatestChmiMetadataCandidate(html: string) {
  const candidates: Array<{ fileName: string; url: string; dateKey: string }> = []
  for (const href of linksFromHtml(html)) {
    const fileName = href.split('/').at(-1) ?? ''
    const match = fileName.match(METADATA_FILE_PATTERN)
    if (!match) continue
    const url = new URL(href, CHMI_CLIMATE_METADATA_DIRECTORY)
    if (
      url.origin !== new URL(CHMI_CLIMATE_METADATA_DIRECTORY).origin ||
      !url.pathname.startsWith(new URL(CHMI_CLIMATE_METADATA_DIRECTORY).pathname)
    ) {
      continue
    }
    candidates.push({ fileName, url: url.toString(), dateKey: match[1] })
  }
  return candidates.sort(
    (left, right) =>
      right.dateKey.localeCompare(left.dateKey) ||
      right.fileName.localeCompare(left.fileName),
  )[0] ?? null
}

function dataCollection(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null
  const root = payload as Record<string, unknown>
  const firstData = root.data
  if (!firstData || typeof firstData !== 'object') return null
  const secondData = (firstData as Record<string, unknown>).data
  if (!secondData || typeof secondData !== 'object') return null
  const collection = secondData as Record<string, unknown>
  if (typeof collection.header !== 'string' || !Array.isArray(collection.values)) {
    return null
  }
  return { header: collection.header, values: collection.values }
}

function columnMap(header: string) {
  return new Map(
    header.split(',').map((column, index) => [column.trim().toUpperCase(), index]),
  )
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function parseChmiStationMetadata(payload: unknown) {
  const collection = dataCollection(payload)
  if (!collection) throw new Error('Metadata stanic ČHMÚ mají neplatnou strukturu.')
  const columns = columnMap(collection.header)
  const index = {
    station: columns.get('WSI'),
    name: columns.get('FULL_NAME'),
    longitude: columns.get('GEOGR1'),
    latitude: columns.get('GEOGR2'),
    elevation: columns.get('ELEVATION'),
  }
  if (Object.values(index).some((value) => value == null)) {
    throw new Error('V metadatech stanic ČHMÚ chybí povinné sloupce.')
  }

  const selected = new Set<string>(MONITORED_CHMI_STATION_CODES)
  const stations = new Map<string, ChmiStationMetadata>()
  for (const rawRow of collection.values) {
    if (!Array.isArray(rawRow)) continue
    const stationCode = rawRow[index.station!] as unknown
    const name = rawRow[index.name!] as unknown
    const longitude = finiteNumber(rawRow[index.longitude!])
    const latitude = finiteNumber(rawRow[index.latitude!])
    const elevation = finiteNumber(rawRow[index.elevation!])
    if (
      typeof stationCode !== 'string' ||
      !selected.has(stationCode) ||
      typeof name !== 'string' ||
      longitude == null ||
      latitude == null ||
      longitude < -180 ||
      longitude > 180 ||
      latitude < -90 ||
      latitude > 90
    ) {
      continue
    }
    stations.set(stationCode, {
      stationCode,
      name: name.trim(),
      longitude,
      latitude,
      elevation,
    })
  }
  return stations
}

export function parseChmiObservations(payload: unknown) {
  const collection = dataCollection(payload)
  if (!collection) throw new Error('Měření ČHMÚ mají neplatnou strukturu.')
  const columns = columnMap(collection.header)
  const index = {
    station: columns.get('STATION'),
    element: columns.get('ELEMENT'),
    observedAt: columns.get('DT'),
    value: columns.get('VAL'),
    flag: columns.get('FLAG'),
    quality: columns.get('QUALITY'),
  }
  if (Object.values(index).some((value) => value == null)) {
    throw new Error('V měřeních ČHMÚ chybí povinné sloupce.')
  }

  const observations: ChmiObservation[] = []
  for (const rawRow of collection.values) {
    if (!Array.isArray(rawRow)) continue
    const stationCode = rawRow[index.station!] as unknown
    const element = rawRow[index.element!] as unknown
    const observedAt = rawRow[index.observedAt!] as unknown
    const value = finiteNumber(rawRow[index.value!])
    const quality = finiteNumber(rawRow[index.quality!])
    const flag = rawRow[index.flag!] as unknown
    if (
      typeof stationCode !== 'string' ||
      typeof element !== 'string' ||
      typeof observedAt !== 'string' ||
      value == null ||
      quality == null ||
      ![0, 3, 5].includes(quality) ||
      Number.isNaN(new Date(observedAt).getTime())
    ) {
      continue
    }
    observations.push({
      stationCode,
      element,
      observedAt: new Date(observedAt).toISOString(),
      value,
      flag: typeof flag === 'string' ? flag : '',
      quality,
    })
  }
  return observations
}

async function downloadJson(url: string) {
  const resource = await fetchChmiResource({
    feedKey: 'observations',
    url,
    kind: 'json',
    maxBytes: 2 * 1024 * 1024,
  })
  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(resource.bytes))
  } catch {
    throw new Error('ČHMÚ vrátilo neplatný JSON soubor měření.')
  }
  return { resource, payload }
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(values[index])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  )
  return results
}

export async function downloadChmiObservationDataset() {
  const [dataDirectory, metadataDirectory] = await Promise.all([
    fetchChmiResource({
      feedKey: 'observations',
      url: CHMI_CLIMATE_DATA_DIRECTORY,
      kind: 'html',
    }),
    fetchChmiResource({
      feedKey: 'observations',
      url: CHMI_CLIMATE_METADATA_DIRECTORY,
      kind: 'html',
    }),
  ])
  const files = parseChmiClimateDataDirectory(
    new TextDecoder().decode(dataDirectory.bytes),
  )
  const metadataCandidate = parseLatestChmiMetadataCandidate(
    new TextDecoder().decode(metadataDirectory.bytes),
  )
  if (!metadataCandidate) throw new Error('ČHMÚ neposkytlo metadata aktuálních stanic.')

  const expectedFileCount = MONITORED_CHMI_STATION_CODES.length * 2
  if (files.length !== expectedFileCount) {
    throw new Error(
      `ČHMÚ poskytlo pouze ${files.length} z ${expectedFileCount} očekávaných souborů sledovaných stanic.`,
    )
  }

  const metadataDownload = await downloadJson(metadataCandidate.url)
  const stations = parseChmiStationMetadata(metadataDownload.payload)
  if (stations.size !== MONITORED_CHMI_STATION_CODES.length) {
    throw new Error('V metadatech ČHMÚ chybí některá sledovaná stanice.')
  }

  const measurements = await mapWithConcurrency(files, 4, async (candidate) => {
    const download = await downloadJson(candidate.url)
    return {
      candidate,
      payloadSha256: download.resource.payloadSha256,
      observations: parseChmiObservations(download.payload),
    } satisfies ChmiStationMeasurements
  })

  return {
    stations,
    measurements,
    metadataCandidate,
    metadataPayloadSha256: metadataDownload.resource.payloadSha256,
  }
}
