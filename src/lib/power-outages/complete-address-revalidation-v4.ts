import 'server-only'

import { z } from 'zod'
import { getServiceRoleClient } from '@/lib/supabase/service'
import {
  evaluateCompleteAddressMatchV4,
  type CompleteAddressMatchV4Candidate,
  type CompleteAddressMatchV4Target,
} from './complete-address-match-v4'
import { loadCompleteCezRuianMunicipalityAddressPoints } from './complete-cez-ruian'
import { normalizePowerOutageText, powerOutageSha256 } from './normalization'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>
type RevalidationProvider = 'ares' | 'ruian' | 'mapy'
type RevalidationOutcome =
  | 'verified'
  | 'conflict'
  | 'inconclusive'
  | 'not_found'
  | 'transient_error'
  | 'configuration_error'

type ClaimRow = {
  id: string
  processing_token: string
  provider: RevalidationProvider
  attempt_count: number
  max_attempt_count: number
  company_ico: string | null
  company_name: string
  target_snapshot: CompleteAddressMatchV4Target
  candidate_snapshot: CompleteAddressMatchV4Candidate
}

type ProviderResult = {
  outcome: Exclude<RevalidationOutcome, 'transient_error' | 'configuration_error'>
  normalizedResult: Record<string, unknown>
}

const aresSubjectSchema = z.object({
  ico: z.union([z.string(), z.number()]).nullish(),
  obchodniJmeno: z.string().nullish(),
  sidlo: z.object({
    textovaAdresa: z.string().nullish(),
    kodAdresnihoMista: z.union([z.string(), z.number()]).nullish(),
    psc: z.union([z.string(), z.number()]).nullish(),
  }).passthrough().nullish(),
}).passthrough()

const mapySchema = z.object({
  items: z.array(z.object({
    name: z.string().nullish(),
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

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : String(value ?? '').trim()
}

function normalizedResult(
  provider: RevalidationProvider,
  candidate: CompleteAddressMatchV4Candidate,
  target: CompleteAddressMatchV4Target,
) {
  const evaluation = evaluateCompleteAddressMatchV4({ target, candidate })
  return {
    outcome: evaluation.automaticConfirmationAllowed
      ? 'verified' as const
      : evaluation.classification === 'address_conflict'
        ? 'conflict' as const
        : 'inconclusive' as const,
    normalizedResult: {
      contract: 'complete-address-revalidation-v4',
      provider,
      classification: evaluation.classification,
      reasonCodes: evaluation.reasonCodes,
      confidenceCeiling: evaluation.confidenceCeiling,
      distanceMeters: evaluation.distanceMeters,
      candidate: {
        displayAddress: candidate.displayAddress,
        postalCode: candidate.postalCode ?? null,
        ruianAddressId: candidate.ruianAddressId ?? null,
        latitude: candidate.latitude ?? null,
        longitude: candidate.longitude ?? null,
      },
    },
  }
}

async function responseJson(response: Response, provider: string) {
  const text = await response.text()
  if (!response.ok) throw new Error(`${provider} HTTP ${response.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text) as unknown
}

async function revalidateWithAres(row: ClaimRow): Promise<ProviderResult> {
  if (!row.company_ico) {
    return { outcome: 'inconclusive', normalizedResult: { provider: 'ares', reason: 'missing_ico' } }
  }
  const response = await fetch(
    `https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/${encodeURIComponent(row.company_ico)}`,
    { cache: 'no-store', signal: AbortSignal.timeout(20_000), headers: { Accept: 'application/json' } },
  )
  if (response.status === 404) {
    return { outcome: 'not_found', normalizedResult: { provider: 'ares', reason: 'subject_not_found' } }
  }
  const subject = aresSubjectSchema.parse(await responseJson(response, 'ARES'))
  const address = cleanText(subject.sidlo?.textovaAdresa)
  if (!address) {
    return { outcome: 'inconclusive', normalizedResult: { provider: 'ares', reason: 'registered_address_missing' } }
  }
  return normalizedResult('ares', {
    displayAddress: address,
    postalCode: cleanText(subject.sidlo?.psc) || null,
    ruianAddressId: cleanText(subject.sidlo?.kodAdresnihoMista) || null,
  }, row.target_snapshot)
}

function pointDisplayAddress(point: {
  municipalityName: string
  townPart: string | null
  street: string | null
  houseNumber: string
  orientationNumber: string | null
  postalCode: string | null
}) {
  const number = point.orientationNumber
    ? `${point.houseNumber}/${point.orientationNumber}`
    : point.houseNumber
  return [point.street, number, point.townPart, point.postalCode, point.municipalityName]
    .filter(Boolean).join(', ')
}

async function revalidateWithRuian(row: ClaimRow): Promise<ProviderResult> {
  const municipalityCode = cleanText(row.target_snapshot.municipalityCode)
  const candidateRuian = cleanText(row.candidate_snapshot.ruianAddressId)
  if (!/^[0-9]{6}$/.test(municipalityCode) || !/^\d+$/.test(candidateRuian)) {
    return {
      outcome: 'inconclusive',
      normalizedResult: { provider: 'ruian', reason: 'municipality_or_candidate_address_id_missing' },
    }
  }
  const source = await loadCompleteCezRuianMunicipalityAddressPoints(municipalityCode)
  const point = source.points.find((candidate) => candidate.addressCode === candidateRuian)
  if (!point) {
    return {
      outcome: 'conflict',
      normalizedResult: {
        provider: 'ruian',
        reason: 'candidate_address_id_outside_target_municipality',
        municipalityCode,
        candidateRuianAddressId: candidateRuian,
        sourceValidOn: source.sourceValidOn,
      },
    }
  }
  const result = normalizedResult('ruian', {
    displayAddress: pointDisplayAddress(point),
    postalCode: point.postalCode,
    ruianAddressId: point.addressCode,
  }, row.target_snapshot)
  return {
    ...result,
    normalizedResult: { ...result.normalizedResult, sourceValidOn: source.sourceValidOn },
  }
}

type MapyItem = NonNullable<z.infer<typeof mapySchema>['items']>[number]

function mapyAddress(item: MapyItem) {
  const parts = item.regionalStructure ?? []
  const street = parts.find((part) => part.type === 'regional.street')?.name?.trim() ?? ''
  const number = parts.find((part) => part.type === 'regional.address')?.name?.trim() ?? ''
  const municipality = parts.find((part) => part.type === 'regional.municipality')?.name?.trim() ?? ''
  return [street, number, municipality].filter(Boolean).join(', ') || cleanText(item.location)
}

async function revalidateWithMapy(row: ClaimRow): Promise<ProviderResult> {
  const apiKey = process.env.MAPY_API_KEY?.trim()
  if (!apiKey) throw new Error('CONFIGURATION_ERROR: MAPY_API_KEY chybi.')
  const target = row.target_snapshot
  const addressQuery = [
    target.street,
    target.houseNumber,
    target.orientationNumber,
    target.townPart,
    target.postalCode,
    target.municipality,
  ].filter(Boolean).join(' ')
  const url = new URL('https://api.mapy.com/v1/geocode')
  url.searchParams.set('apikey', apiKey)
  url.searchParams.set('query', `${row.company_name}, ${addressQuery}, Česko`)
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
  const payload = mapySchema.parse(await responseJson(response, 'Mapy.com'))
  const expectedName = normalizePowerOutageText(row.company_name)
  const item = (payload.items ?? []).find((candidate) => {
    if (candidate.type !== 'poi') return false
    const name = normalizePowerOutageText(candidate.name ?? '')
    return name === expectedName || (name.length >= 8 && expectedName.includes(name))
      || (expectedName.length >= 8 && name.includes(expectedName))
  })
  if (!item) {
    return { outcome: 'not_found', normalizedResult: { provider: 'mapy', reason: 'matching_poi_not_found' } }
  }
  const address = mapyAddress(item)
  if (!address) {
    return { outcome: 'inconclusive', normalizedResult: { provider: 'mapy', reason: 'poi_address_missing' } }
  }
  return normalizedResult('mapy', {
    displayAddress: address,
    latitude: item.position?.lat ?? null,
    longitude: item.position?.lon ?? null,
  }, target)
}

async function claimQuota(client: ServiceClient, provider: RevalidationProvider) {
  if (provider === 'ruian') {
    const { data, error } = await client.rpc(
      'claim_complete_power_outage_address_revalidation_v4_ruian_quota',
      { requested_minute_limit: 4, requested_day_limit: 500 },
    )
    if (error) throw error
    return data === true
  }
  const limits = provider === 'ares'
    ? { minute: 60, day: 30_000 }
    : { minute: 50, day: 75_000 }
  const { data, error } = await client.rpc('claim_complete_power_outage_provider_quota', {
    requested_provider: provider,
    requested_minute_limit: limits.minute,
    requested_day_limit: limits.day,
  })
  if (error) throw error
  return data === true
}

async function releaseClaim(client: ServiceClient, row: ClaimRow, delaySeconds: number) {
  const { error } = await client.rpc(
    'release_complete_power_outage_address_revalidation_v4_claim_v1',
    {
      requested_queue_id: row.id,
      requested_processing_token: row.processing_token,
      requested_delay_seconds: delaySeconds,
    },
  )
  if (error) throw error
}

async function completeClaim(client: ServiceClient, row: ClaimRow, input: {
  outcome: RevalidationOutcome
  normalizedResult: Record<string, unknown>
  errorCode?: string | null
  startedAt: string
}) {
  const { data, error } = await client.rpc(
    'finish_complete_power_outage_address_revalidation_v4_v1',
    {
      requested_queue_id: row.id,
      requested_processing_token: row.processing_token,
      requested_outcome: input.outcome,
      requested_response_fingerprint: powerOutageSha256(input.normalizedResult),
      requested_normalized_result: input.normalizedResult,
      requested_error_code: input.errorCode ?? null,
      requested_started_at: input.startedAt,
    },
  )
  if (error) throw error
  if (data !== true) throw new Error('Lease externi adresni revalidace jiz neni platny.')
}

function errorDisposition(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const configurationError = /CONFIGURATION_ERROR|API_KEY|HTTP\s+(401|403)\b/i.test(message)
  return {
    outcome: configurationError ? 'configuration_error' as const : 'transient_error' as const,
    errorCode: configurationError ? 'PROVIDER_CONFIGURATION_ERROR' : 'PROVIDER_TRANSIENT_ERROR',
    message: message.slice(0, 500),
  }
}

async function processClaim(client: ServiceClient, row: ClaimRow) {
  const startedAt = new Date().toISOString()
  if (!await claimQuota(client, row.provider)) {
    await releaseClaim(client, row, 60)
    return { status: 'rate_limited' as const, provider: row.provider }
  }
  try {
    const result = row.provider === 'ares'
      ? await revalidateWithAres(row)
      : row.provider === 'ruian'
        ? await revalidateWithRuian(row)
        : await revalidateWithMapy(row)
    await completeClaim(client, row, { ...result, startedAt })
    return { status: result.outcome, provider: row.provider }
  } catch (error) {
    const disposition = errorDisposition(error)
    await completeClaim(client, row, {
      outcome: disposition.outcome,
      normalizedResult: {
        contract: 'complete-address-revalidation-v4',
        provider: row.provider,
        error: disposition.message,
      },
      errorCode: disposition.errorCode,
      startedAt,
    })
    return { status: disposition.outcome, provider: row.provider }
  }
}

export async function processCompleteAddressRevalidationV4(requestedLimit = 1) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybi serverove pripojeni pro externi adresni revalidaci.')
  const limit = Math.min(3, Math.max(1, Math.trunc(requestedLimit)))
  const { data, error } = await client.rpc(
    'claim_complete_power_outage_address_revalidation_v4_v1',
    { requested_limit: limit },
  )
  if (error) throw error
  const claims = (data ?? []) as ClaimRow[]
  const results = []
  for (const row of claims) results.push(await processClaim(client, row))
  return {
    status: claims.length === 0 ? 'disabled_or_empty' as const : 'processed' as const,
    claimedCount: claims.length,
    results,
  }
}
