import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { normalizePreOutage, type NormalizedPreOutage } from './pre-normalizer'
import { loadPreOutages } from './pre-source'
import { powerOutageSha256 } from './normalization'
import { storePowerOutageSourceSnapshot } from './source-snapshots'
import { powerOutageErrorMessage } from './error-message'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>
type SourceState = {
  consecutive_failure_count: number | null
  data_version: number | null
  latest_payload_sha256: string | null
}
type ExistingPreRow = {
  id: string
  external_id: string
  missing_since: string | null
  metadata: Record<string, unknown> | null
}

export class PreSyncAlreadyRunningError extends Error {
  constructor() {
    super('Předchozí synchronizace odstávek PRE stále probíhá.')
    this.name = 'PreSyncAlreadyRunningError'
  }
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

function errorMessage(error: unknown) {
  return powerOutageErrorMessage(error, 'Neznámá chyba synchronizace odstávek PRE.')
}

function outageRow(outage: NormalizedPreOutage, observedAt: string) {
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

async function upsertPreOutages(client: ServiceClient, outages: NormalizedPreOutage[], observedAt: string) {
  const outageIdByExternal = new Map<string, string>()
  for (const batch of chunks(outages, 100)) {
    const { data, error } = await client
      .from('power_outages')
      .upsert(batch.map((outage) => outageRow(outage, observedAt)), { onConflict: 'source,external_id' })
      .select('id,external_id')
    if (error) throw error
    for (const row of data ?? []) outageIdByExternal.set(String(row.external_id), String(row.id))
  }

  const addressRows: Array<Record<string, unknown>> = []
  const desiredAddressKeys = new Set<string>()
  for (const outage of outages) {
    const outageId = outageIdByExternal.get(outage.externalId)
    if (!outageId) throw new Error(`Po uložení odstávky PRE ${outage.externalId} chybí její ID.`)
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
    const { error } = await client.from('power_outage_addresses').upsert(batch, { onConflict: 'outage_id,address_key' })
    if (error) throw error
  }

  const staleAddressIds: string[] = []
  for (const ids of chunks([...outageIdByExternal.values()], 100)) {
    const { data, error } = await client.from('power_outage_addresses').select('id,outage_id,address_key').in('outage_id', ids)
    if (error) throw error
    for (const row of data ?? []) {
      if (!desiredAddressKeys.has(`${row.outage_id}:${row.address_key}`)) staleAddressIds.push(String(row.id))
    }
  }
  for (const ids of chunks(staleAddressIds, 400)) {
    const { error } = await client.from('power_outage_addresses').delete().in('id', ids)
    if (error) throw error
  }
  return {
    outageCount: outages.length,
    addressCount: addressRows.length,
    externalIds: new Set(outages.map((outage) => outage.externalId)),
  }
}

async function markMissingPreOutages(client: ServiceClient, externalIds: Set<string>, missingAt: string) {
  const { data, error } = await client
    .from('power_outages')
    .select('id,external_id,missing_since,metadata')
    .eq('source', 'pre')
    .is('archived_at', null)
  if (error) throw error

  let candidateCount = 0
  let missingCount = 0
  for (const row of (data ?? []) as ExistingPreRow[]) {
    if (externalIds.has(row.external_id) || row.missing_since) continue
    const metadata = row.metadata ?? {}
    const previousObservations = Number(metadata.preMissingObservations ?? 0)
    if (previousObservations >= 1) {
      const { error: updateError } = await client
        .from('power_outages')
        .update({ missing_since: missingAt, metadata: { ...metadata, preMissingObservations: previousObservations + 1 } })
        .eq('id', row.id)
      if (updateError) throw updateError
      missingCount += 1
    } else {
      const { error: updateError } = await client
        .from('power_outages')
        .update({ metadata: { ...metadata, preMissingObservations: 1, preMissingCandidateAt: missingAt } })
        .eq('id', row.id)
      if (updateError) throw updateError
      candidateCount += 1
    }
  }
  return { candidateCount, missingCount }
}

async function countPreOutages(client: ServiceClient, now: string) {
  const [{ count: active, error: activeError }, { count: future, error: futureError }] = await Promise.all([
    client.from('power_outages').select('id', { count: 'exact', head: true }).eq('source', 'pre').is('missing_since', null).lte('starts_at', now).gte('ends_at', now).neq('source_status', 'cancelled'),
    client.from('power_outages').select('id', { count: 'exact', head: true }).eq('source', 'pre').is('missing_since', null).gt('starts_at', now).neq('source_status', 'cancelled'),
  ])
  if (activeError) throw activeError
  if (futureError) throw futureError
  return { active: active ?? 0, future: future ?? 0 }
}

export async function importPreOutages(input: {
  triggerKind?: 'scheduled' | 'manual' | 'store_change' | 'retry'
} = {}) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení Supabase pro import PRE.')

  const startedAt = new Date().toISOString()
  await client.from('power_outage_sync_runs').update({
    status: 'failed', finished_at: startedAt, error_code: 'PRE_SYNC_STALE',
    error_message: 'Synchronizace PRE překročila bezpečnostní limit 15 minut.',
  }).eq('source', 'pre').eq('status', 'running').lt('started_at', new Date(Date.now() - 15 * 60_000).toISOString())

  const [{ data: sourceState, error: stateError }, { data: catalogState, error: catalogError }] = await Promise.all([
    client.from('power_outage_source_state').select('consecutive_failure_count,data_version,latest_payload_sha256').eq('source', 'pre').maybeSingle<SourceState>(),
    client.from('power_outage_store_catalog_state').select('revision').eq('singleton', true).single<{ revision: number }>(),
  ])
  if (stateError) throw stateError
  if (catalogError) throw catalogError

  const { data: run, error: runError } = await client.from('power_outage_sync_runs').insert({
    source: 'pre', trigger_kind: input.triggerKind ?? 'scheduled', status: 'running', store_revision: catalogState.revision,
  }).select('id').single<{ id: string }>()
  if (runError?.code === '23505') throw new PreSyncAlreadyRunningError()
  if (runError) throw runError

  try {
    const loaded = await loadPreOutages()
    const normalized = loaded.rows.map((row) => normalizePreOutage(row))
    const payloadSha256 = powerOutageSha256(normalized.map((outage) => outage.payloadSha256).sort())
    const completedAt = new Date().toISOString()
    await storePowerOutageSourceSnapshot({
      client, source: 'pre', payloadSha256, payload: loaded.rows,
      recordCount: loaded.rows.length, observedAt: completedAt,
      metadata: { contract: loaded.contract, responseBytes: loaded.responseBytes },
    })

    const existingPayloadByExternalId = new Map<string, string>()
    for (const ids of chunks(normalized.map((outage) => outage.externalId), 100)) {
      const { data, error } = await client.from('power_outages').select('external_id,payload_sha256').eq('source', 'pre').in('external_id', ids)
      if (error) throw error
      for (const row of data ?? []) existingPayloadByExternalId.set(String(row.external_id), String(row.payload_sha256))
    }
    const changedRecordCount = normalized.filter((outage) => existingPayloadByExternalId.get(outage.externalId) !== outage.payloadSha256).length
    const coveredMunicipalityCount = new Set(normalized.map((outage) => outage.municipality).filter(Boolean)).size
    const withoutAddressCount = normalized.filter((outage) => outage.addresses.length === 0).length
    const saved = await upsertPreOutages(client, normalized, completedAt)
    const missing = await markMissingPreOutages(client, saved.externalIds, completedAt)
    const counts = await countPreOutages(client, completedAt)
    const changed = changedRecordCount > 0 || missing.missingCount > 0 || sourceState?.latest_payload_sha256 !== payloadSha256
    const termTimes = normalized.flatMap((outage) => [Date.parse(outage.startsAt), Date.parse(outage.endsAt)]).filter(Number.isFinite)
    const dateFrom = termTimes.length ? new Date(Math.min(...termTimes)).toISOString() : null
    const dateTo = termTimes.length ? new Date(Math.max(...termTimes)).toISOString() : null

    const metadata = {
      contract: loaded.contract, responseBytes: loaded.responseBytes, sourceOutageCount: loaded.rows.length,
      changedRecordCount, coveredMunicipalityCount, withoutAddressCount,
      normalizedTermCount: normalized.length, missingCandidateCount: missing.candidateCount,
      missingCount: missing.missingCount, dateFrom, dateTo,
    }
    const { error: sourceUpdateError } = await client.from('power_outage_source_state').update({
      last_attempt_at: completedAt, last_success_at: completedAt,
      ...(changed ? { last_change_at: completedAt } : {}),
      latest_source_ref: loaded.contract, latest_payload_sha256: payloadSha256,
      active_outage_count: counts.active, future_outage_count: counts.future,
      consecutive_failure_count: 0, last_error_at: null, last_error_code: null, last_error_message: null,
      data_version: (sourceState?.data_version ?? 0) + (changed ? 1 : 0),
      store_revision_processed: catalogState.revision, metadata,
    }).eq('source', 'pre')
    if (sourceUpdateError) throw sourceUpdateError

    const { error: finishError } = await client.from('power_outage_sync_runs').update({
      status: changed ? 'succeeded' : 'no_change', finished_at: completedAt,
      source_record_count: loaded.rows.length, outage_upsert_count: saved.outageCount,
      address_upsert_count: saved.addressCount, payload_sha256: payloadSha256, metadata,
    }).eq('id', run.id)
    if (finishError) throw finishError

    return {
      status: changed ? 'succeeded' as const : 'no_change' as const,
      syncRunId: run.id, sourceOutageCount: loaded.rows.length,
      savedOutageCount: saved.outageCount, savedAddressCount: saved.addressCount,
      withoutAddressCount, missingCandidateCount: missing.candidateCount,
      missingCount: missing.missingCount, payloadSha256, dateFrom, dateTo,
    }
  } catch (error) {
    const failedAt = new Date().toISOString()
    await Promise.all([
      client.from('power_outage_sync_runs').update({ status: 'failed', finished_at: failedAt, error_code: 'PRE_SYNC_FAILED', error_message: errorMessage(error).slice(0, 2_000) }).eq('id', run.id),
      client.from('power_outage_source_state').update({ last_attempt_at: failedAt, last_error_at: failedAt, last_error_code: 'PRE_SYNC_FAILED', last_error_message: errorMessage(error).slice(0, 2_000), consecutive_failure_count: (sourceState?.consecutive_failure_count ?? 0) + 1 }).eq('source', 'pre'),
    ])
    throw error
  }
}

