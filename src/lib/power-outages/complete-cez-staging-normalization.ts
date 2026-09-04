import 'server-only'

import { normalizeBuildingNumber } from './complete-address-numbering'
import { normalizePowerOutageText, powerOutageSha256 } from './normalization'
import { getServiceRoleClient } from '@/lib/supabase/service'

type StagedAddress = {
  id: string
  outage_external_id: string
  municipality: string
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

const NORMALIZATION_VERSION = 2
const MAX_TARGETS_PER_ADDRESS = 2_000
const MAX_EXPANDED_RANGE_SIZE = 500

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

function targetsForAddress(address: StagedAddress) {
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
  const sortedNumbers = [...numbers.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'cs', { numeric: true }))
    .slice(0, MAX_TARGETS_PER_ADDRESS)
  const baseMetadata = {
    normalizerVersion: NORMALIZATION_VERSION,
    source: 'complete_cez_staging',
    sourceNumberCount: numbers.size,
    ignoredUnpairedOrientationNumberCount: address.street.trim() ? 0 : orientationNumbers.length,
    truncated: numbers.size > MAX_TARGETS_PER_ADDRESS,
  }

  if (sortedNumbers.length > 0) {
    return sortedNumbers.map(([number, kinds]) => ({
      staged_address_id: address.id,
      target_key: powerOutageSha256([
        normalizePowerOutageText(address.municipality),
        normalizePowerOutageText(address.town_part),
        normalizePowerOutageText(address.street),
        number,
      ]),
      target_kind: 'exact_number',
      municipality: address.municipality,
      town_part: address.town_part,
      street: address.street,
      number_token: number,
      query_text: queryText([
        address.street.trim() ? `${address.street.trim()} ${number}` : number,
        address.town_part,
        address.municipality,
      ]),
      metadata: {
        ...baseMetadata,
        numberTypes: [...kinds].sort(),
        houseNumber: kinds.has('house') || kinds.has('evidence') ? number : null,
        orientationNumber: kinds.has('orientation') ? number : null,
      },
    }))
  }

  if (address.street.trim()) {
    return [{
      staged_address_id: address.id,
      target_key: powerOutageSha256([
        normalizePowerOutageText(address.municipality),
        normalizePowerOutageText(address.town_part),
        normalizePowerOutageText(address.street),
      ]),
      target_kind: 'street',
      municipality: address.municipality,
      town_part: address.town_part,
      street: address.street,
      number_token: null,
      query_text: queryText([address.street, address.town_part, address.municipality]),
      metadata: baseMetadata,
    }]
  }

  return [{
    staged_address_id: address.id,
    target_key: powerOutageSha256([
      normalizePowerOutageText(address.municipality),
      normalizePowerOutageText(address.town_part),
    ]),
    target_kind: 'municipality',
    municipality: address.municipality,
    town_part: address.town_part,
    street: '',
    number_token: null,
    query_text: queryText([address.town_part, address.municipality]),
    metadata: baseMetadata,
  }]
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

async function normalizeAddress(address: StagedAddress) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro normalizaci stagingu ČEZ.')
  const targets = targetsForAddress(address)
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
    removedTargetCount: staleIds.length,
  }
}

export async function normalizeCompleteCezStagedAddresses(requestedLimit = 100) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro normalizaci stagingu ČEZ.')
  const limit = Math.min(500, Math.max(1, Math.trunc(requestedLimit)))
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
  let removedTargetCount = 0
  for (const address of claimed) {
    try {
      const result = await normalizeAddress(address)
      succeededCount += 1
      targetCount += result.targetCount
      exactTargetCount += result.exactTargetCount
      broadTargetCount += result.broadTargetCount
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
    removedTargetCount,
    remainingCount: remainingCount ?? 0,
    externalRequestsMade: 0,
  }
}
