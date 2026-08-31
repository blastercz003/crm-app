import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { normalizeEgdOutage, type NormalizedEgdOutage } from './egd-normalizer'
import { loadEgdOutagesWithCityFallback } from './egd-source'
import { powerOutageSha256 } from './normalization'
import { storePowerOutageSourceSnapshot } from './source-snapshots'
import { powerOutageErrorMessage } from './error-message'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type SourceState = {
  consecutive_failure_count: number | null
  data_version: number | null
  latest_payload_sha256: string | null
}

export class EgdSyncAlreadyRunningError extends Error {
  constructor() {
    super('Předchozí synchronizace odstávek EG.D stále probíhá.')
    this.name = 'EgdSyncAlreadyRunningError'
  }
}

function errorMessage(error: unknown) {
  return powerOutageErrorMessage(
    error,
    'Neznámá chyba synchronizace odstávek EG.D.',
  )
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function outageRow(outage: NormalizedEgdOutage, observedAt: string) {
  return {
    source: outage.source,
    external_id: outage.externalId,
    source_status: outage.sourceStatus,
    title: outage.title,
    description: outage.description,
    starts_at: outage.startsAt,
    ends_at: outage.endsAt,
    archive_at: outage.archiveAt,
    municipality: outage.municipality,
    municipality_code: outage.municipalityCode,
    district: outage.district,
    region: outage.region,
    source_url: outage.sourceUrl,
    announcement_url: outage.announcementUrl,
    payload_sha256: outage.payloadSha256,
    source_updated_at: outage.sourceUpdatedAt,
    last_seen_at: observedAt,
    missing_since: null,
    metadata: outage.metadata,
  }
}

async function upsertEgdOutages(
  client: ServiceClient,
  outages: NormalizedEgdOutage[],
  observedAt: string,
) {
  const outageIdByExternal = new Map<string, string>()

  for (const batch of chunks(outages, 100)) {
    const { data, error } = await client
      .from('power_outages')
      .upsert(
        batch.map((outage) => outageRow(outage, observedAt)),
        { onConflict: 'source,external_id' },
      )
      .select('id,external_id')
    if (error) throw error
    for (const row of data ?? []) {
      outageIdByExternal.set(String(row.external_id), String(row.id))
    }
  }

  const addressRows: Array<Record<string, unknown>> = []
  const desiredAddressKeys = new Set<string>()
  for (const outage of outages) {
    const outageId = outageIdByExternal.get(outage.externalId)
    if (!outageId) {
      throw new Error(`Po uložení odstávky EG.D ${outage.externalId} chybí její ID.`)
    }
    for (const address of outage.addresses) {
      desiredAddressKeys.add(`${outageId}:${address.addressKey}`)
      addressRows.push({
        outage_id: outageId,
        external_address_id: address.externalAddressId,
        address_key: address.addressKey,
        municipality: address.municipality,
        municipality_code: address.municipalityCode,
        town_part: address.townPart,
        street: address.street,
        house_number: address.houseNumber,
        orientation_number: address.orientationNumber,
        postal_code: address.postalCode,
        raw_address: address.rawAddress,
        normalized_municipality: address.normalizedMunicipality,
        normalized_street: address.normalizedStreet,
        latitude: address.latitude,
        longitude: address.longitude,
        metadata: address.metadata,
      })
    }
  }

  for (const batch of chunks(addressRows, 400)) {
    const { error } = await client
      .from('power_outage_addresses')
      .upsert(batch, { onConflict: 'outage_id,address_key' })
    if (error) throw error
  }

  const staleAddressIds: string[] = []
  for (const outageIds of chunks([...outageIdByExternal.values()], 100)) {
    const { data, error } = await client
      .from('power_outage_addresses')
      .select('id,outage_id,address_key')
      .in('outage_id', outageIds)
    if (error) throw error
    for (const row of data ?? []) {
      if (!desiredAddressKeys.has(`${row.outage_id}:${row.address_key}`)) {
        staleAddressIds.push(String(row.id))
      }
    }
  }
  for (const ids of chunks(staleAddressIds, 400)) {
    const { error } = await client
      .from('power_outage_addresses')
      .delete()
      .in('id', ids)
    if (error) throw error
  }

  return {
    outageCount: outages.length,
    addressCount: addressRows.length,
    externalIds: new Set(outages.map((outage) => outage.externalId)),
  }
}

async function markMissingEgdOutages(
  client: ServiceClient,
  externalIds: Set<string>,
  missingAt: string,
) {
  const { data, error } = await client
    .from('power_outages')
    .select('id,external_id,missing_since')
    .eq('source', 'egd')
  if (error) throw error

  const missingIds = (data ?? [])
    .filter((row) => !externalIds.has(String(row.external_id)) && !row.missing_since)
    .map((row) => String(row.id))
  for (const ids of chunks(missingIds, 400)) {
    const { error: updateError } = await client
      .from('power_outages')
      .update({ missing_since: missingAt })
      .in('id', ids)
    if (updateError) throw updateError
  }
  return missingIds.length
}

async function countEgdOutages(client: ServiceClient, now: string) {
  const [{ count: active, error: activeError }, { count: future, error: futureError }] = await Promise.all([
    client
      .from('power_outages')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'egd')
      .is('missing_since', null)
      .lte('starts_at', now)
      .gte('ends_at', now)
      .neq('source_status', 'cancelled'),
    client
      .from('power_outages')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'egd')
      .is('missing_since', null)
      .gt('starts_at', now)
      .neq('source_status', 'cancelled'),
  ])
  if (activeError) throw activeError
  if (futureError) throw futureError
  return { active: active ?? 0, future: future ?? 0 }
}

export async function importEgdOutages(input: {
  daysAhead?: number
  fallbackCities?: string[]
  triggerKind?: 'scheduled' | 'manual' | 'store_change' | 'retry'
} = {}) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení Supabase pro import EG.D.')

  const startedAt = new Date().toISOString()
  const staleBefore = new Date(Date.now() - 15 * 60 * 1_000).toISOString()
  await client
    .from('power_outage_sync_runs')
    .update({
      status: 'failed',
      finished_at: startedAt,
      error_code: 'EGD_SYNC_STALE',
      error_message: 'Synchronizace EG.D překročila bezpečnostní limit 15 minut.',
    })
    .eq('source', 'egd')
    .eq('status', 'running')
    .lt('started_at', staleBefore)

  const [{ data: sourceState, error: stateError }, { data: catalogState, error: catalogError }] = await Promise.all([
    client
      .from('power_outage_source_state')
      .select('consecutive_failure_count,data_version,latest_payload_sha256')
      .eq('source', 'egd')
      .maybeSingle<SourceState>(),
    client
      .from('power_outage_store_catalog_state')
      .select('revision')
      .eq('singleton', true)
      .single<{ revision: number }>(),
  ])
  if (stateError) throw stateError
  if (catalogError) throw catalogError

  const { data: run, error: runError } = await client
    .from('power_outage_sync_runs')
    .insert({
      source: 'egd',
      trigger_kind: input.triggerKind ?? 'scheduled',
      status: 'running',
      store_revision: catalogState.revision,
    })
    .select('id')
    .single<{ id: string }>()
  if (runError?.code === '23505') throw new EgdSyncAlreadyRunningError()
  if (runError) throw runError

  try {
    const loaded = await loadEgdOutagesWithCityFallback({
      daysAhead: input.daysAhead ?? 90,
      cities: input.fallbackCities ?? [],
    })
    const normalized = loaded.outages.flatMap((outage) => normalizeEgdOutage(outage))
    const payloadSha256 = powerOutageSha256(
      normalized.map((outage) => outage.payloadSha256).sort(),
    )
    const completedAt = new Date().toISOString()
    await storePowerOutageSourceSnapshot({
      client,
      source: 'egd',
      payloadSha256,
      payload: loaded.outages,
      recordCount: loaded.outages.length,
      observedAt: completedAt,
      metadata: {
        queryScope: loaded.queryScope,
        dateFrom: loaded.dateFrom,
        dateTo: loaded.dateTo,
      },
    })
    const saved = await upsertEgdOutages(client, normalized, completedAt)
    const missingCount = await markMissingEgdOutages(
      client,
      saved.externalIds,
      completedAt,
    )
    const counts = await countEgdOutages(client, completedAt)
    const changed = sourceState?.latest_payload_sha256 !== payloadSha256

    const { error: sourceUpdateError } = await client
      .from('power_outage_source_state')
      .update({
        last_attempt_at: completedAt,
        last_success_at: completedAt,
        ...(changed ? { last_change_at: completedAt } : {}),
        latest_source_ref: 'egd-public-map-v1',
        latest_payload_sha256: payloadSha256,
        active_outage_count: counts.active,
        future_outage_count: counts.future,
        consecutive_failure_count: 0,
        last_error_at: null,
        last_error_code: null,
        last_error_message: null,
        data_version: (sourceState?.data_version ?? 0) + (changed ? 1 : 0),
        store_revision_processed: catalogState.revision,
        metadata: {
          queryScope: loaded.queryScope,
          dateFrom: loaded.dateFrom,
          dateTo: loaded.dateTo,
          sourceOutageCount: loaded.outages.length,
          normalizedTermCount: normalized.length,
          missingCount,
          fallbackReason: loaded.fallbackReason ?? null,
        },
      })
      .eq('source', 'egd')
    if (sourceUpdateError) throw sourceUpdateError

    const { error: finishError } = await client
      .from('power_outage_sync_runs')
      .update({
        status: changed ? 'succeeded' : 'no_change',
        finished_at: completedAt,
        source_record_count: loaded.outages.length,
        outage_upsert_count: saved.outageCount,
        address_upsert_count: saved.addressCount,
        payload_sha256: payloadSha256,
        metadata: {
          queryScope: loaded.queryScope,
          dateFrom: loaded.dateFrom,
          dateTo: loaded.dateTo,
          normalizedTermCount: normalized.length,
          missingCount,
          fallbackReason: loaded.fallbackReason ?? null,
        },
      })
      .eq('id', run.id)
    if (finishError) throw finishError

    return {
      status: changed ? 'succeeded' as const : 'no_change' as const,
      syncRunId: run.id,
      sourceOutageCount: loaded.outages.length,
      savedOutageCount: saved.outageCount,
      savedAddressCount: saved.addressCount,
      missingCount,
      payloadSha256,
      dateFrom: loaded.dateFrom,
      dateTo: loaded.dateTo,
    }
  } catch (error) {
    const failedAt = new Date().toISOString()
    await Promise.all([
      client
        .from('power_outage_sync_runs')
        .update({
          status: 'failed',
          finished_at: failedAt,
          error_code: 'EGD_SYNC_FAILED',
          error_message: errorMessage(error).slice(0, 2_000),
        })
        .eq('id', run.id),
      client
        .from('power_outage_source_state')
        .update({
          last_attempt_at: failedAt,
          last_error_at: failedAt,
          last_error_code: 'EGD_SYNC_FAILED',
          last_error_message: errorMessage(error).slice(0, 2_000),
          consecutive_failure_count: (sourceState?.consecutive_failure_count ?? 0) + 1,
        })
        .eq('source', 'egd'),
    ])
    throw error
  }
}
