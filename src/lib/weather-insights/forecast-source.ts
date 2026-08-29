import { fetchChmiResource } from './chmi-resource'
import type {
  WeatherForecastPhenomenonKey,
} from './types'

const CHMI_FORECAST_DIRECTORY_URL =
  'https://opendata.chmi.cz/meteorology/weather/forecast/now/'
const NATIONAL_STREAM_PATTERN = /^web_p(CR(?:0|n|1|2|3|4|5|8))tx_/i
const REGIONAL_STREAM_PATTERN = /^web_p(CK(?:0|n|1))tx_(RP[A-Z]{2})_/i
const MAX_DOWNLOAD_CONCURRENCY = 6

export type ChmiForecastCandidate = {
  fileName: string
  url: string
  streamKey: string
  scopeType: 'national' | 'regional'
  regionHint: string
  modifiedAt: string
}

export type ChmiForecastDangerousPhenomenon = {
  name: string
  textComment: string
}

export type ChmiForecastRelevantPhenomenon = {
  key: WeatherForecastPhenomenonKey
  name: string
  textComment: string
  source: 'structured' | 'forecast_text'
}

export type ChmiForecastSnapshot = {
  issuedAt: string
  validFrom: string
  validTo: string
  scopeType: 'national' | 'regional'
  regionCode: string
  regionName: string
  periodKey: string
  headline: string | null
  textWeather: string | null
  textWind: string | null
  dangerousPhenomena: ChmiForecastDangerousPhenomenon[]
  relevantPhenomena: ChmiForecastRelevantPhenomenon[]
  sourceFileName: string
  sourceUrl: string
  payloadSha256: string
  dataStreamId: string
  recordId: string
  senderName: string | null
}

export type ChmiForecastDownload = {
  candidate: ChmiForecastCandidate
  payloadSha256: string
  snapshots: ChmiForecastSnapshot[]
}

type UnknownRecord = Record<string, unknown>

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeText(value: string) {
  return value.replaceAll('\u00a0', ' ').replace(/\s+/g, ' ').trim()
}

function parseDirectoryCandidates(html: string) {
  const candidates: ChmiForecastCandidate[] = []
  const rowPattern =
    /href="([^"]+\.json)"[^>]*>[^<]+<\/a>\s+(\d{2}-[A-Za-z]{3}-\d{4})\s+(\d{2}:\d{2})/g

  for (const match of html.matchAll(rowPattern)) {
    const fileName = decodeURIComponent(match[1])
    if (fileName.includes('_CCA.')) continue

    const national = fileName.match(NATIONAL_STREAM_PATTERN)
    const regional = fileName.match(REGIONAL_STREAM_PATTERN)
    if (!national && !regional) continue

    const modifiedTimestamp = Date.parse(`${match[2]} ${match[3]} UTC`)
    if (!Number.isFinite(modifiedTimestamp)) continue
    const scopeType = national ? 'national' : 'regional'
    const regionHint = national ? 'CZ' : regional![2].toUpperCase()
    const streamKey = national
      ? national[1].toUpperCase()
      : `${regional![1].toUpperCase()}:${regionHint}`

    candidates.push({
      fileName,
      url: new URL(fileName, CHMI_FORECAST_DIRECTORY_URL).toString(),
      streamKey,
      scopeType,
      regionHint,
      modifiedAt: new Date(modifiedTimestamp).toISOString(),
    })
  }

  const latestByStream = new Map<string, ChmiForecastCandidate>()
  for (const candidate of candidates) {
    const previous = latestByStream.get(candidate.streamKey)
    if (!previous || candidate.modifiedAt > previous.modifiedAt) {
      latestByStream.set(candidate.streamKey, candidate)
    }
  }
  return [...latestByStream.values()].sort((left, right) =>
    left.streamKey.localeCompare(right.streamKey),
  )
}

const PHENOMENON_MATCHERS: ReadonlyArray<{
  key: WeatherForecastPhenomenonKey
  label: string
  pattern: RegExp
}> = [
  { key: 'wind', label: 'Silný vítr', pattern: /(?:siln|prudk|bouřliv|vichř|orkán).{0,18}větr|náraz.{0,20}větr|větr.{0,20}(?:siln|prudk|bouřliv|vichř|orkán)/i },
  { key: 'thunderstorm', label: 'Bouřky', pattern: /bouřk|blesk/i },
  { key: 'heavy_rain', label: 'Silné srážky', pattern: /přívalov|vydatn.{0,16}(?:déšť|sráž)|siln.{0,16}(?:déšť|sráž)/i },
  { key: 'snow', label: 'Sněžení', pattern: /sněžen|sněhov.{0,16}(?:jazyk|závěj|pokrýv)|závěj/i },
  { key: 'icing', label: 'Námraza a ledovka', pattern: /ledovk|náled|námraz/i },
  { key: 'flood', label: 'Povodňové jevy', pattern: /povod|vzestup.{0,16}hladin|rozvodně/i },
]

function classifyPhenomenon(text: string) {
  return PHENOMENON_MATCHERS.find((matcher) => matcher.pattern.test(text)) ?? null
}

function structuredPhenomena(value: unknown) {
  if (!Array.isArray(value)) return []
  const result: ChmiForecastDangerousPhenomenon[] = []
  for (const item of value) {
    const record = asRecord(item)
    const name = asString(record?.name)
    if (!record || !name) continue
    result.push({
      name: normalizeText(name),
      textComment: normalizeText(asString(record.textComment) ?? ''),
    })
  }
  return result
}

function relevantPhenomena(params: {
  dangerous: ChmiForecastDangerousPhenomenon[]
  textWeather: string | null
  textWind: string | null
}) {
  const result = new Map<WeatherForecastPhenomenonKey, ChmiForecastRelevantPhenomenon>()
  for (const phenomenon of params.dangerous) {
    const combined = `${phenomenon.name} ${phenomenon.textComment}`
    const match = classifyPhenomenon(combined)
    if (!match) continue
    result.set(match.key, {
      key: match.key,
      name: phenomenon.name || match.label,
      textComment: phenomenon.textComment,
      source: 'structured',
    })
  }

  const forecastText = [params.textWeather, params.textWind].filter(Boolean).join(' ')
  for (const matcher of PHENOMENON_MATCHERS) {
    if (result.has(matcher.key) || !matcher.pattern.test(forecastText)) continue
    result.set(matcher.key, {
      key: matcher.key,
      name: matcher.label,
      textComment: normalizeText(forecastText),
      source: 'forecast_text',
    })
  }
  return [...result.values()]
}

function isoDate(value: unknown, fieldName: string) {
  const raw = asString(value)
  const timestamp = raw ? Date.parse(raw) : Number.NaN
  if (!raw || !Number.isFinite(timestamp)) {
    throw new Error(`Předpověď ČHMÚ nemá platné pole ${fieldName}.`)
  }
  return new Date(timestamp).toISOString()
}

function parseForecastPayload(params: {
  bytes: Uint8Array
  candidate: ChmiForecastCandidate
  payloadSha256: string
}) {
  const root = asRecord(JSON.parse(new TextDecoder().decode(params.bytes)))
  const recordId = asString(root?.zaznamID)
  const dataStreamId = asString(root?.datovyTokID)
  const issuedAt = isoDate(root?.datumVytvoreni, 'datumVytvoreni')
  const collection = asRecord(root?.data)
  if (!root || !recordId || !dataStreamId || !Array.isArray(collection?.features)) {
    throw new Error(`Soubor ${params.candidate.fileName} nemá očekávanou strukturu ČHMÚ.`)
  }

  const snapshots: ChmiForecastSnapshot[] = []
  for (const featureValue of collection.features) {
    const feature = asRecord(featureValue)
    const properties = asRecord(feature?.properties)
    const place = asRecord(properties?.place)
    const blocks = Array.isArray(properties?.data) ? properties.data : []
    if (!properties || !place || blocks.length === 0) continue

    const regionCode =
      asString(place.NUTS)?.toUpperCase() ?? params.candidate.regionHint
    const rawRegionName = asString(place.name) ?? regionCode
    const regionName =
      params.candidate.scopeType === 'national'
        ? 'Česká republika'
        : normalizeText(rawRegionName.replace(/^pro\s+/i, ''))
    const headlineMain = asRecord(properties['headline-main'])
    const blocksByPeriod = new Map<string, UnknownRecord[]>()

    for (const blockValue of blocks) {
      const block = asRecord(blockValue)
      const startTime = asString(block?.startTime)
      const endTime = asString(block?.endTime)
      if (!block || !startTime || !endTime) continue
      const validFrom = isoDate(startTime, 'startTime')
      const validTo = isoDate(endTime, 'endTime')
      if (validTo <= validFrom) continue
      const key = `${validFrom}|${validTo}`
      blocksByPeriod.set(key, [...(blocksByPeriod.get(key) ?? []), block])
    }

    for (const [period, periodBlocks] of blocksByPeriod) {
      const [validFrom, validTo] = period.split('|')
      const findBlock = (name: string) =>
        periodBlocks.find((block) => asString(block.name) === name)
      const textWeather = asString(findBlock('textWeather')?.displayText)
      const textWind = asString(findBlock('textWind')?.displayText)
      const dangerous = periodBlocks.flatMap((block) =>
        structuredPhenomena(block.dangerousPhenomenaList),
      )
      const relevant = relevantPhenomena({
        dangerous,
        textWeather: textWeather ? normalizeText(textWeather) : null,
        textWind: textWind ? normalizeText(textWind) : null,
      })
      const blockHeadline = periodBlocks
        .map((block) => asString(block.headline))
        .find(Boolean)
      const mainHeadline = asString(headlineMain?.headline)

      snapshots.push({
        issuedAt,
        validFrom,
        validTo,
        scopeType: params.candidate.scopeType,
        regionCode,
        regionName,
        periodKey: `${dataStreamId}:${validFrom}:${validTo}`,
        headline: normalizeText(mainHeadline ?? blockHeadline ?? '') || null,
        textWeather: textWeather ? normalizeText(textWeather) : null,
        textWind: textWind ? normalizeText(textWind) : null,
        dangerousPhenomena: dangerous,
        relevantPhenomena: relevant,
        sourceFileName: params.candidate.fileName,
        sourceUrl: params.candidate.url,
        payloadSha256: params.payloadSha256,
        dataStreamId,
        recordId,
        senderName: asString(properties.senderName),
      })
    }
  }

  if (snapshots.length === 0) {
    throw new Error(`Soubor ${params.candidate.fileName} neobsahuje žádné období předpovědi.`)
  }
  return snapshots
}

async function mapConcurrent<T, R>(
  items: T[],
  worker: (item: T) => Promise<R>,
) {
  const result = new Array<R>(items.length)
  let nextIndex = 0
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      result[index] = await worker(items[index])
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(MAX_DOWNLOAD_CONCURRENCY, items.length) },
      runWorker,
    ),
  )
  return result
}

export async function downloadChmiForecastDataset() {
  const directory = await fetchChmiResource({
    feedKey: 'forecast',
    url: CHMI_FORECAST_DIRECTORY_URL,
    kind: 'html',
  })
  const candidates = parseDirectoryCandidates(
    new TextDecoder().decode(directory.bytes),
  )
  if (candidates.length < 8) {
    throw new Error('ČHMÚ neposkytlo očekávanou sadu souborů předpovědi.')
  }

  const downloads = await mapConcurrent(candidates, async (candidate) => {
    const resource = await fetchChmiResource({
      feedKey: 'forecast',
      url: candidate.url,
      kind: 'json',
      maxBytes: 2 * 1024 * 1024,
    })
    return {
      candidate,
      payloadSha256: resource.payloadSha256,
      snapshots: parseForecastPayload({
        bytes: resource.bytes,
        candidate,
        payloadSha256: resource.payloadSha256,
      }),
    } satisfies ChmiForecastDownload
  })

  return {
    directoryPayloadSha256: directory.payloadSha256,
    candidates,
    downloads,
  }
}
