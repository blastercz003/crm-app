import 'server-only'

import { z } from 'zod'
import { normalizePowerOutageText, powerOutageSha256 } from './normalization'

export type CompleteDiscoveryProvider = 'ares' | 'mapy' | 'google'

export type CompleteCompanyCandidate = {
  providerEntityId: string
  displayName: string | null
  displayAddress: string | null
  ico: string | null
  legalForm: string | null
  naceCodes: string[]
  latitude: number | null
  longitude: number | null
  sourceUrl: string | null
  entityKind: 'registered_office' | 'establishment'
  confidence: number
  metadata: Record<string, unknown>
}

export type CompleteDiscoveryTarget = {
  targetKind: 'exact_number' | 'street' | 'municipality'
  queryText: string
  municipality: string
  townPart: string | null
  street: string
  numberToken: string | null
  latitude: number | null
  longitude: number | null
}

export const PROVIDER_LIMITS: Record<CompleteDiscoveryProvider, {
  minute: number
  day: number
  maxPerRun: number
  cacheHours: number | null
}> = {
  ares: { minute: 60, day: 20_000, maxPerRun: 100, cacheHours: 7 * 24 },
  mapy: { minute: 5, day: 300, maxPerRun: 8, cacheHours: 7 * 24 },
  google: { minute: 3, day: 100, maxPerRun: 5, cacheHours: 24 },
}

const aresResponseSchema = z.object({
  ekonomickeSubjekty: z.array(z.object({
    ico: z.union([z.string(), z.number()]).nullish(),
    obchodniJmeno: z.string().nullish(),
    pravniForma: z.union([z.string(), z.number()]).nullish(),
    czNace: z.array(z.union([z.string(), z.number()])).nullish(),
    sidlo: z.object({
      textovaAdresa: z.string().nullish(),
      kodAdresnihoMista: z.union([z.string(), z.number()]).nullish(),
    }).passthrough().nullish(),
  }).passthrough()).nullish(),
}).passthrough()

const mapyResponseSchema = z.object({
  items: z.array(z.object({
    name: z.string().nullish(),
    label: z.string().nullish(),
    location: z.string().nullish(),
    type: z.string().nullish(),
    position: z.object({
      lon: z.coerce.number().finite().nullish(),
      lat: z.coerce.number().finite().nullish(),
    }).nullish(),
    regionalStructure: z.array(z.object({
      name: z.string().nullish(),
      type: z.string().nullish(),
    }).passthrough()).nullish(),
  }).passthrough()).nullish(),
}).passthrough()

const googleResponseSchema = z.object({
  places: z.array(z.object({
    id: z.string().min(1),
    displayName: z.object({ text: z.string().nullish() }).nullish(),
    formattedAddress: z.string().nullish(),
    googleMapsUri: z.string().url().nullish(),
    location: z.object({
      latitude: z.coerce.number().finite().nullish(),
      longitude: z.coerce.number().finite().nullish(),
    }).nullish(),
    types: z.array(z.string()).nullish(),
  }).passthrough()).nullish(),
}).passthrough()

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizedIco(value: unknown) {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length > 0 && digits.length <= 8 ? digits.padStart(8, '0') : null
}

function addressNumbers(value: string) {
  return new Set(
    [...value.matchAll(/\b0*(\d+)[a-z]?\b/gi)]
      .map((match) => String(Number.parseInt(match[1], 10)))
      .filter((number) => number !== '0'),
  )
}

function addressMatchesTarget(address: string, target: CompleteDiscoveryTarget) {
  const normalizedAddress = normalizePowerOutageText(address)
  const municipality = normalizePowerOutageText(target.municipality)
  const street = normalizePowerOutageText(target.street)
  if (!normalizedAddress || !municipality || !normalizedAddress.includes(municipality)) return false
  if (street && !normalizedAddress.includes(street)) return false
  if (target.targetKind !== 'exact_number') return true
  const expectedNumbers = addressNumbers(target.numberToken ?? '')
  const actualNumbers = addressNumbers(address)
  return expectedNumbers.size > 0 && [...expectedNumbers].every((number) => actualNumbers.has(number))
}

async function responseJson(response: Response, provider: string) {
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${provider} odpověděl HTTP ${response.status}: ${text.slice(0, 300)}`)
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new Error(`${provider} vrátil neplatnou JSON odpověď.`)
  }
}

async function discoverAres(target: CompleteDiscoveryTarget) {
  if (target.targetKind !== 'exact_number') return []
  const response = await fetch(
    'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/vyhledat',
    {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(20_000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ start: 0, pocet: 100, sidlo: { textovaAdresa: target.queryText } }),
    },
  )
  const payload = aresResponseSchema.parse(await responseJson(response, 'ARES'))
  return (payload.ekonomickeSubjekty ?? []).flatMap((item): CompleteCompanyCandidate[] => {
    const ico = normalizedIco(item.ico)
    const name = cleanText(item.obchodniJmeno)
    const address = cleanText(item.sidlo?.textovaAdresa)
    if (!ico || !name || !addressMatchesTarget(address, target)) return []
    return [{
      providerEntityId: ico,
      displayName: name,
      displayAddress: address,
      ico,
      legalForm: cleanText(item.pravniForma) || null,
      naceCodes: (item.czNace ?? []).map(String).map((value) => value.trim()).filter(Boolean),
      latitude: null,
      longitude: null,
      sourceUrl: `https://ares.gov.cz/ekonomicke-subjekty?ico=${ico}`,
      entityKind: 'registered_office',
      confidence: 0.98,
      metadata: {
        contract: 'ares-public-rest-v1',
        ruianAddressId: cleanText(item.sidlo?.kodAdresnihoMista) || null,
      },
    }]
  })
}

type MapyItem = NonNullable<z.infer<typeof mapyResponseSchema>['items']>[number]

function mapyRegionalAddress(item: MapyItem) {
  const parts = item.regionalStructure ?? []
  const street = parts.find((part) => part.type === 'regional.street')?.name?.trim() ?? ''
  const number = parts.find((part) => part.type === 'regional.address')?.name?.trim() ?? ''
  const municipality = parts.find((part) => part.type === 'regional.municipality')?.name?.trim() ?? ''
  return [street, number, municipality].filter(Boolean).join(', ')
}

async function discoverMapy(target: CompleteDiscoveryTarget) {
  if (target.targetKind === 'municipality') return []
  const apiKey = process.env.MAPY_API_KEY?.trim()
  if (!apiKey) throw new Error('Na serveru chybí MAPY_API_KEY.')
  const url = new URL('https://api.mapy.com/v1/geocode')
  url.searchParams.set('apikey', apiKey)
  url.searchParams.set('query', `${target.queryText}, Česko`)
  url.searchParams.set('lang', 'cs')
  url.searchParams.set('limit', '10')
  url.searchParams.set('type', 'poi')
  if (target.latitude != null && target.longitude != null) {
    url.searchParams.set('preferNear', `${target.longitude},${target.latitude}`)
    url.searchParams.set('preferNearPrecision', '500')
  }
  const response = await fetch(url, {
    cache: 'no-store', signal: AbortSignal.timeout(15_000), headers: { Accept: 'application/json' },
  })
  const payload = mapyResponseSchema.parse(await responseJson(response, 'Mapy.com'))
  return (payload.items ?? []).flatMap((item): CompleteCompanyCandidate[] => {
    const name = cleanText(item.name)
    if (!name || item.type !== 'poi') return []
    const address = mapyRegionalAddress(item) || cleanText(item.location) || target.queryText
    if (!addressMatchesTarget(address, target)) return []
    const latitude = item.position?.lat ?? null
    const longitude = item.position?.lon ?? null
    const providerEntityId = powerOutageSha256({
      name: normalizePowerOutageText(name),
      address: normalizePowerOutageText(address),
      latitude,
      longitude,
    })
    return [{
      providerEntityId,
      displayName: name,
      displayAddress: address,
      ico: null,
      legalForm: null,
      naceCodes: [],
      latitude,
      longitude,
      sourceUrl: null,
      entityKind: 'establishment',
      confidence: target.targetKind === 'exact_number' ? 0.88 : 0.62,
      metadata: { contract: 'mapy-geocode-poi-v1', label: cleanText(item.label) || null },
    }]
  })
}

async function discoverGoogle(target: CompleteDiscoveryTarget) {
  if (target.targetKind === 'municipality') return []
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim()
  if (!apiKey) throw new Error('Na serveru chybí GOOGLE_MAPS_API_KEY.')
  const response = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    cache: 'no-store',
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri',
    },
    body: JSON.stringify({
      textQuery: `Firmy a provozovny na adrese ${target.queryText}`,
      languageCode: 'cs',
      regionCode: 'CZ',
      pageSize: 10,
      includePureServiceAreaBusinesses: false,
    }),
  })
  const payload = googleResponseSchema.parse(await responseJson(response, 'Google Places'))
  return (payload.places ?? []).flatMap((place): CompleteCompanyCandidate[] => {
    const address = cleanText(place.formattedAddress)
    if (!addressMatchesTarget(address, target)) return []
    return [{
      providerEntityId: place.id,
      displayName: cleanText(place.displayName?.text) || null,
      displayAddress: address,
      ico: null,
      legalForm: null,
      naceCodes: [],
      latitude: place.location?.latitude ?? null,
      longitude: place.location?.longitude ?? null,
      sourceUrl: place.googleMapsUri ?? null,
      entityKind: 'establishment',
      confidence: target.targetKind === 'exact_number' ? 0.84 : 0.58,
      metadata: { contract: 'google-places-text-search-v1', types: place.types ?? [] },
    }]
  })
}

export function providerConfigured(provider: CompleteDiscoveryProvider) {
  if (provider === 'ares') return true
  if (provider === 'mapy') return Boolean(process.env.MAPY_API_KEY?.trim())
  return Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim())
}

export function providerLookupKind(provider: CompleteDiscoveryProvider) {
  return provider === 'ares' ? 'address' as const : 'text' as const
}

export function providerAcceptsTarget(provider: CompleteDiscoveryProvider, targetKind: CompleteDiscoveryTarget['targetKind']) {
  return provider === 'ares' ? targetKind === 'exact_number' : targetKind !== 'municipality'
}

export async function discoverCompanies(
  provider: CompleteDiscoveryProvider,
  target: CompleteDiscoveryTarget,
) {
  if (provider === 'ares') return discoverAres(target)
  if (provider === 'mapy') return discoverMapy(target)
  return discoverGoogle(target)
}

export function cacheSafeCandidates(
  provider: CompleteDiscoveryProvider,
  candidates: CompleteCompanyCandidate[],
) {
  if (provider !== 'google') return candidates
  // Podmínky Google Places dovolují dlouhodobě uchovat Place ID. Ostatní
  // obsah se po tomto běhu zahodí a neslouží jako naše trvalá databáze firem.
  return candidates.map((candidate) => ({
    ...candidate,
    displayName: null,
    displayAddress: null,
    latitude: null,
    longitude: null,
    metadata: { contract: 'google-place-id-only-v1' },
  }))
}
