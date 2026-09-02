import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { powerOutageErrorMessage } from './error-message'
import { normalizePowerOutageText, powerOutageSha256 } from './normalization'
import { claimCompletePowerOutageTask, finishCompletePowerOutageTask } from './complete-task-lock'
import {
  displayBuildingNumber,
  legacyNumberEvidenceCount,
  trustedBuildingNumberPairs,
} from './complete-address-numbering'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type AddressRow = {
  id: string
  address_scope: 'exact' | 'street' | 'municipality' | 'unresolved'
  municipality: string
  town_part: string | null
  street: string
  house_number: string | null
  orientation_number: string | null
  metadata: Record<string, unknown> | null
}

type TargetState = {
  id: string
  outage_address_id: string
  target_key: string
}

const NORMALIZER_VERSION = 2
const MAX_TARGETS_PER_ADDRESS = 2000
const MAX_TARGETS_PER_RUN = 20000

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function trustedNumbers(address: AddressRow) {
  return trustedBuildingNumberPairs({
    houseNumber: address.house_number,
    orientationNumber: address.orientation_number,
    metadata: address.metadata,
  })
    .map((pair) => ({ pair, display: displayBuildingNumber(pair) }))
    .filter((value) => value.display)
    .sort((left, right) => left.display.localeCompare(right.display, 'cs', { numeric: true }))
}

function queryText(parts: Array<string | null | undefined>) {
  return parts.map((part) => part?.trim()).filter(Boolean).join(', ').slice(0, 300)
}

function targetsForAddress(address: AddressRow) {
  const numbers = trustedNumbers(address)
  const limitedNumbers = numbers.slice(0, MAX_TARGETS_PER_ADDRESS)
  const legacyEvidenceCount = legacyNumberEvidenceCount(address.metadata)
  const baseMetadata = {
    normalizerVersion: NORMALIZER_VERSION,
    sourceNumberCount: numbers.length,
    legacyNumberEvidenceCount: legacyEvidenceCount,
    legacyNumberEvidenceIgnored: legacyEvidenceCount > 0 && numbers.length === 0,
    truncated: numbers.length > MAX_TARGETS_PER_ADDRESS,
  }

  if (address.street.trim() && limitedNumbers.length > 0) {
    return limitedNumbers.map(({ pair, display }) => {
      const query = queryText([
        `${address.street.trim()} ${display}`,
        address.town_part,
        address.municipality,
      ])
      return {
        outage_address_id: address.id,
        target_key: powerOutageSha256([
          normalizePowerOutageText(address.municipality),
          normalizePowerOutageText(address.town_part),
          normalizePowerOutageText(address.street),
          pair.houseNumber,
          pair.orientationNumber,
        ]),
        target_kind: 'exact_number',
        municipality: address.municipality,
        town_part: address.town_part,
        street: address.street,
        number_token: display,
        query_text: query,
        lookup_status: 'pending',
        lookup_priority: 10,
        metadata: {
          ...baseMetadata,
          houseNumber: pair.houseNumber,
          orientationNumber: pair.orientationNumber,
        },
      }
    })
  }

  if (address.street.trim()) {
    const query = queryText([address.street, address.town_part, address.municipality])
    return [{
      outage_address_id: address.id,
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
      query_text: query,
      lookup_status: 'pending',
      lookup_priority: 50,
      metadata: baseMetadata,
    }]
  }

  const municipality = address.municipality.trim()
  if (municipality) {
    return [{
      outage_address_id: address.id,
      target_key: powerOutageSha256([normalizePowerOutageText(municipality)]),
      target_kind: 'municipality',
      municipality,
      town_part: address.town_part,
      street: '',
      number_token: null,
      query_text: queryText([address.town_part, municipality]),
      lookup_status: 'needs_review',
      lookup_priority: 200,
      metadata: baseMetadata,
    }]
  }

  return []
}

function normalizedScope(address: AddressRow) {
  const numberCount = trustedNumbers(address).length
  if (address.street.trim() && numberCount > 0) return 'exact'
  if (address.street.trim()) return 'street'
  if (address.municipality.trim()) return 'municipality'
  return 'unresolved'
}

async function loadAddresses(client: ServiceClient, limit: number) {
  const { data, error } = await client
    .from('complete_power_outage_addresses')
    .select('id,address_scope,municipality,town_part,street,house_number,orientation_number,metadata')
    .lt('normalization_version', NORMALIZER_VERSION)
    .order('id')
    .limit(limit)
  if (error) throw error
  return (data ?? []) as AddressRow[]
}

export async function normalizeCompletePowerOutageAddresses(requestedLimit = 1500) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro normalizaci kompletních adres.')
  const limit = Math.min(2000, Math.max(1, Math.trunc(requestedLimit)))
  const lockToken = await claimCompletePowerOutageTask('normalize_addresses', 30 * 60)
  if (!lockToken) return { status: 'skipped' as const, reason: 'already_running' as const }

  const startedAt = new Date().toISOString()
  const staleBefore = new Date(Date.now() - 30 * 60_000).toISOString()
  const { error: staleRunError } = await client
    .from('complete_power_outage_runs')
    .update({
      status: 'failed',
      finished_at: startedAt,
      error_count: 1,
      error_code: 'COMPLETE_ADDRESS_NORMALIZATION_STALE',
      error_message: 'Předchozí normalizace adres překročila bezpečnostní limit 30 minut.',
    })
    .eq('run_kind', 'address_normalization')
    .eq('status', 'running')
    .lt('started_at', staleBefore)
  if (staleRunError) {
    await finishCompletePowerOutageTask({
      taskKey: 'normalize_addresses', lockToken, status: 'failed',
      errorCode: 'COMPLETE_ADDRESS_STALE_RUN_CLEANUP_FAILED', errorMessage: staleRunError.message,
    }).catch(() => undefined)
    throw staleRunError
  }

  const { data: run, error: runError } = await client
    .from('complete_power_outage_runs')
    .insert({ run_kind: 'address_normalization', trigger_kind: 'scheduled', status: 'running' })
    .select('id')
    .single<{ id: string }>()
  if (runError) {
    await finishCompletePowerOutageTask({
      taskKey: 'normalize_addresses', lockToken, status: 'failed',
      errorCode: 'COMPLETE_ADDRESS_RUN_CREATE_FAILED', errorMessage: runError.message,
    }).catch(() => undefined)
    throw runError
  }

  try {
    const candidates = await loadAddresses(client, limit)
    const plannedTargets = new Map<string, ReturnType<typeof targetsForAddress>>()
    const addresses: AddressRow[] = []
    let plannedTargetCount = 0
    for (const address of candidates) {
      const targets = targetsForAddress(address)
      if (addresses.length > 0 && plannedTargetCount + targets.length > MAX_TARGETS_PER_RUN) break
      addresses.push(address)
      plannedTargets.set(address.id, targets)
      plannedTargetCount += targets.length
    }
    const addressIds = addresses.map((address) => address.id)
    const existingTargets: TargetState[] = []
    for (const ids of chunks(addressIds, 100)) {
      const { data, error } = await client
        .from('complete_power_outage_address_targets')
        .select('id,outage_address_id,target_key')
        .in('outage_address_id', ids)
      if (error) throw error
      existingTargets.push(...((data ?? []) as TargetState[]))
    }
    const existingByAddress = new Map<string, Map<string, TargetState>>()
    for (const target of existingTargets) {
      const group = existingByAddress.get(target.outage_address_id) ?? new Map()
      group.set(target.target_key, target)
      existingByAddress.set(target.outage_address_id, group)
    }

    const newTargets: Array<Record<string, unknown>> = []
    const staleTargetIds: string[] = []
    let exactTargetCount = 0
    let broadTargetCount = 0
    let unresolvedAddressCount = 0
    for (const address of addresses) {
      const targets = plannedTargets.get(address.id) ?? []
      if (targets.length === 0) unresolvedAddressCount += 1
      exactTargetCount += targets.filter((target) => target.target_kind === 'exact_number').length
      broadTargetCount += targets.filter((target) => target.target_kind !== 'exact_number').length
      const existing = existingByAddress.get(address.id) ?? new Map()
      const desiredKeys = new Set(targets.map((target) => target.target_key))
      newTargets.push(...targets.filter((target) => !existing.has(target.target_key)))
      staleTargetIds.push(...[...existing.values()]
        .filter((target) => !desiredKeys.has(target.target_key))
        .map((target) => target.id))
    }

    for (const batch of chunks(newTargets, 400)) {
      const { error } = await client
        .from('complete_power_outage_address_targets')
        .upsert(batch, { onConflict: 'outage_address_id,target_key' })
      if (error) throw error
    }
    for (const ids of chunks(staleTargetIds, 400)) {
      const { error } = await client
        .from('complete_power_outage_address_targets')
        .delete()
        .in('id', ids)
      if (error) throw error
    }

    const normalizedAt = new Date().toISOString()
    for (const scope of ['exact', 'street', 'municipality', 'unresolved'] as const) {
      const idsForScope = addresses
        .filter((address) => normalizedScope(address) === scope)
        .map((address) => address.id)
      for (const ids of chunks(idsForScope, 400)) {
        const { error } = await client
          .from('complete_power_outage_addresses')
          .update({
            address_scope: scope,
            normalization_version: NORMALIZER_VERSION,
            normalized_at: normalizedAt,
          })
          .in('id', ids)
        if (error) throw error
      }
    }

    const { count: totalAddressCount, error: totalError } = await client
      .from('complete_power_outage_addresses')
      .select('id', { count: 'exact', head: true })
      .lt('normalization_version', NORMALIZER_VERSION)
    if (totalError) throw totalError
    const completedAt = new Date().toISOString()
    const remainingCount = totalAddressCount ?? 0
    const { error: runFinishError } = await client
      .from('complete_power_outage_runs')
      .update({
        status: 'succeeded',
        finished_at: completedAt,
        source_record_count: addresses.length,
        address_upsert_count: newTargets.length,
        metadata: {
          normalizerVersion: NORMALIZER_VERSION,
          exactTargetCount,
          broadTargetCount,
          unresolvedAddressCount,
          removedTargetCount: staleTargetIds.length,
          remainingCount,
          externalRequestsMade: 0,
        },
      })
      .eq('id', run.id)
    if (runFinishError) throw runFinishError
    await finishCompletePowerOutageTask({
      taskKey: 'normalize_addresses',
      lockToken,
      status: 'succeeded',
      processedCount: addresses.length,
      cursor: { completedAt, normalizerVersion: NORMALIZER_VERSION },
    })
    return {
      status: 'succeeded' as const,
      processedAddressCount: addresses.length,
      createdTargetCount: newTargets.length,
      removedTargetCount: staleTargetIds.length,
      exactTargetCount,
      broadTargetCount,
      unresolvedAddressCount,
      remainingCount,
      externalRequestsMade: 0,
      startedAt,
      finishedAt: completedAt,
    }
  } catch (error) {
    const failedAt = new Date().toISOString()
    const message = powerOutageErrorMessage(error, 'Normalizace kompletních adres selhala.')
    await Promise.allSettled([
      client.from('complete_power_outage_runs').update({
        status: 'failed', finished_at: failedAt, error_count: 1,
        error_code: 'COMPLETE_ADDRESS_NORMALIZATION_FAILED', error_message: message.slice(0, 2000),
      }).eq('id', run.id),
      finishCompletePowerOutageTask({
        taskKey: 'normalize_addresses', lockToken, status: 'failed',
        errorCode: 'COMPLETE_ADDRESS_NORMALIZATION_FAILED', errorMessage: message,
      }),
    ])
    throw error
  }
}
