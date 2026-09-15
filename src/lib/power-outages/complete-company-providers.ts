import 'server-only'

import { z } from 'zod'
import { normalizePowerOutageText, powerOutageSha256 } from './normalization'
import {
  evaluateCompleteAddressMatchV6,
  type CompleteAddressMatchV6Result,
} from './complete-address-match-v6'

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
  postalCode?: string | null
  ruianAddressId?: string | number | null
  houseNumber?: string | number | null
  orientationNumber?: string | number | null
  sourceUrl: string | null
  entityKind: 'registered_office' | 'establishment'
  confidence: number
  metadata: Record<string, unknown>
}

export type CompleteDiscoveryTarget = {
  source?: 'cez' | 'egd' | 'pre' | null
  targetKind: 'exact_number' | 'street' | 'municipality'
  queryText: string
  municipality: string
  townPart: string | null
  street: string
  numberToken: string | null
  postalCode?: string | null
  ruianAddressId?: string | number | null
  houseNumber?: string | null
  orientationNumber?: string | null
  latitude: number | null
  longitude: number | null
}

export const PROVIDER_LIMITS: Record<CompleteDiscoveryProvider, {
  minute: number
  day: number
  maxPerRun: number
  cacheHours: number | null
}> = {
  ares: { minute: 60, day: 30_000, maxPerRun: 100, cacheHours: 7 * 24 },
  mapy: { minute: 50, day: 75_000, maxPerRun: 50, cacheHours: 7 * 24 },
  google: { minute: 3, day: 100, maxPerRun: 5, cacheHours: 24 },
}

export const MAPY_MONTHLY_FREE_CREDIT_LIMIT = 250_000
export const MAPY_MONTHLY_CREDIT_LIMIT = 500_000
export const MAPY_MONTHLY_CREDIT_SAFETY_CAP = 500_000
export const MAPY_CREDITS_PER_REQUEST = 4

const aresResponseSchema = z.object({
  ekonomickeSubjekty: z.array(z.object({
    ico: z.union([z.string(), z.number()]).nullish(),
    obchodniJmeno: z.string().nullish(),
    pravniForma: z.union([z.string(), z.number()]).nullish(),
    czNace: z.array(z.union([z.string(), z.number()])).nullish(),
    sidlo: z.object({
      textovaAdresa: z.string().nullish(),
      kodAdresnihoMista: z.union([z.string(), z.number()]).nullish(),
      psc: z.union([z.string(), z.number()]).nullish(),
      cisloDomovni: z.union([z.string(), z.number()]).nullish(),
      cisloOrientacni: z.union([z.string(), z.number()]).nullish(),
      cisloOrientacniPismeno: z.string().nullish(),
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

function aresOrientationNumber(number: unknown, suffix: unknown) {
  const numeric = String(number ?? '').trim()
  if (!numeric) return null
  const letter = String(suffix ?? '').trim().toLocaleLowerCase('cs-CZ')
  return `${numeric}${letter}`
}

function addressNumberTokens(value: string) {
  return new Set(
    [...value.toLocaleLowerCase('cs-CZ').matchAll(/(?:^|[^\p{L}\d])0*(\d+)([a-z]?)(?=$|[^\p{L}\d])/giu)]
      .map((match) => {
        const number = String(Number.parseInt(match[1], 10))
        return number === '0' ? '' : `${number}${match[2] ?? ''}`
      })
      .filter(Boolean),
  )
}

function addressMatchesTarget(address: string, target: CompleteDiscoveryTarget) {
  const normalizedAddress = normalizePowerOutageText(address)
  const municipality = normalizePowerOutageText(target.municipality)
  const street = normalizePowerOutageText(target.street)
  if (!normalizedAddress || !municipality || !normalizedAddress.includes(municipality)) return false
  if (street && !normalizedAddress.includes(street)) return false
  if (target.targetKind !== 'exact_number') return true
  const expectedNumbers = addressNumberTokens(target.numberToken ?? '')
  const actualNumbers = addressNumberTokens(address)
  return expectedNumbers.size > 0 && [...expectedNumbers].every((number) => actualNumbers.has(number))
}

export function candidateMatchesDiscoveryTarget(
  candidate: CompleteCompanyCandidate,
  target: CompleteDiscoveryTarget,
) {
  return evaluateCandidateDiscoveryMatch(candidate, target).accepted
}

export type CandidateDiscoveryMatch = {
  accepted: boolean
  matchLevel: 'exact_address' | 'same_building' | 'nearby' | 'unresolved'
  confidenceCeiling: number
  evaluation: CompleteAddressMatchV6Result | null
  egdV6Applied: boolean
}

/**
 * Přísný v6 matcher je záměrně omezený jen na přesné adresní cíle EG.D
 * v katalogu KOMPLETNÍ. ČEZ a PRE touto změnou dál procházejí původní
 * validací beze změny výsledku i confidence.
 */
export function evaluateCandidateDiscoveryMatch(
  candidate: CompleteCompanyCandidate,
  target: CompleteDiscoveryTarget,
): CandidateDiscoveryMatch {
  const legacyAccepted = Boolean(
    candidate.displayAddress && addressMatchesTarget(candidate.displayAddress, target),
  )
  if (target.source !== 'egd' || target.targetKind !== 'exact_number') {
    return {
      accepted: legacyAccepted,
      matchLevel: target.targetKind === 'exact_number' ? 'exact_address' : 'nearby',
      confidenceCeiling: candidate.confidence,
      evaluation: null,
      egdV6Applied: false,
    }
  }
  if (!candidate.displayAddress) {
    return {
      accepted: false,
      matchLevel: 'unresolved',
      confidenceCeiling: 0.2,
      evaluation: null,
      egdV6Applied: true,
    }
  }

  const evaluation = evaluateCompleteAddressMatchV6({
    target: {
      municipality: target.municipality,
      townPart: target.townPart,
      street: target.street,
      houseNumber: target.houseNumber,
      orientationNumber: target.orientationNumber,
      postalCode: target.postalCode,
      ruianAddressId: target.ruianAddressId,
      latitude: target.latitude,
      longitude: target.longitude,
    },
    candidate: {
      displayAddress: candidate.displayAddress,
      postalCode: candidate.postalCode,
      ruianAddressId: candidate.ruianAddressId,
      houseNumber: candidate.houseNumber,
      orientationNumber: candidate.orientationNumber,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
    },
  })
  return {
    accepted: evaluation.classification !== 'address_conflict',
    matchLevel: evaluation.automaticConfirmationAllowed
      ? evaluation.classification === 'same_building' ? 'same_building' : 'exact_address'
      : 'unresolved',
    confidenceCeiling: evaluation.confidenceCeiling,
    evaluation,
    egdV6Applied: true,
  }
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
    if (!ico || !name) return []
    const candidate: CompleteCompanyCandidate = {
      providerEntityId: ico,
      displayName: name,
      displayAddress: address,
      ico,
      legalForm: String(item.pravniForma ?? '').trim() || null,
      naceCodes: (item.czNace ?? []).map(String).map((value) => value.trim()).filter(Boolean),
      latitude: null,
      longitude: null,
      postalCode: String(item.sidlo?.psc ?? '').trim() || null,
      ruianAddressId: item.sidlo?.kodAdresnihoMista ?? null,
      houseNumber: item.sidlo?.cisloDomovni ?? null,
      orientationNumber: aresOrientationNumber(
        item.sidlo?.cisloOrientacni,
        item.sidlo?.cisloOrientacniPismeno,
      ),
      sourceUrl: `https://ares.gov.cz/ekonomicke-subjekty?ico=${ico}`,
      entityKind: 'registered_office',
      confidence: 0.98,
      metadata: {
        contract: 'ares-public-rest-v1',
        ruianAddressId: cleanText(item.sidlo?.kodAdresnihoMista) || null,
        structuredAddress: {
          postalCode: String(item.sidlo?.psc ?? '').trim() || null,
          houseNumber: String(item.sidlo?.cisloDomovni ?? '').trim() || null,
          orientationNumber: aresOrientationNumber(
            item.sidlo?.cisloOrientacni,
            item.sidlo?.cisloOrientacniPismeno,
          ),
        },
      },
    }
    return candidateMatchesDiscoveryTarget(candidate, target) ? [candidate] : []
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
    const latitude = item.position?.lat ?? null
    const longitude = item.position?.lon ?? null
    const providerEntityId = powerOutageSha256({
      name: normalizePowerOutageText(name),
      address: normalizePowerOutageText(address),
      latitude,
      longitude,
    })
    const candidate: CompleteCompanyCandidate = {
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
    }
    return candidateMatchesDiscoveryTarget(candidate, target) ? [candidate] : []
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
    const candidate: CompleteCompanyCandidate = {
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
    }
    return candidateMatchesDiscoveryTarget(candidate, target) ? [candidate] : []
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
