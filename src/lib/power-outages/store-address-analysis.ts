import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { normalizePowerOutageText } from './normalization'
import type { StoreAddressAnalysisItem } from './types'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type RegistryRow = {
  id: string
  store_id: string | null
  store_chain_name: string
  store_number: string
  store_city: string
  store_address: string
  address_fingerprint: string
  verification_status: 'needs_review' | 'not_found' | 'error'
}

type SuggestionRow = {
  registry_id: string
  address_fingerprint: string
  analysis_status: 'suggested' | 'needs_review' | 'not_found' | 'error'
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
}

type MapyRegionalItem = {
  name?: unknown
  type?: unknown
  isoCode?: unknown
}

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

const ELIGIBLE_STATUSES = ['needs_review', 'not_found', 'error'] as const
const MAPY_GEOCODE_URL = 'https://api.mapy.com/v1/geocode'

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeComparable(value: string) {
  return normalizePowerOutageText(value)
    .replace(/\b(?:ulice|ul\.?|namesti|nam\.?|trida|tr\.?|ev\.?\s*c\.?)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function streetPart(value: string) {
  return normalizeComparable(value)
    .replace(/\s+\d+[a-z]?(?:\s*\/\s*\d+[a-z]?)?.*$/, '')
    .trim()
}

function addressNumbers(value: string) {
  return new Set(
    [...value.matchAll(/\b\d+[a-z]?\b/gi)]
      .map((match) => normalizeComparable(match[0]))
      .filter(Boolean),
  )
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
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      )
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

function candidateCity(item: MapyItem, requestedCity: string) {
  const municipalityParts = regionalNames(item, 'regional.municipality_part')
  const municipalities = regionalNames(item, 'regional.municipality')
  const requested = normalizeComparable(requestedCity)
  return [...municipalityParts, ...municipalities].find((value) => normalizeComparable(value) === requested)
    ?? municipalityParts[0]
    ?? municipalities[0]
    ?? ''
}

function scoreCandidate(item: MapyItem, row: RegistryRow) {
  const name = stringValue(item.name)
  const cityNames = [
    ...regionalNames(item, 'regional.municipality_part'),
    ...regionalNames(item, 'regional.municipality'),
  ]
  const requestedCity = normalizeComparable(row.store_city)
  const citySimilarity = cityNames.reduce(
    (best, value) => Math.max(best, similarity(requestedCity, value)),
    0,
  )
  const requestedStreet = streetPart(row.store_address)
  const candidateStreet = streetPart(name)
  const streetSimilarity = similarity(requestedStreet, candidateStreet)
  const requestedNumbers = addressNumbers(row.store_address)
  const candidateNumbers = addressNumbers(name)
  const numberMatch = requestedNumbers.size === 0
    || [...requestedNumbers].some((value) => candidateNumbers.has(value))
  const typeMatches = stringValue(item.type) === 'regional.address'

  const score = Math.min(1,
    citySimilarity * 0.35
    + streetSimilarity * 0.35
    + (numberMatch ? 0.25 : 0)
    + (typeMatches ? 0.05 : 0),
  )

  return { score, citySimilarity, streetSimilarity, numberMatch, typeMatches }
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
  url.searchParams.append('type', 'regional.address')

  const response = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) {
    throw new Error(`Mapy.com Geocoding odpověděl HTTP ${response.status}.`)
  }
  const payload = await response.json() as MapyResponse
  const items = Array.isArray(payload.items) ? payload.items : []
  const ranked = items
    .map((item) => ({ item, ...scoreCandidate(item, row) }))
    .filter((candidate) => candidate.typeMatches && stringValue(candidate.item.name))
    .sort((left, right) => right.score - left.score)
  const selected = ranked[0] ?? null

  if (!selected) {
    return {
      analysisStatus: 'not_found' as const,
      confidence: 0,
      suggestedCity: null,
      suggestedAddress: null,
      suggestedLabel: null,
      suggestedZip: null,
      longitude: null,
      latitude: null,
      candidateCount: items.length,
      metadata: { resolver: 'mapy-geocode-v1' },
    }
  }

  const confidence = Math.round(selected.score * 1_000) / 1_000
  const analysisStatus = selected.citySimilarity >= 0.88
    && selected.streetSimilarity >= 0.72
    && selected.numberMatch
    && confidence >= 0.74
    ? 'suggested' as const
    : confidence >= 0.52
      ? 'needs_review' as const
      : 'not_found' as const

  return {
    analysisStatus,
    confidence,
    suggestedCity: candidateCity(selected.item, row.store_city) || null,
    suggestedAddress: stringValue(selected.item.name) || null,
    suggestedLabel: stringValue(selected.item.location) || stringValue(selected.item.label) || null,
    suggestedZip: stringValue(selected.item.zip) || null,
    longitude: finiteNumber(selected.item.position?.lon),
    latitude: finiteNumber(selected.item.position?.lat),
    candidateCount: items.length,
    metadata: {
      resolver: 'mapy-geocode-v1',
      citySimilarity: Math.round(selected.citySimilarity * 1_000) / 1_000,
      streetSimilarity: Math.round(selected.streetSimilarity * 1_000) / 1_000,
      numberMatch: selected.numberMatch,
      resultType: stringValue(selected.item.type),
    },
  }
}

async function loadEligibleRegistry(client: ServiceClient) {
  const rows: RegistryRow[] = []
  const pageSize = 1_000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('power_outage_store_registry')
      .select('id,store_id,store_chain_name,store_number,store_city,store_address,address_fingerprint,verification_status')
      .eq('is_active', true)
      .eq('needs_refresh', false)
      .in('verification_status', [...ELIGIBLE_STATUSES])
      .order('store_chain_name')
      .order('store_number')
      .range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...((data ?? []) as RegistryRow[]))
    if ((data?.length ?? 0) < pageSize) break
  }
  return rows
}

export async function getStoreAddressAnalysis(): Promise<{
  configured: boolean
  items: StoreAddressAnalysisItem[]
}> {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro analýzu adres.')
  const registry = await loadEligibleRegistry(client)
  const registryIds = registry.map((row) => row.id)
  const suggestions: SuggestionRow[] = []

  for (let from = 0; from < registryIds.length; from += 200) {
    const batch = registryIds.slice(from, from + 200)
    if (batch.length === 0) continue
    const { data, error } = await client
      .from('power_outage_store_address_suggestions')
      .select('registry_id,address_fingerprint,analysis_status,confidence,suggested_city,suggested_address,suggested_label,suggested_zip,longitude,latitude,candidate_count,analyzed_at,error_message')
      .in('registry_id', batch)
    if (error) throw error
    suggestions.push(...((data ?? []) as SuggestionRow[]))
  }

  const byRegistryId = new Map(suggestions.map((row) => [row.registry_id, row]))
  return {
    configured: Boolean(process.env.MAPY_API_KEY?.trim()),
    items: registry.map((row) => {
      const suggestion = byRegistryId.get(row.id)
      const currentSuggestion = suggestion?.address_fingerprint === row.address_fingerprint
        ? suggestion
        : null
      return {
        registryId: row.id,
        chainName: row.store_chain_name,
        storeNumber: row.store_number,
        currentCity: row.store_city,
        currentAddress: row.store_address,
        verificationStatus: row.verification_status,
        analysisStatus: currentSuggestion?.analysis_status ?? 'pending',
        confidence: currentSuggestion ? Number(currentSuggestion.confidence) : null,
        suggestedCity: currentSuggestion?.suggested_city ?? null,
        suggestedAddress: currentSuggestion?.suggested_address ?? null,
        suggestedLabel: currentSuggestion?.suggested_label ?? null,
        suggestedZip: currentSuggestion?.suggested_zip ?? null,
        longitude: currentSuggestion?.longitude == null ? null : Number(currentSuggestion.longitude),
        latitude: currentSuggestion?.latitude == null ? null : Number(currentSuggestion.latitude),
        candidateCount: currentSuggestion?.candidate_count ?? null,
        analyzedAt: currentSuggestion?.analyzed_at ?? null,
        errorMessage: currentSuggestion?.error_message ?? null,
      }
    }),
  }
}

export async function analyzeStoreAddresses(limit = 20) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro analýzu adres.')
  if (!process.env.MAPY_API_KEY?.trim()) throw new Error('Na serveru chybí MAPY_API_KEY.')
  const safeLimit = Math.min(30, Math.max(1, Math.trunc(limit)))
  const registry = await loadEligibleRegistry(client)
  if (registry.length === 0) {
    return { analyzedCount: 0, suggestedCount: 0, reviewCount: 0, notFoundCount: 0, errorCount: 0, hasMore: false }
  }

  const registryIds = registry.map((row) => row.id)
  const { data: cachedData, error: cachedError } = await client
    .from('power_outage_store_address_suggestions')
    .select('registry_id,address_fingerprint')
    .in('registry_id', registryIds)
  if (cachedError) throw cachedError
  const cached = new Map((cachedData ?? []).map((row) => [String(row.registry_id), String(row.address_fingerprint)]))
  const allPending = registry.filter((row) => cached.get(row.id) !== row.address_fingerprint)
  const pending = allPending.slice(0, safeLimit)

  let suggestedCount = 0
  let reviewCount = 0
  let notFoundCount = 0
  let errorCount = 0

  for (const row of pending) {
    const analyzedAt = new Date().toISOString()
    try {
      const result = await geocodeAddress(row)
      if (result.analysisStatus === 'suggested') suggestedCount += 1
      else if (result.analysisStatus === 'needs_review') reviewCount += 1
      else notFoundCount += 1
      const { error } = await client
        .from('power_outage_store_address_suggestions')
        .upsert({
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
          analyzed_at: analyzedAt,
          error_message: null,
          metadata: result.metadata,
        }, { onConflict: 'registry_id' })
      if (error) throw error
    } catch (error) {
      errorCount += 1
      const message = error instanceof Error ? error.message : 'Analýza adresy selhala.'
      const { error: saveError } = await client
        .from('power_outage_store_address_suggestions')
        .upsert({
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
          candidate_count: 0,
          analyzed_at: analyzedAt,
          error_message: message.slice(0, 1_000),
          metadata: { resolver: 'mapy-geocode-v1' },
        }, { onConflict: 'registry_id' })
      if (saveError) throw saveError
    }
    // Dávka je úmyslně sekvenční. Chrání API před krátkým burstem a současně
    // nezasahuje do frekvence ani chování synchronizací ČEZ a EG.D.
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  return {
    analyzedCount: pending.length,
    suggestedCount,
    reviewCount,
    notFoundCount,
    errorCount,
    hasMore: allPending.length > pending.length,
  }
}
