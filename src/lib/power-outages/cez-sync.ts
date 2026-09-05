import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { normalizeCezOutage, type NormalizedPowerOutage } from './cez-normalizer'
import {
  loadCezOutagesForStoreCatalog,
  type CezStoreLookup,
} from './cez-source'
import { powerOutageSha256 } from './normalization'
import { storePowerOutageSourceSnapshot } from './source-snapshots'
import { powerOutageErrorMessage } from './error-message'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type SourceState = {
  consecutive_failure_count: number | null
  data_version: number | null
  latest_payload_sha256: string | null
  metadata: Record<string, unknown> | null
  store_revision_processed: number | null
}

type CatalogState = { revision: number }

const CEZ_SCAN_STATE_VERSION = 2
const CEZ_MARKET_COLLECTOR_V1 = 'v1' as const

async function activeCezMarketCollectorVersion(client: ServiceClient) {
  const { data, error } = await client
    .from('power_outage_cez_market_collector_state')
    .select('active_version')
    .eq('singleton', true)
    .maybeSingle<{ active_version: string }>()

  // Bezpečné pořadí nasazení: starší databáze bez verzovací tabulky dál používá
  // dosavadní sběr v1. Po aplikaci migrace už je zdrojem pravdy databázový přepínač.
  if (error?.code === '42P01' || error?.code === 'PGRST205') {
    return CEZ_MARKET_COLLECTOR_V1
  }
  if (error) throw error

  const version = data?.active_version ?? CEZ_MARKET_COLLECTOR_V1
  if (version !== CEZ_MARKET_COLLECTOR_V1) {
    throw new Error(`Sběrač ČEZ pro MARKETY ${version} zatím není v této verzi aplikace dostupný.`)
  }
  return version
}

export class CezSyncAlreadyRunningError extends Error {
  constructor() {
    super('Předchozí synchronizace odstávek ČEZ stále probíhá.')
    this.name = 'CezSyncAlreadyRunningError'
  }
}

function errorMessage(error: unknown) {
  return powerOutageErrorMessage(
    error,
    'Neznámá chyba synchronizace odstávek ČEZ.',
  )
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function outageRow(outage: NormalizedPowerOutage, observedAt: string) {
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

async function upsertCezOutages(
  client: ServiceClient,
  outages: NormalizedPowerOutage[],
  observedAt: string,
) {
  if (outages.length === 0) return { outageCount: 0, addressCount: 0 }

  const outageIdByExternal = new Map<string, string>()
  for (const batch of chunks(outages, 50)) {
    const { data: savedOutages, error: outageError } = await client
      .from('power_outages')
      .upsert(
        batch.map((outage) => outageRow(outage, observedAt)),
        { onConflict: 'source,external_id' },
      )
      .select('id,external_id')
    if (outageError) throw outageError
    for (const row of savedOutages ?? []) {
      outageIdByExternal.set(String(row.external_id), String(row.id))
    }
  }
  let addressCount = 0

  for (const outage of outages) {
    const outageId = outageIdByExternal.get(outage.externalId)
    if (!outageId) {
      throw new Error(`Po uložení odstávky ČEZ ${outage.externalId} chybí její ID.`)
    }

    const addressRows = outage.addresses.map((address) => ({
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
    }))

    for (const addressBatch of chunks(addressRows, 300)) {
      const { error } = await client
        .from('power_outage_addresses')
        .upsert(addressBatch, { onConflict: 'outage_id,address_key' })
      if (error) throw error
    }

    const currentKeys = new Set(addressRows.map((row) => row.address_key))
    const { data: existingAddresses, error: existingAddressError } = await client
      .from('power_outage_addresses')
      .select('id,address_key')
      .eq('outage_id', outageId)
    if (existingAddressError) throw existingAddressError
    const staleAddressIds = (existingAddresses ?? [])
      .filter((row) => !currentKeys.has(String(row.address_key)))
      .map((row) => String(row.id))
    for (const staleBatch of chunks(staleAddressIds, 300)) {
      const { error: staleError } = await client
        .from('power_outage_addresses')
        .delete()
        .in('id', staleBatch)
      if (staleError) throw staleError
    }

    addressCount += addressRows.length
  }

  return { outageCount: outages.length, addressCount }
}

async function countCezOutages(client: ServiceClient, now: string) {
  const [{ count: active, error: activeError }, { count: future, error: futureError }] = await Promise.all([
    client
      .from('power_outages')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'cez')
      .lte('starts_at', now)
      .gte('ends_at', now)
      .neq('source_status', 'cancelled'),
    client
      .from('power_outages')
      .select('id', { count: 'exact', head: true })
      .eq('source', 'cez')
      .gt('starts_at', now)
      .neq('source_status', 'cancelled'),
  ])
  if (activeError) throw activeError
  if (futureError) throw futureError
  return { active: active ?? 0, future: future ?? 0 }
}

async function markMissingCezOutages(
  client: ServiceClient,
  externalIds: Set<string>,
  missingAt: string,
) {
  const { data, error } = await client
    .from('power_outages')
    .select('id,external_id,missing_since')
    .eq('source', 'cez')
  if (error) throw error

  const missingIds = (data ?? [])
    .filter((row) => !externalIds.has(String(row.external_id)) && !row.missing_since)
    .map((row) => String(row.id))
  for (let index = 0; index < missingIds.length; index += 400) {
    const { error: updateError } = await client
      .from('power_outages')
      .update({ missing_since: missingAt })
      .in('id', missingIds.slice(index, index + 400))
    if (updateError) throw updateError
  }
  return missingIds.length
}

export async function importCezOutagesForStores(input: {
  stores: CezStoreLookup[]
  triggerKind?: 'scheduled' | 'manual' | 'store_change' | 'retry'
  completeCatalogScan?: boolean
  batchSize?: number
  minimumFullScanIntervalMs?: number
}) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení Supabase pro import ČEZ.')
  const collectorVersion = await activeCezMarketCollectorVersion(client)

  const startedAt = new Date().toISOString()
  const staleBefore = new Date(Date.now() - 15 * 60 * 1_000).toISOString()
  await client
    .from('power_outage_sync_runs')
    .update({
      status: 'failed',
      finished_at: startedAt,
      error_code: 'CEZ_SYNC_STALE',
      error_message: 'Synchronizace ČEZ překročila bezpečnostní limit 15 minut.',
    })
    .eq('source', 'cez')
    .eq('status', 'running')
    .lt('started_at', staleBefore)

  const [{ data: sourceState, error: stateError }, { data: catalogState, error: catalogError }] = await Promise.all([
    client
      .from('power_outage_source_state')
      .select('consecutive_failure_count,data_version,latest_payload_sha256,metadata,store_revision_processed')
      .eq('source', 'cez')
      .maybeSingle<SourceState>(),
    client
      .from('power_outage_store_catalog_state')
      .select('revision')
      .eq('singleton', true)
      .single<CatalogState>(),
  ])
  if (stateError) throw stateError
  if (catalogError) throw catalogError

  const sortedStores = [...input.stores].sort((left, right) => left.id.localeCompare(right.id))
  const previousScan = sourceState?.metadata?.cezScan
  const scan = previousScan && typeof previousScan === 'object'
    ? previousScan as Record<string, unknown>
    : null
  const sameRevisionScan = scan?.version === CEZ_SCAN_STATE_VERSION
    && scan.storeRevision === catalogState.revision
    && Number.isInteger(scan.nextStoreIndex)
  const storedNextIndex = sameRevisionScan ? Number(scan?.nextStoreIndex) : 0
  const hasActiveScan = storedNextIndex > 0 && storedNextIndex < sortedStores.length
  const lastFullScanAt = typeof sourceState?.metadata?.lastFullScanAt === 'string'
    ? sourceState.metadata.lastFullScanAt
    : null
  const lastFullScanTime = lastFullScanAt ? Date.parse(lastFullScanAt) : Number.NaN
  const minimumFullScanIntervalMs = Math.max(0, input.minimumFullScanIntervalMs ?? 0)
  const catalogAlreadyProcessed = (sourceState?.store_revision_processed ?? 0) >= catalogState.revision
  const waitForNextFullScan = Boolean(input.completeCatalogScan)
    && !hasActiveScan
    && catalogAlreadyProcessed
    && Number.isFinite(lastFullScanTime)
    && Date.now() - lastFullScanTime < minimumFullScanIntervalMs

  if (waitForNextFullScan) {
    return {
      status: 'skipped' as const,
      reason: 'full_scan_interval' as const,
      lastFullScanAt,
      nextEligibleAt: new Date(lastFullScanTime + minimumFullScanIntervalMs).toISOString(),
      storeRevision: catalogState.revision,
    }
  }

  const { data: run, error: runError } = await client
    .from('power_outage_sync_runs')
    .insert({
      source: 'cez',
      trigger_kind: input.triggerKind ?? 'scheduled',
      status: 'running',
      store_revision: catalogState.revision,
    })
    .select('id')
    .single<{ id: string }>()
  if (runError?.code === '23505') throw new CezSyncAlreadyRunningError()
  if (runError) throw runError

  try {
    const requestedBatchSize = input.batchSize == null
      ? sortedStores.length
      : Math.min(250, Math.max(1, Math.trunc(input.batchSize)))
    const startIndex = hasActiveScan ? storedNextIndex : 0
    const batchStores = sortedStores.slice(startIndex, startIndex + requestedBatchSize)
    const loaded = await loadCezOutagesForStoreCatalog(batchStores)
    const normalized = loaded.outages.map((outage) => normalizeCezOutage(outage))
    const batchPayloadSha256 = powerOutageSha256(
      normalized.map((outage) => outage.payloadSha256).sort(),
    )
    const nextIndex = Math.min(sortedStores.length, startIndex + batchStores.length)
    const scanComplete = nextIndex >= sortedStores.length
    const previousExternalIds = hasActiveScan && Array.isArray(scan?.externalIds)
      ? scan.externalIds.filter((value): value is string => typeof value === 'string')
      : []
    const previousBatchHashes = hasActiveScan && Array.isArray(scan?.batchHashes)
      ? scan.batchHashes.filter((value): value is string => typeof value === 'string')
      : []
    const scanExternalIds = [...new Set([
      ...previousExternalIds,
      ...normalized.map((outage) => outage.externalId),
    ])]
    const scanBatchHashes = [...previousBatchHashes, batchPayloadSha256]
    const payloadSha256 = scanComplete
      ? powerOutageSha256(scanBatchHashes)
      : batchPayloadSha256
    const completedAt = new Date().toISOString()
    await storePowerOutageSourceSnapshot({
      client,
      source: 'cez',
      payloadSha256: batchPayloadSha256,
      payload: loaded.outages,
      recordCount: loaded.outages.length,
      observedAt: completedAt,
      metadata: {
        collectorVersion,
        searchedStoreCount: loaded.searchedStoreCount,
        coveredTownCount: loaded.coveredTownCount,
        completeCatalogScan: Boolean(input.completeCatalogScan),
        startIndex,
        nextIndex,
        scanComplete,
      },
    })

    const existingPayloadByExternalId = new Map<string, string>()
    for (const externalIdBatch of chunks(normalized.map((outage) => outage.externalId), 50)) {
      const { data: existingRows, error: existingError } = await client
        .from('power_outages')
        .select('external_id,payload_sha256')
        .eq('source', 'cez')
        .in('external_id', externalIdBatch)
      if (existingError) throw existingError
      for (const row of existingRows ?? []) {
        existingPayloadByExternalId.set(String(row.external_id), String(row.payload_sha256))
      }
    }
    const changedRecordCount = normalized.filter((outage) => (
      existingPayloadByExternalId.get(outage.externalId) !== outage.payloadSha256
    )).length
    const changed = changedRecordCount > 0
    const saved = await upsertCezOutages(client, normalized, completedAt)
    const missingCount = input.completeCatalogScan && scanComplete
      ? await markMissingCezOutages(
          client,
          new Set(scanExternalIds),
          completedAt,
        )
      : 0
    const counts = await countCezOutages(client, completedAt)

    const { error: sourceUpdateError } = await client
      .from('power_outage_source_state')
      .update({
        last_attempt_at: completedAt,
        last_success_at: completedAt,
        ...(changed ? { last_change_at: completedAt } : {}),
        latest_source_ref: 'cez-public-address-v1',
        ...(scanComplete ? { latest_payload_sha256: payloadSha256 } : {}),
        active_outage_count: counts.active,
        future_outage_count: counts.future,
        consecutive_failure_count: 0,
        last_error_at: null,
        last_error_code: null,
        last_error_message: null,
        data_version: (sourceState?.data_version ?? 0) + (changed ? 1 : 0),
        ...(input.completeCatalogScan && scanComplete
          ? { store_revision_processed: catalogState.revision }
          : {}),
        metadata: {
          collectorVersion,
          sourceOutageCount: loaded.outages.length,
          changedRecordCount,
          searchedStoreCount: loaded.searchedStoreCount,
          coveredTownCount: loaded.coveredTownCount,
          skippedStoreCount: loaded.skippedStoreCount,
          inspectedAddressCount: loaded.inspectedAddressCount,
          completeCatalogScan: Boolean(input.completeCatalogScan),
          missingCount,
          lastFullScanAt: scanComplete ? completedAt : lastFullScanAt,
          cezScan: scanComplete ? null : {
            version: CEZ_SCAN_STATE_VERSION,
            storeRevision: catalogState.revision,
            nextStoreIndex: nextIndex,
            externalIds: scanExternalIds,
            batchHashes: scanBatchHashes,
            startedAt: hasActiveScan && typeof scan?.startedAt === 'string'
              ? scan.startedAt
              : startedAt,
          },
        },
      })
      .eq('source', 'cez')
    if (sourceUpdateError) throw sourceUpdateError

    const { error: finishError } = await client
      .from('power_outage_sync_runs')
      .update({
        status: changed || !scanComplete ? 'succeeded' : 'no_change',
        finished_at: completedAt,
        source_record_count: loaded.outages.length,
        outage_upsert_count: saved.outageCount,
        address_upsert_count: saved.addressCount,
        payload_sha256: batchPayloadSha256,
        metadata: {
          collectorVersion,
          changedRecordCount,
          searchedStoreCount: loaded.searchedStoreCount,
          coveredTownCount: loaded.coveredTownCount,
          skippedStoreCount: loaded.skippedStoreCount,
          completeCatalogScan: Boolean(input.completeCatalogScan),
          missingCount,
          startIndex,
          nextIndex,
          scanComplete,
        },
      })
      .eq('id', run.id)
    if (finishError) throw finishError

    return {
      status: changed || !scanComplete ? 'succeeded' as const : 'no_change' as const,
      syncRunId: run.id,
      sourceOutageCount: loaded.outages.length,
      searchedStoreCount: loaded.searchedStoreCount,
      coveredTownCount: loaded.coveredTownCount,
      skippedStoreCount: loaded.skippedStoreCount,
      inspectedAddressCount: loaded.inspectedAddressCount,
      savedOutageCount: saved.outageCount,
      savedAddressCount: saved.addressCount,
      missingCount,
      payloadSha256,
      collectorVersion,
      batchPayloadSha256,
      scanComplete,
      nextStoreIndex: scanComplete ? null : nextIndex,
    }
  } catch (error) {
    const failedAt = new Date().toISOString()
    await Promise.all([
      client
        .from('power_outage_sync_runs')
        .update({
          status: 'failed',
          finished_at: failedAt,
          error_code: 'CEZ_SYNC_FAILED',
          error_message: errorMessage(error).slice(0, 2_000),
        })
        .eq('id', run.id),
      client
        .from('power_outage_source_state')
        .update({
          last_attempt_at: failedAt,
          last_error_at: failedAt,
          last_error_code: 'CEZ_SYNC_FAILED',
          last_error_message: errorMessage(error).slice(0, 2_000),
          consecutive_failure_count: (sourceState?.consecutive_failure_count ?? 0) + 1,
        })
        .eq('source', 'cez'),
    ])
    throw error
  }
}
