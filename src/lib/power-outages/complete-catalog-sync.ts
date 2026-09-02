import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { powerOutageErrorMessage } from './error-message'
import { powerOutageSha256 } from './normalization'
import {
  claimCompletePowerOutageTask,
  finishCompletePowerOutageTask,
  type CompletePowerOutageTaskKey,
} from './complete-task-lock'
import type { PowerOutageSource } from './types'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type SourceOutageRow = {
  id: string
  source: PowerOutageSource
  external_id: string
  source_status: 'scheduled' | 'active' | 'completed' | 'cancelled'
  title: string | null
  description: string | null
  starts_at: string
  ends_at: string
  archive_at: string
  municipality: string | null
  municipality_code: string | null
  district: string | null
  region: string | null
  source_url: string | null
  announcement_url: string | null
  payload_sha256: string
  source_updated_at: string | null
  first_seen_at: string
  last_seen_at: string
  missing_since: string | null
  metadata: Record<string, unknown> | null
}

type SourceAddressRow = {
  id: string
  outage_id: string
  external_address_id: string | null
  address_key: string
  municipality: string
  municipality_code: string | null
  town_part: string | null
  street: string
  house_number: string | null
  orientation_number: string | null
  postal_code: string | null
  raw_address: string
  normalized_municipality: string
  normalized_street: string
  latitude: number | null
  longitude: number | null
  metadata: Record<string, unknown> | null
}

type CompleteAddressState = {
  id: string
  address_key: string
  lookup_fingerprint: string | null
}

const PAGE_SIZE = 500

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function taskKey(source: PowerOutageSource): CompletePowerOutageTaskKey {
  return source === 'cez' ? 'sync_cez' : source === 'egd' ? 'sync_egd' : 'sync_pre'
}

function addressScope(address: SourceAddressRow) {
  const metadata = address.metadata ?? {}
  const numbers = [
    address.house_number,
    address.orientation_number,
    ...(Array.isArray(metadata.houseNumbers) ? metadata.houseNumbers : []),
    ...(Array.isArray(metadata.orientationNumbers) ? metadata.orientationNumbers : []),
    ...(Array.isArray(metadata.evidenceNumbers) ? metadata.evidenceNumbers : []),
  ].filter((value) => String(value ?? '').trim())

  if (numbers.length > 0) return 'exact'
  if (address.normalized_street.trim()) return 'street'
  if (address.normalized_municipality.trim()) return 'municipality'
  return 'unresolved'
}

function addressFingerprint(address: SourceAddressRow) {
  return powerOutageSha256({
    externalAddressId: address.external_address_id,
    municipality: address.municipality,
    municipalityCode: address.municipality_code,
    townPart: address.town_part,
    street: address.street,
    houseNumber: address.house_number,
    orientationNumber: address.orientation_number,
    postalCode: address.postal_code,
    normalizedMunicipality: address.normalized_municipality,
    normalizedStreet: address.normalized_street,
    latitude: address.latitude,
    longitude: address.longitude,
    metadata: address.metadata ?? {},
  })
}

async function loadSourceOutages(client: ServiceClient, source: PowerOutageSource) {
  const rows: SourceOutageRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('power_outages')
      .select(`
        id,source,external_id,source_status,title,description,starts_at,ends_at,
        archive_at,municipality,municipality_code,district,region,source_url,
        announcement_url,payload_sha256,source_updated_at,first_seen_at,last_seen_at,
        missing_since,metadata
      `)
      .eq('source', source)
      .order('id')
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw error
    rows.push(...((data ?? []) as SourceOutageRow[]))
    if ((data?.length ?? 0) < PAGE_SIZE) break
  }
  return rows
}

async function loadSourceAddresses(client: ServiceClient, outageIds: string[]) {
  const rows: SourceAddressRow[] = []
  for (const ids of chunks(outageIds, 100)) {
    const { data, error } = await client
      .from('power_outage_addresses')
      .select(`
        id,outage_id,external_address_id,address_key,municipality,municipality_code,
        town_part,street,house_number,orientation_number,postal_code,raw_address,
        normalized_municipality,normalized_street,latitude,longitude,metadata
      `)
      .in('outage_id', ids)
    if (error) throw error
    rows.push(...((data ?? []) as SourceAddressRow[]))
  }
  return rows
}

async function updateSourceState(input: {
  client: ServiceClient
  source: PowerOutageSource
  completedAt: string
  outages: SourceOutageRow[]
  addressCount: number
  changed: boolean
}) {
  const active = input.outages.filter((row) => (
    row.missing_since === null
    && row.source_status !== 'cancelled'
    && row.starts_at <= input.completedAt
    && row.ends_at >= input.completedAt
  )).length
  const future = input.outages.filter((row) => (
    row.missing_since === null
    && row.source_status !== 'cancelled'
    && row.starts_at > input.completedAt
  )).length
  const terms = input.outages.flatMap((row) => [row.starts_at, row.ends_at]).sort()
  const payloadSha256 = powerOutageSha256(
    input.outages.map((row) => `${row.external_id}:${row.payload_sha256}`).sort(),
  )

  const { error } = await input.client
    .from('complete_power_outage_source_state')
    .update({
      // EG.D a PRE poskytují celoplošný export. ČEZ je v této fázi pouze
      // bezpečná projekce již objevených obcí a nesmí se tvářit jako úplné pokrytí.
      coverage_status: input.source === 'cez' ? 'partial' : 'complete',
      last_attempt_at: input.completedAt,
      last_success_at: input.completedAt,
      last_complete_at: input.completedAt,
      ...(input.changed ? { last_change_at: input.completedAt } : {}),
      horizon_from: terms[0] ?? null,
      horizon_to: terms.at(-1) ?? null,
      latest_source_ref: 'market-source-catalog-projection-v1',
      latest_payload_sha256: payloadSha256,
      published_outage_count: input.outages.length,
      published_address_count: input.addressCount,
      active_outage_count: active,
      future_outage_count: future,
      coverage_total_count: input.outages.length,
      coverage_processed_count: input.outages.length,
      consecutive_failure_count: 0,
      last_error_at: null,
      last_error_code: null,
      last_error_message: null,
      lock_token: null,
      lock_expires_at: null,
      metadata: {
        projectionContract: 'market-source-catalog-projection-v1',
        externalRequestsMade: 0,
        sourceScope: input.source === 'cez'
          ? 'currently-discovered-cez-municipalities'
          : 'whole-distributor-feed',
      },
    })
    .eq('source', input.source)
  if (error) throw error
}

export async function syncCompletePowerOutageCatalogSource(source: PowerOutageSource) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro katalog kompletních odstávek.')

  const startedAt = new Date().toISOString()
  const lockTaskKey = taskKey(source)
  const lockToken = await claimCompletePowerOutageTask(lockTaskKey, 30 * 60)
  if (!lockToken) return { source, status: 'skipped' as const, reason: 'already_running' as const }

  const staleBefore = new Date(Date.now() - 30 * 60_000).toISOString()
  const { error: staleRunError } = await client
    .from('complete_power_outage_runs')
    .update({
      status: 'failed',
      finished_at: startedAt,
      error_count: 1,
      error_code: 'COMPLETE_SOURCE_SYNC_STALE',
      error_message: 'Předchozí projekce zdrojového katalogu překročila bezpečnostní limit 30 minut.',
    })
    .eq('run_kind', 'source_sync')
    .eq('source', source)
    .eq('status', 'running')
    .lt('started_at', staleBefore)
  if (staleRunError) {
    await finishCompletePowerOutageTask({
      taskKey: lockTaskKey,
      lockToken,
      status: 'failed',
      errorCode: 'COMPLETE_STALE_RUN_CLEANUP_FAILED',
      errorMessage: staleRunError.message,
    }).catch(() => undefined)
    throw staleRunError
  }

  const { data: run, error: runError } = await client
    .from('complete_power_outage_runs')
    .insert({
      run_kind: 'source_sync',
      source,
      trigger_kind: 'upstream_snapshot',
      status: 'running',
      metadata: { externalRequestsMade: 0 },
    })
    .select('id')
    .single<{ id: string }>()
  if (runError) {
    await finishCompletePowerOutageTask({
      taskKey: lockTaskKey,
      lockToken,
      status: 'failed',
      errorCode: 'COMPLETE_RUN_CREATE_FAILED',
      errorMessage: runError.message,
    }).catch(() => undefined)
    throw runError
  }

  try {
    const outages = await loadSourceOutages(client, source)
    const sourceAddresses = await loadSourceAddresses(client, outages.map((row) => row.id))
    const sourceAddressByOutageId = new Map<string, SourceAddressRow[]>()
    for (const address of sourceAddresses) {
      const group = sourceAddressByOutageId.get(address.outage_id) ?? []
      group.push(address)
      sourceAddressByOutageId.set(address.outage_id, group)
    }

    const completeIdByExternalId = new Map<string, string>()
    let changedOutageCount = 0
    for (const batch of chunks(outages, 100)) {
      const { data: existing, error: existingError } = await client
        .from('complete_power_outages')
        .select('id,external_id,payload_sha256,source_status,missing_since')
        .eq('source', source)
        .in('external_id', batch.map((row) => row.external_id))
      if (existingError) throw existingError
      const existingByExternalId = new Map(
        (existing ?? []).map((row) => [String(row.external_id), row]),
      )
      for (const row of existing ?? []) {
        completeIdByExternalId.set(String(row.external_id), String(row.id))
      }
      const changedBatch = batch.filter((row) => {
        const current = existingByExternalId.get(row.external_id)
        return !current
          || String(current.payload_sha256) !== row.payload_sha256
          || String(current.source_status) !== row.source_status
          || (current.missing_since ?? null) !== row.missing_since
      })
      changedOutageCount += changedBatch.length
      if (changedBatch.length === 0) continue

      const { data: saved, error } = await client
        .from('complete_power_outages')
        .upsert(changedBatch.map((row) => ({
          source: row.source,
          external_id: row.external_id,
          source_status: row.source_status,
          title: row.title,
          description: row.description,
          reason: typeof row.metadata?.reason === 'string' ? row.metadata.reason : null,
          contractor: typeof row.metadata?.contractor === 'string' ? row.metadata.contractor : null,
          starts_at: row.starts_at,
          ends_at: row.ends_at,
          archive_at: row.ends_at,
          municipality: row.municipality,
          municipality_code: row.municipality_code,
          district: row.district,
          region: row.region,
          source_url: row.source_url,
          announcement_url: row.announcement_url,
          payload_sha256: row.payload_sha256,
          source_updated_at: row.source_updated_at,
          first_seen_at: row.first_seen_at,
          last_seen_at: row.last_seen_at,
          missing_since: row.missing_since,
          metadata: {
            ...(row.metadata ?? {}),
            upstreamCatalog: 'power_outages',
            upstreamOutageId: row.id,
          },
        })), { onConflict: 'source,external_id' })
        .select('id,external_id')
      if (error) throw error
      for (const row of saved ?? []) {
        completeIdByExternalId.set(String(row.external_id), String(row.id))
      }
    }

    let changedAddressCount = 0
    let removedAddressCount = 0
    for (const outage of outages) {
      const completeOutageId = completeIdByExternalId.get(outage.external_id)
      if (!completeOutageId) throw new Error(`Kompletní odstávka ${source}:${outage.external_id} nemá ID.`)
      const desired = sourceAddressByOutageId.get(outage.id) ?? []
      const { data: existing, error: existingError } = await client
        .from('complete_power_outage_addresses')
        .select('id,address_key,lookup_fingerprint')
        .eq('outage_id', completeOutageId)
      if (existingError) throw existingError
      const existingByKey = new Map(
        ((existing ?? []) as CompleteAddressState[]).map((row) => [row.address_key, row]),
      )

      const changedRows: Array<Record<string, unknown>> = []
      for (const address of desired) {
        const fingerprint = addressFingerprint(address)
        const base = {
          outage_id: completeOutageId,
          external_address_id: address.external_address_id,
          address_key: address.address_key,
          address_scope: addressScope(address),
          municipality: address.municipality,
          municipality_code: address.municipality_code,
          town_part: address.town_part,
          street: address.street,
          house_number: address.house_number,
          orientation_number: address.orientation_number,
          postal_code: address.postal_code,
          raw_address: address.raw_address,
          normalized_municipality: address.normalized_municipality,
          normalized_street: address.normalized_street,
          latitude: address.latitude,
          longitude: address.longitude,
          lookup_fingerprint: fingerprint,
          metadata: {
            ...(address.metadata ?? {}),
            upstreamAddressId: address.id,
          },
        }
        if (existingByKey.get(address.address_key)?.lookup_fingerprint !== fingerprint) {
          changedAddressCount += 1
          changedRows.push({
            ...base,
            lookup_status: 'pending',
            lookup_attempt_count: 0,
            lookup_next_attempt_at: null,
            lookup_started_at: null,
            lookup_finished_at: null,
            lookup_error_code: null,
            lookup_error_message: null,
            processing_token: null,
            processing_expires_at: null,
          })
        }
      }
      for (const batch of chunks(changedRows, 300)) {
        const { error } = await client
          .from('complete_power_outage_addresses')
          .upsert(batch, { onConflict: 'outage_id,address_key' })
        if (error) throw error
      }

      const desiredKeys = new Set(desired.map((address) => address.address_key))
      const staleIds = [...existingByKey.values()]
        .filter((row) => !desiredKeys.has(row.address_key))
        .map((row) => row.id)
      removedAddressCount += staleIds.length
      for (const ids of chunks(staleIds, 300)) {
        const { error } = await client.from('complete_power_outage_addresses').delete().in('id', ids)
        if (error) throw error
      }
    }

    const completedAt = new Date().toISOString()
    const changed = changedOutageCount > 0 || changedAddressCount > 0 || removedAddressCount > 0
    await updateSourceState({
      client,
      source,
      completedAt,
      outages,
      addressCount: sourceAddresses.length,
      changed,
    })
    const { error: finishRunError } = await client
      .from('complete_power_outage_runs')
      .update({
        status: changed ? 'succeeded' : 'no_change',
        finished_at: completedAt,
        source_record_count: outages.length,
        outage_upsert_count: changedOutageCount,
        address_upsert_count: changedAddressCount,
        metadata: { externalRequestsMade: 0, removedAddressCount },
      })
      .eq('id', run.id)
    if (finishRunError) throw finishRunError
    await finishCompletePowerOutageTask({
      taskKey: lockTaskKey,
      lockToken,
      status: 'succeeded',
      processedCount: outages.length,
      cursor: { completedAt, lastExternalId: outages.at(-1)?.external_id ?? null },
    })
    return {
      source,
      status: changed ? 'succeeded' as const : 'no_change' as const,
      outageCount: outages.length,
      addressCount: sourceAddresses.length,
      changedOutageCount,
      changedAddressCount,
      removedAddressCount,
      externalRequestsMade: 0,
      startedAt,
      finishedAt: completedAt,
    }
  } catch (error) {
    const failedAt = new Date().toISOString()
    const message = powerOutageErrorMessage(error, `Aktualizace kompletního katalogu ${source.toUpperCase()} selhala.`)
    await Promise.allSettled([
      client.from('complete_power_outage_runs').update({
        status: 'failed', finished_at: failedAt, error_count: 1,
        error_code: 'COMPLETE_SOURCE_SYNC_FAILED', error_message: message.slice(0, 2_000),
      }).eq('id', run.id),
      client.from('complete_power_outage_source_state').update({
        coverage_status: 'error', last_attempt_at: failedAt, last_error_at: failedAt,
        last_error_code: 'COMPLETE_SOURCE_SYNC_FAILED', last_error_message: message.slice(0, 2_000),
      }).eq('source', source),
      finishCompletePowerOutageTask({
        taskKey: lockTaskKey, lockToken, status: 'failed',
        errorCode: 'COMPLETE_SOURCE_SYNC_FAILED', errorMessage: message,
      }),
    ])
    throw error
  }
}

export async function syncCompletePowerOutageCatalog(source: PowerOutageSource | 'all' = 'all') {
  const sources: PowerOutageSource[] = source === 'all' ? ['cez', 'egd', 'pre'] : [source]
  const results: Array<Awaited<ReturnType<typeof syncCompletePowerOutageCatalogSource>> | {
    source: PowerOutageSource
    status: 'failed'
    error: string
  }> = []
  for (const item of sources) {
    try {
      results.push(await syncCompletePowerOutageCatalogSource(item))
    } catch (error) {
      results.push({
        source: item,
        status: 'failed',
        error: powerOutageErrorMessage(error, `Aktualizace ${item.toUpperCase()} selhala.`),
      })
    }
  }
  const failedCount = results.filter((result) => result.status === 'failed').length
  return { ok: failedCount === 0, partial: failedCount > 0 && failedCount < results.length, results }
}
