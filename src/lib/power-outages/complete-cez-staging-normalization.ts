import 'server-only'

import { displayBuildingNumber, normalizeBuildingNumber } from './complete-address-numbering'
import {
  loadCompleteCezRuianMunicipalityAddressPoints,
  type CompleteCezRuianAddressPoint,
} from './complete-cez-ruian'
import { normalizePowerOutageText, powerOutageSha256 } from './normalization'
import { getServiceRoleClient } from '@/lib/supabase/service'

type StagedAddress = {
  id: string
  outage_external_id: string
  municipality: string
  municipality_code: string | null
  town_part: string | null
  street: string
  house_number: string | null
  orientation_number: string | null
  raw_address: string
  metadata: Record<string, unknown> | null
  normalization_attempt_count: number
  normalization_lock_token: string
}

type ExistingTarget = {
  id: string
  target_key: string
}

const NORMALIZATION_VERSION = 3
const MAX_TARGETS_PER_ADDRESS = 2_000
const MAX_EXPANDED_RANGE_SIZE = 500
const MAX_VALIDATION_BATCH_SIZE = 8

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return 'Normalizace stagingové adresy ČEZ selhala.'
}

function retryDelay(attemptCount: number) {
  if (attemptCount <= 1) return 15 * 60_000
  if (attemptCount === 2) return 60 * 60_000
  return 6 * 60 * 60_000
}

function strictNumberTokens(value: unknown) {
  const result: string[] = []
  const visit = (item: unknown) => {
    if (Array.isArray(item)) {
      item.forEach(visit)
      return
    }
    if (typeof item !== 'string' && typeof item !== 'number') return
    for (const token of String(item).split(/[,;\n]+/)) {
      const range = token.trim().match(/^0*(\d+)\s*[-–—]\s*0*(\d+)$/)
      if (range) {
        const start = Number.parseInt(range[1], 10)
        const end = Number.parseInt(range[2], 10)
        if (start > 0 && end >= start && end - start + 1 <= MAX_EXPANDED_RANGE_SIZE) {
          for (let number = start; number <= end; number += 1) result.push(String(number))
        }
        continue
      }
      const normalized = normalizeBuildingNumber(token)
      if (normalized) result.push(normalized)
    }
  }
  visit(value)
  return [...new Set(result)]
}

function queryText(parts: Array<string | null | undefined>) {
  const seen = new Set<string>()
  return parts
    .map((part) => part?.trim())
    .filter((part): part is string => {
      if (!part) return false
      const key = normalizePowerOutageText(part)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join(', ')
    .slice(0, 300)
}

function sourceNumbers(address: StagedAddress) {
  const numbers = new Map<string, Set<'house' | 'evidence' | 'orientation'>>()
  const add = (value: string, kind: 'house' | 'evidence' | 'orientation') => {
    const kinds = numbers.get(value) ?? new Set<'house' | 'evidence' | 'orientation'>()
    kinds.add(kind)
    numbers.set(value, kinds)
  }
  const directHouseNumber = normalizeBuildingNumber(address.house_number)
  if (directHouseNumber) add(directHouseNumber, 'house')
  for (const number of strictNumberTokens(address.metadata?.houseNumbers)) add(number, 'house')
  for (const number of strictNumberTokens(address.metadata?.evidenceNumbers)) add(number, 'evidence')

  const orientationNumbers = strictNumberTokens([
    address.orientation_number,
    address.metadata?.orientationNumbers,
  ])
  if (address.street.trim()) {
    for (const number of orientationNumbers) add(number, 'orientation')
  }
  return { numbers, orientationNumbers }
}

function sameText(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizePowerOutageText(left)
  const normalizedRight = normalizePowerOutageText(right)
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight)
}

function buildingType(point: CompleteCezRuianAddressPoint) {
  const normalized = normalizePowerOutageText(point.buildingType)
  if (normalized === 'c p') return 'house' as const
  if (normalized === 'c ev') return 'evidence' as const
  return 'unknown' as const
}

function targetBase(address: StagedAddress) {
  const { numbers, orientationNumbers } = sourceNumbers(address)
  const baseMetadata = {
    normalizerVersion: NORMALIZATION_VERSION,
    source: 'complete_cez_staging',
    sourceNumberCount: numbers.size,
    ignoredUnpairedOrientationNumberCount: address.street.trim() ? 0 : orientationNumbers.length,
    truncated: numbers.size > MAX_TARGETS_PER_ADDRESS,
  }
  return { numbers, baseMetadata }
}

function broadTarget(
  address: StagedAddress,
  input: {
    kind: 'street' | 'municipality'
    status: 'fallback' | 'needs_review'
    reason: string
    sourceUrl: string | null
    sourceValidOn: string | null
    streetExists: boolean
    baseMetadata: Record<string, unknown>
  },
) {
  const street = input.kind === 'street' ? address.street : ''
  return {
    staged_address_id: address.id,
    target_key: powerOutageSha256([
      'ruian-v1',
      input.kind,
      address.municipality_code,
      normalizePowerOutageText(address.town_part),
      normalizePowerOutageText(street),
    ]),
    target_kind: input.kind,
    municipality: address.municipality,
    town_part: address.town_part,
    street,
    number_token: null,
    query_text: queryText([street, address.town_part, address.municipality]),
    validation_version: 1,
    validation_status: input.status,
    ruian_address_code: null,
    ruian_building_type: null,
    verified_house_number: null,
    verified_orientation_number: null,
    postal_code: null,
    ruian_sjtsk_y: null,
    ruian_sjtsk_x: null,
    validation_detail: {
      reason: input.reason,
      sourceUrl: input.sourceUrl,
      sourceValidOn: input.sourceValidOn,
      streetExists: input.streetExists,
    },
    metadata: {
      ...input.baseMetadata,
      ruianValidated: false,
      validationStatus: input.status,
      validationReason: input.reason,
    },
  }
}

function targetsForAddress(
  address: StagedAddress,
  ruian: {
    sourceUrl: string
    sourceValidOn: string
    points: CompleteCezRuianAddressPoint[]
  },
) {
  const { numbers, baseMetadata } = targetBase(address)
  const sourceEntries = [...numbers.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'cs', { numeric: true }))
    .slice(0, MAX_TARGETS_PER_ADDRESS)
  const streetMatches = address.street.trim()
    ? ruian.points.filter((point) => sameText(point.street, address.street))
    : []
  const townPartMatches = address.town_part?.trim()
    ? ruian.points.filter((point) => sameText(point.townPart, address.town_part))
    : []
  let candidatePoints = address.street.trim() ? streetMatches : townPartMatches
  if (address.street.trim() && address.town_part?.trim()) {
    const exactPart = streetMatches.filter((point) => sameText(point.townPart, address.town_part))
    candidatePoints = exactPart
  }
  if (candidatePoints.length === 0 && !address.street.trim() && !address.town_part?.trim()) {
    candidatePoints = ruian.points
  }

  const matched = new Map<string, {
    point: CompleteCezRuianAddressPoint
    matchedNumbers: Set<string>
    matchedTypes: Set<string>
  }>()
  for (const point of candidatePoints) {
    const pointHouseNumber = normalizeBuildingNumber(point.houseNumber)
    const pointOrientationNumber = normalizeBuildingNumber(point.orientationNumber)
      const pointBuildingType = buildingType(point)
    for (const [number, kinds] of sourceEntries) {
      const houseMatch = pointHouseNumber === number && (
        (kinds.has('house') && pointBuildingType === 'house')
        || (kinds.has('evidence') && pointBuildingType === 'evidence')
      )
      const orientationMatch = kinds.has('orientation') && pointOrientationNumber === number
      if (!houseMatch && !orientationMatch) continue
      const item = matched.get(point.addressCode) ?? {
        point,
        matchedNumbers: new Set<string>(),
        matchedTypes: new Set<string>(),
      }
      item.matchedNumbers.add(number)
      if (houseMatch) item.matchedTypes.add(pointBuildingType)
      if (orientationMatch) item.matchedTypes.add('orientation')
      matched.set(point.addressCode, item)
    }
  }

  if (matched.size > 0) {
    return [...matched.values()]
      .sort((left, right) => Number(left.point.addressCode) - Number(right.point.addressCode))
      .slice(0, MAX_TARGETS_PER_ADDRESS)
      .map(({ point, matchedNumbers, matchedTypes }) => {
        const houseNumber = normalizeBuildingNumber(point.houseNumber)
        const orientationNumber = normalizeBuildingNumber(point.orientationNumber)
        const displayNumber = displayBuildingNumber({ houseNumber, orientationNumber })
        return ({
      staged_address_id: address.id,
      target_key: powerOutageSha256([
        'ruian-v1', address.municipality_code, point.addressCode,
      ]),
      target_kind: 'exact_number',
      municipality: point.municipalityName,
      town_part: point.townPart,
      street: point.street ?? '',
      number_token: displayNumber,
      query_text: queryText([
        point.street ? `${point.street} ${displayNumber}` : displayNumber,
        point.townPart,
        point.municipalityName,
      ]),
      validation_version: 1,
      validation_status: 'verified',
      ruian_address_code: point.addressCode,
      ruian_building_type: point.buildingType,
      verified_house_number: houseNumber,
      verified_orientation_number: orientationNumber,
      postal_code: point.postalCode,
      ruian_sjtsk_y: point.sjtskY,
      ruian_sjtsk_x: point.sjtskX,
      validation_detail: {
        sourceUrl: ruian.sourceUrl,
        sourceValidOn: ruian.sourceValidOn,
        matchedNumbers: [...matchedNumbers].sort(),
        matchedTypes: [...matchedTypes].sort(),
      },
      metadata: {
        ...baseMetadata,
        ruianValidated: true,
        validationStatus: 'verified',
        ruianAddressCode: point.addressCode,
        buildingNumberPairs: [{ houseNumber, orientationNumber }],
      },
    })
      })
  }

  if (address.street.trim()) {
    return [broadTarget(address, {
      kind: 'street',
      status: sourceEntries.length > 0 || streetMatches.length === 0
        ? 'needs_review'
        : 'fallback',
      reason: streetMatches.length === 0
        ? 'street_not_found_in_ruian'
        : sourceEntries.length > 0
          ? 'numbers_not_found_in_ruian'
          : 'source_contains_no_building_numbers',
      sourceUrl: ruian.sourceUrl,
      sourceValidOn: ruian.sourceValidOn,
      streetExists: streetMatches.length > 0,
      baseMetadata,
    })]
  }

  return [broadTarget(address, {
    kind: 'municipality',
    status: sourceEntries.length > 0 ? 'needs_review' : 'fallback',
    reason: sourceEntries.length > 0
      ? 'numbers_not_uniquely_resolved_without_street'
      : 'source_contains_no_street_or_building_numbers',
    sourceUrl: ruian.sourceUrl,
    sourceValidOn: ruian.sourceValidOn,
    streetExists: false,
    baseMetadata,
  })]
}

async function finishAddress(
  address: StagedAddress,
  values: Record<string, unknown>,
) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro normalizaci stagingu ČEZ.')
  const { data, error } = await client
    .from('complete_power_outage_cez_staged_addresses')
    .update({
      ...values,
      normalization_lock_token: null,
      normalization_lock_expires_at: null,
    })
    .eq('id', address.id)
    .eq('normalization_status', 'processing')
    .eq('normalization_lock_token', address.normalization_lock_token)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`Normalizační zámek adresy ${address.id} již není platný.`)
}

async function normalizeAddress(
  address: StagedAddress,
  ruian: Awaited<ReturnType<typeof loadCompleteCezRuianMunicipalityAddressPoints>>,
) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro normalizaci stagingu ČEZ.')
  const targets = targetsForAddress(address, ruian)
  const { data, error } = await client
    .from('complete_power_outage_cez_staged_address_targets')
    .select('id,target_key')
    .eq('staged_address_id', address.id)
  if (error) throw error
  const existing = (data ?? []) as ExistingTarget[]
  const desiredKeys = new Set(targets.map((target) => target.target_key))

  if (targets.length > 0) {
    const { error: upsertError } = await client
      .from('complete_power_outage_cez_staged_address_targets')
      .upsert(targets, { onConflict: 'staged_address_id,target_key' })
    if (upsertError) throw upsertError
  }

  const staleIds = existing
    .filter((target) => !desiredKeys.has(target.target_key))
    .map((target) => target.id)
  if (staleIds.length > 0) {
    const { error: deleteError } = await client
      .from('complete_power_outage_cez_staged_address_targets')
      .delete()
      .in('id', staleIds)
    if (deleteError) throw deleteError
  }

  await finishAddress(address, {
    normalization_version: NORMALIZATION_VERSION,
    normalization_status: 'succeeded',
    normalized_at: new Date().toISOString(),
    normalization_next_attempt_at: null,
    normalization_error_code: null,
    normalization_error_message: null,
  })
  return {
    targetCount: targets.length,
    exactTargetCount: targets.filter((target) => target.target_kind === 'exact_number').length,
    broadTargetCount: targets.filter((target) => target.target_kind !== 'exact_number').length,
    verifiedTargetCount: targets.filter((target) => target.validation_status === 'verified').length,
    reviewTargetCount: targets.filter((target) => target.validation_status === 'needs_review').length,
    removedTargetCount: staleIds.length,
  }
}

export async function normalizeCompleteCezStagedAddresses(requestedLimit = 100) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro normalizaci stagingu ČEZ.')
  const limit = Math.min(
    MAX_VALIDATION_BATCH_SIZE,
    Math.max(1, Math.trunc(requestedLimit)),
  )
  const { data, error } = await client.rpc(
    'claim_complete_power_outage_cez_staged_address_batch',
    { requested_limit: limit },
  )
  if (error) throw error
  const claimed = (data ?? []) as StagedAddress[]

  let succeededCount = 0
  let errorCount = 0
  let targetCount = 0
  let exactTargetCount = 0
  let broadTargetCount = 0
  let verifiedTargetCount = 0
  let reviewTargetCount = 0
  let removedTargetCount = 0
  let externalRequestsMade = 0
  const ruianByMunicipality = new Map<string, Promise<Awaited<ReturnType<
    typeof loadCompleteCezRuianMunicipalityAddressPoints
  >>>>()
  for (const address of claimed) {
    try {
      if (!address.municipality_code || !/^\d{6}$/.test(address.municipality_code)) {
        throw new Error(`Stagingová adresa ${address.id} nemá platný kód obce RÚIAN.`)
      }
      let ruian = ruianByMunicipality.get(address.municipality_code)
      if (!ruian) {
        externalRequestsMade += 1
        ruian = loadCompleteCezRuianMunicipalityAddressPoints(address.municipality_code)
        ruianByMunicipality.set(address.municipality_code, ruian)
      }
      const result = await normalizeAddress(address, await ruian)
      succeededCount += 1
      targetCount += result.targetCount
      exactTargetCount += result.exactTargetCount
      broadTargetCount += result.broadTargetCount
      verifiedTargetCount += result.verifiedTargetCount
      reviewTargetCount += result.reviewTargetCount
      removedTargetCount += result.removedTargetCount
    } catch (normalizationError) {
      errorCount += 1
      const terminal = address.normalization_attempt_count >= 3
      const message = errorMessage(normalizationError).slice(0, 2_000)
      await finishAddress(address, {
        normalization_status: terminal ? 'needs_review' : 'error',
        normalization_next_attempt_at: terminal
          ? null
          : new Date(Date.now() + retryDelay(address.normalization_attempt_count)).toISOString(),
        normalization_error_code: terminal
          ? 'CEZ_STAGED_NORMALIZATION_RETRIES_EXHAUSTED'
          : 'CEZ_STAGED_NORMALIZATION_FAILED',
        normalization_error_message: message,
      }).catch(() => undefined)
    }
  }

  const { count: remainingCount, error: countError } = await client
    .from('complete_power_outage_cez_staged_addresses')
    .select('id', { count: 'exact', head: true })
    .lt('normalization_version', NORMALIZATION_VERSION)
    .in('normalization_status', ['pending', 'processing', 'error'])
  if (countError) throw countError

  return {
    status: errorCount > 0 ? 'partial' as const : 'succeeded' as const,
    processedAddressCount: claimed.length,
    succeededCount,
    errorCount,
    targetCount,
    exactTargetCount,
    broadTargetCount,
    verifiedTargetCount,
    reviewTargetCount,
    removedTargetCount,
    remainingCount: remainingCount ?? 0,
    externalRequestsMade,
  }
}
