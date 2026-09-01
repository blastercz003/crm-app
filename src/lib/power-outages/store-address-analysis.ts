import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { normalizePowerOutageText } from './normalization'
import type { StoreAddressAnalysisItem, StoreAddressNearbyCandidate } from './types'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type RegistryRow = {
  id: string
  store_id: string | null
  store_chain_name: string
  store_number: string
  store_city: string
  store_address: string
  address_fingerprint: string
  needs_refresh: boolean
  verification_status: 'pending' | 'verified' | 'probable' | 'needs_review' | 'not_found' | 'error'
}

type SuggestionRow = {
  id: string
  registry_id: string
  address_fingerprint: string
  analysis_status: StoreAddressAnalysisItem['analysisStatus']
  confidence: number | string
  suggested_city: string | null
  suggested_address: string | null
  suggested_label: string | null
  suggested_zip: string | null
  longitude: number | string | null
  latitude: number | string | null
  candidate_count: number
  analyzed_at: string
  error_message: string | null
  metadata: Record<string, unknown> | null
}

type MapyRegionalItem = { name?: unknown; type?: unknown; isoCode?: unknown }
type MapyItem = {
  name?: unknown
  label?: unknown
  location?: unknown
  type?: unknown
  zip?: unknown
  position?: { lon?: unknown; lat?: unknown } | null
  regionalStructure?: MapyRegionalItem[] | null
}
type MapyResponse = { items?: MapyItem[] }

const ANALYZER_VERSION = 2
const ELIGIBLE_STATUSES = ['needs_review', 'not_found', 'error'] as const
const MAPY_GEOCODE_URL = 'https://api.mapy.com/v1/geocode'
const NEARBY_RADIUS_METERS = 15_000
const CHAIN_SEARCH: Record<string, { query: string; tokens: string[] }> = {
  ALBERT: { query: 'Albert supermarket', tokens: ['albert'] },
  BILLA: { query: 'BILLA', tokens: ['billa'] },
  LIDL: { query: 'Lidl', tokens: ['lidl'] },
  'PENNY MARKET': { query: 'PENNY Market', tokens: ['penny'] },
}

function stringValue(value: unknown) { return typeof value === 'string' ? value.trim() : '' }
function finiteNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}
function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function normalizeComparable(value: string) {
  return normalizePowerOutageText(value)
    .replace(/\b(?:ulice|ul\.?|namesti|nam\.?|trida|tr\.?|ev\.?\s*c\.?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}
function streetPart(value: string) {
  return normalizeComparable(value).replace(/\s+\d+[a-z]?(?:\s*\/\s*\d+[a-z]?)?$/, '').trim()
}
function addressNumbers(value: string) {
  for (const part of value.split(',').map((item) => item.trim()).filter(Boolean).reverse()) {
    const trailingNumber = part.match(/(?:^|\s)(\d+[a-z]?)(?:\s*\/\s*(\d+[a-z]?))?\s*$/i)
    if (trailingNumber) {
      return new Set(trailingNumber.slice(1).map((item) => normalizeComparable(item ?? '')).filter(Boolean))
    }
  }
  return new Set<string>()
}
function setsEqual(left: Set<string>, right: Set<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}
function similarity(leftValue: string, rightValue: string) {
  const left = normalizeComparable(leftValue)
  const right = normalizeComparable(rightValue)
  if (!left || !right) return 0
  if (left === right) return 1
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(current[rightIndex - 1] + 1, previous[rightIndex] + 1, previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1))
    }
    previous.splice(0, previous.length, ...current)
  }
  return Math.max(0, 1 - previous[right.length] / Math.max(left.length, right.length))
}
function regionalNames(item: MapyItem, type: string) {
  return (Array.isArray(item.regionalStructure) ? item.regionalStructure : [])
    .filter((part) => stringValue(part.type) === type)
    .map((part) => stringValue(part.name))
    .filter(Boolean)
}
function municipality(item: MapyItem) {
  return regionalNames(item, 'regional.municipality')[0]
    ?? regionalNames(item, 'regional.municipality_part')[0]
    ?? ''
}
function regionalAddress(item: MapyItem) { return regionalNames(item, 'regional.address')[0] ?? '' }
function regionalStreet(item: MapyItem) { return regionalNames(item, 'regional.street')[0] ?? '' }
function poiAddress(item: MapyItem) {
  const street = regionalStreet(item)
  const number = regionalAddress(item)
  return [street, number].filter(Boolean).join(' ').trim()
}
function scoreCandidate(item: MapyItem, row: RegistryRow) {
  const name = stringValue(item.name)
  const cityNames = [...regionalNames(item, 'regional.municipality'), ...regionalNames(item, 'regional.municipality_part')]
  const citySimilarity = cityNames.reduce((best, value) => Math.max(best, similarity(row.store_city, value)), 0)
  const streetSimilarity = similarity(streetPart(row.store_address), streetPart(name))
  const requestedNumbers = addressNumbers(row.store_address)
  const candidateNumbers = addressNumbers(name)
  const hasRequestedNumbers = requestedNumbers.size > 0
  const exactNumberSet = hasRequestedNumbers && setsEqual(requestedNumbers, candidateNumbers)
  const score = Math.min(1, citySimilarity * 0.35 + streetSimilarity * 0.35 + (exactNumberSet ? 0.25 : 0) + (stringValue(item.type) === 'regional.address' ? 0.05 : 0))
  return { score, citySimilarity, streetSimilarity, hasRequestedNumbers, exactNumberSet }
}
function distanceMeters(leftLon: number, leftLat: number, rightLon: number, rightLat: number) {
  const radians = (value: number) => value * Math.PI / 180
  const dLat = radians(rightLat - leftLat)
  const dLon = radians(rightLon - leftLon)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(leftLat)) * Math.cos(radians(rightLat)) * Math.sin(dLon / 2) ** 2
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}
async function fetchMapy(url: URL) {
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(12_000), headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Mapy.com odpověděly HTTP ${response.status}.`)
  return response.json() as Promise<MapyResponse>
}
async function findNearbyChain(row: RegistryRow, center: { lon: number; lat: number } | null) {
  const apiKey = process.env.MAPY_API_KEY?.trim()
  const chain = CHAIN_SEARCH[normalizeComparable(row.store_chain_name).toUpperCase()]
  if (!apiKey || !chain || !center) return []
  const url = new URL(MAPY_GEOCODE_URL)
  url.searchParams.set('apikey', apiKey)
  url.searchParams.set('query', chain.query)
  url.searchParams.set('lang', 'cs')
  url.searchParams.set('limit', '10')
  url.searchParams.set('locality', 'cz')
  url.searchParams.set('type', 'poi')
  url.searchParams.set('preferNear', `${center.lon},${center.lat}`)
  url.searchParams.set('preferNearPrecision', String(NEARBY_RADIUS_METERS))
  const payload = await fetchMapy(url)
  return (Array.isArray(payload.items) ? payload.items : [])
    .map((item) => {
      const lon = finiteNumber(item.position?.lon)
      const lat = finiteNumber(item.position?.lat)
      const poiName = stringValue(item.name)
      const normalizedName = normalizeComparable(poiName)
      if (lon == null || lat == null || !chain.tokens.some((token) => normalizedName.includes(token))) return null
      const distance = distanceMeters(center.lon, center.lat, lon, lat)
      const address = poiAddress(item)
      const city = municipality(item)
      if (!address || !city || distance > NEARBY_RADIUS_METERS) return null
      return { id: `${lon}:${lat}`, poiName, city, address, label: stringValue(item.location) || stringValue(item.label) || null, longitude: lon, latitude: lat, distanceMeters: distance } satisfies StoreAddressNearbyCandidate
    })
    .filter((item): item is StoreAddressNearbyCandidate => item !== null)
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .slice(0, 3)
}
async function findCityCenter(row: RegistryRow, apiKey: string) {
  const url = new URL(MAPY_GEOCODE_URL)
  url.searchParams.set('apikey', apiKey)
  url.searchParams.set('query', row.store_city)
  url.searchParams.set('lang', 'cs')
  url.searchParams.set('limit', '3')
  url.searchParams.set('locality', 'cz')
  url.searchParams.set('type', 'regional.municipality')
  const payload = await fetchMapy(url)
  const item = (Array.isArray(payload.items) ? payload.items : []).find((candidate) => (
    finiteNumber(candidate.position?.lon) != null
    && finiteNumber(candidate.position?.lat) != null
    && similarity(row.store_city, stringValue(candidate.name)) >= 0.8
  ))
  const lon = finiteNumber(item?.position?.lon)
  const lat = finiteNumber(item?.position?.lat)
  return lon != null && lat != null ? { lon, lat } : null
}
async function geocodeAddress(row: RegistryRow) {
  const apiKey = process.env.MAPY_API_KEY?.trim()
  if (!apiKey) throw new Error('Na serveru chybí MAPY_API_KEY.')
  const url = new URL(MAPY_GEOCODE_URL)
  url.searchParams.set('apikey', apiKey)
  url.searchParams.set('query', `${row.store_address}, ${row.store_city}`)
  url.searchParams.set('lang', 'cs')
  url.searchParams.set('limit', '8')
  url.searchParams.set('locality', 'cz')
  url.searchParams.set('type', 'regional.address')
  const payload = await fetchMapy(url)
  const items = Array.isArray(payload.items) ? payload.items : []
  const ranked = items.map((item) => ({ item, ...scoreCandidate(item, row) })).filter((candidate) => stringValue(candidate.item.type) === 'regional.address' && stringValue(candidate.item.name)).sort((left, right) => right.score - left.score)
  const selected = ranked[0] ?? null
  if (!selected) {
    const nearbyCandidates = await findNearbyChain(row, await findCityCenter(row, apiKey))
    return { analysisStatus: 'not_found' as const, confidence: 0, suggestedCity: null, suggestedAddress: null, suggestedLabel: null, suggestedZip: null, longitude: null, latitude: null, candidateCount: items.length, metadata: { resolver: 'mapy-geocode-v2', analyzerVersion: ANALYZER_VERSION, nearbyCandidates } }
  }

  const confidence = Math.round(selected.score * 1_000) / 1_000
  const suggestedCity = municipality(selected.item) || null
  const suggestedAddress = stringValue(selected.item.name) || null
  const cityExact = normalizeComparable(row.store_city) === normalizeComparable(suggestedCity ?? '')
  const streetExact = streetPart(row.store_address) === streetPart(suggestedAddress ?? '')
  const semanticExact = cityExact && streetExact && selected.exactNumberSet
  const normalizationOnly = semanticExact && (
    row.store_city.trim().toLocaleLowerCase('cs-CZ') !== (suggestedCity ?? '').trim().toLocaleLowerCase('cs-CZ')
    || row.store_address.trim().toLocaleLowerCase('cs-CZ') !== (suggestedAddress ?? '').trim().toLocaleLowerCase('cs-CZ')
  )
  const analysisStatus = semanticExact
    ? (normalizationOnly ? 'normalization' as const : 'verified' as const)
    : !selected.hasRequestedNumbers
      ? 'insufficient' as const
      : selected.citySimilarity >= 0.88 && selected.streetSimilarity >= 0.72 && confidence >= 0.5
        ? 'needs_review' as const
        : 'not_found' as const
  const lon = finiteNumber(selected.item.position?.lon)
  const lat = finiteNumber(selected.item.position?.lat)
  const nearbyCandidates = ['insufficient', 'needs_review', 'not_found'].includes(analysisStatus)
    ? await findNearbyChain(row, lon != null && lat != null ? { lon, lat } : null)
    : []
  return {
    analysisStatus,
    confidence,
    suggestedCity,
    suggestedAddress,
    suggestedLabel: stringValue(selected.item.location) || stringValue(selected.item.label) || null,
    suggestedZip: stringValue(selected.item.zip) || null,
    longitude: lon,
    latitude: lat,
    candidateCount: items.length,
    metadata: { resolver: 'mapy-geocode-v2', analyzerVersion: ANALYZER_VERSION, citySimilarity: Math.round(selected.citySimilarity * 1_000) / 1_000, streetSimilarity: Math.round(selected.streetSimilarity * 1_000) / 1_000, hasRequestedNumbers: selected.hasRequestedNumbers, exactNumberSet: selected.exactNumberSet, resultType: stringValue(selected.item.type), nearbyCandidates },
  }
}
async function loadEligibleRegistry(client: ServiceClient) {
  const rows: RegistryRow[] = []
  for (let from = 0; ; from += 1_000) {
    const { data, error } = await client.from('power_outage_store_registry').select('id,store_id,store_chain_name,store_number,store_city,store_address,address_fingerprint,needs_refresh,verification_status').eq('is_active', true).order('store_chain_name').order('store_number').range(from, from + 999)
    if (error) throw error
    rows.push(...((data ?? []) as RegistryRow[]))
    if ((data?.length ?? 0) < 1_000) break
  }
  return rows.filter((row) => (
    addressNumbers(row.store_address).size === 0
    || (!row.needs_refresh && ELIGIBLE_STATUSES.includes(row.verification_status as typeof ELIGIBLE_STATUSES[number]))
  ))
}
function currentSuggestion(row: RegistryRow, suggestion: SuggestionRow | undefined) {
  return suggestion?.address_fingerprint === row.address_fingerprint && Number(objectValue(suggestion.metadata).analyzerVersion) === ANALYZER_VERSION ? suggestion : null
}
export async function getStoreAddressAnalysis(): Promise<{ configured: boolean; items: StoreAddressAnalysisItem[] }> {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro analýzu adres.')
  const registry = await loadEligibleRegistry(client)
  const suggestions: SuggestionRow[] = []
  for (let from = 0; from < registry.length; from += 200) {
    const batch = registry.slice(from, from + 200).map((row) => row.id)
    const { data, error } = await client.from('power_outage_store_address_suggestions').select('id,registry_id,address_fingerprint,analysis_status,confidence,suggested_city,suggested_address,suggested_label,suggested_zip,longitude,latitude,candidate_count,analyzed_at,error_message,metadata').in('registry_id', batch)
    if (error) throw error
    suggestions.push(...((data ?? []) as SuggestionRow[]))
  }
  const byRegistryId = new Map(suggestions.map((row) => [row.registry_id, row]))
  return { configured: Boolean(process.env.MAPY_API_KEY?.trim()), items: registry.map((row) => {
    const suggestion = currentSuggestion(row, byRegistryId.get(row.id))
    const metadata = objectValue(suggestion?.metadata)
    const nearbyCandidates = Array.isArray(metadata.nearbyCandidates) ? metadata.nearbyCandidates as StoreAddressNearbyCandidate[] : []
    return { registryId: row.id, chainName: row.store_chain_name, storeNumber: row.store_number, currentCity: row.store_city, currentAddress: row.store_address, verificationStatus: row.verification_status, suggestionId: suggestion?.id ?? null, addressFingerprint: row.address_fingerprint, analysisStatus: suggestion?.analysis_status ?? 'pending', confidence: suggestion ? finiteNumber(suggestion.confidence) : null, suggestedCity: suggestion?.suggested_city ?? null, suggestedAddress: suggestion?.suggested_address ?? null, suggestedLabel: suggestion?.suggested_label ?? null, suggestedZip: suggestion?.suggested_zip ?? null, longitude: suggestion ? finiteNumber(suggestion.longitude) : null, latitude: suggestion ? finiteNumber(suggestion.latitude) : null, candidateCount: suggestion?.candidate_count ?? 0, analyzedAt: suggestion?.analyzed_at ?? null, errorMessage: suggestion?.error_message ?? null, nearbyCandidates }
  }) }
}
export async function analyzeStoreAddresses(requestedLimit = 10) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro analýzu adres.')
  const registry = await loadEligibleRegistry(client)
  const limit = Math.max(1, Math.min(15, Math.floor(requestedLimit)))
  const existing: SuggestionRow[] = []
  for (let from = 0; from < registry.length; from += 200) {
    const batch = registry.slice(from, from + 200).map((row) => row.id)
    const { data, error } = await client.from('power_outage_store_address_suggestions').select('id,registry_id,address_fingerprint,analysis_status,confidence,suggested_city,suggested_address,suggested_label,suggested_zip,longitude,latitude,candidate_count,analyzed_at,error_message,metadata').in('registry_id', batch)
    if (error) throw error
    existing.push(...((data ?? []) as SuggestionRow[]))
  }
  const byRegistryId = new Map(existing.map((row) => [row.registry_id, row]))
  const selected = registry.filter((row) => !currentSuggestion(row, byRegistryId.get(row.id))).slice(0, limit)
  let succeededCount = 0
  let failedCount = 0
  for (const row of selected) {
    try {
      const result = await geocodeAddress(row)
      const { error } = await client.from('power_outage_store_address_suggestions').upsert({
        registry_id: row.id,
        store_id: row.store_id,
        store_chain_name: row.store_chain_name,
        store_number: row.store_number,
        current_city: row.store_city,
        current_address: row.store_address,
        address_fingerprint: row.address_fingerprint,
        source: 'mapy',
        analysis_status: result.analysisStatus,
        confidence: result.confidence,
        query_text: `${row.store_address}, ${row.store_city}`,
        suggested_city: result.suggestedCity,
        suggested_address: result.suggestedAddress,
        suggested_label: result.suggestedLabel,
        suggested_zip: result.suggestedZip,
        longitude: result.longitude,
        latitude: result.latitude,
        candidate_count: result.candidateCount,
        metadata: result.metadata,
        analyzed_at: new Date().toISOString(),
        error_message: null,
      }, { onConflict: 'registry_id' })
      if (error) throw error
      succeededCount += 1
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Analýza adresy selhala.'
      const { error: saveError } = await client.from('power_outage_store_address_suggestions').upsert({
        registry_id: row.id,
        store_id: row.store_id,
        store_chain_name: row.store_chain_name,
        store_number: row.store_number,
        current_city: row.store_city,
        current_address: row.store_address,
        address_fingerprint: row.address_fingerprint,
        source: 'mapy',
        analysis_status: 'error',
        confidence: 0,
        query_text: `${row.store_address}, ${row.store_city}`,
        suggested_city: null,
        suggested_address: null,
        suggested_label: null,
        suggested_zip: null,
        longitude: null,
        latitude: null,
        candidate_count: 0,
        analyzed_at: new Date().toISOString(),
        error_message: message,
        metadata: { resolver: 'mapy-geocode-v2', analyzerVersion: ANALYZER_VERSION, nearbyCandidates: [] },
      }, { onConflict: 'registry_id' })
      if (saveError) throw saveError
      failedCount += 1
    }
  }
  return { processedCount: selected.length, succeededCount, failedCount, remainingCount: Math.max(0, registry.length - selected.length) }
}
