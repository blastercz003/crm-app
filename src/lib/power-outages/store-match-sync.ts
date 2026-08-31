import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import {
  buildPowerOutageStoreMatches,
  type MatchableOutageAddress,
  type MatchableStore,
} from './store-matching'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type OutageRow = { id: string; source: 'cez' | 'egd' }
type ExistingMatchRow = {
  id: string
  outage_id: string
  store_id: string | null
  match_method: 'city_street' | 'manual'
  match_status: 'confirmed' | 'needs_review' | 'dismissed'
  resolved_at: string | null
}

export class StoreMatchSyncAlreadyRunningError extends Error {
  constructor() {
    super('Předchozí porovnávání odstávek s Prodejnami stále probíhá.')
    this.name = 'StoreMatchSyncAlreadyRunningError'
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Neznámá chyba porovnávání odstávek s Prodejnami.'
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

async function loadAllStores(client: ServiceClient) {
  const stores: MatchableStore[] = []
  const pageSize = 1_000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('stores')
      .select('id,chain_name,store_number,city,address')
      .order('id')
      .range(from, from + pageSize - 1)
    if (error) throw error
    for (const row of data ?? []) {
      stores.push({
        id: String(row.id),
        chainName: String(row.chain_name),
        storeNumber: String(row.store_number),
        city: String(row.city),
        address: String(row.address),
      })
    }
    if ((data?.length ?? 0) < pageSize) break
  }
  return stores
}

async function loadCurrentOutages(client: ServiceClient, now: string) {
  const outages: OutageRow[] = []
  const pageSize = 1_000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('power_outages')
      .select('id,source')
      .is('missing_since', null)
      .neq('source_status', 'cancelled')
      .gt('archive_at', now)
      .order('id')
      .range(from, from + pageSize - 1)
    if (error) throw error
    outages.push(...((data ?? []) as OutageRow[]))
    if ((data?.length ?? 0) < pageSize) break
  }
  return outages
}

async function loadOutageAddresses(
  client: ServiceClient,
  outageIds: string[],
) {
  const addresses: MatchableOutageAddress[] = []
  for (const ids of chunks(outageIds, 100)) {
    const pageSize = 1_000
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client
        .from('power_outage_addresses')
        .select('id,outage_id,municipality,town_part,street,normalized_municipality,normalized_street')
        .in('outage_id', ids)
        .order('id')
        .range(from, from + pageSize - 1)
      if (error) throw error
      for (const row of data ?? []) {
        addresses.push({
          id: String(row.id),
          outageId: String(row.outage_id),
          municipality: String(row.municipality),
          townPart: row.town_part ? String(row.town_part) : null,
          street: String(row.street),
          normalizedMunicipality: String(row.normalized_municipality),
          normalizedStreet: String(row.normalized_street),
        })
      }
      if ((data?.length ?? 0) < pageSize) break
    }
  }
  return addresses
}

async function loadExistingMatches(
  client: ServiceClient,
  outageIds: string[],
) {
  const matches: ExistingMatchRow[] = []
  for (const ids of chunks(outageIds, 100)) {
    const pageSize = 1_000
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await client
        .from('power_outage_store_matches')
        .select('id,outage_id,store_id,match_method,match_status,resolved_at')
        .in('outage_id', ids)
        .order('id')
        .range(from, from + pageSize - 1)
      if (error) throw error
      matches.push(...((data ?? []) as ExistingMatchRow[]))
      if ((data?.length ?? 0) < pageSize) break
    }
  }
  return matches
}

export async function reconcilePowerOutageStoreMatches(input: {
  triggerKind?: 'scheduled' | 'manual' | 'store_change' | 'source_sync' | 'retry'
} = {}) {
  const client = getServiceRoleClient()
  if (!client) {
    throw new Error('Chybí serverové připojení Supabase pro párování odstávek.')
  }

  const startedAt = new Date().toISOString()
  const staleBefore = new Date(Date.now() - 15 * 60 * 1_000).toISOString()
  await client
    .from('power_outage_match_runs')
    .update({
      status: 'failed',
      finished_at: startedAt,
      error_code: 'STORE_MATCH_STALE',
      error_message: 'Párovací běh překročil bezpečnostní limit 15 minut.',
    })
    .eq('status', 'running')
    .lt('started_at', staleBefore)

  const { data: catalogState, error: catalogError } = await client
    .from('power_outage_store_catalog_state')
    .select('revision')
    .eq('singleton', true)
    .single<{ revision: number }>()
  if (catalogError) throw catalogError

  const { data: run, error: runError } = await client
    .from('power_outage_match_runs')
    .insert({
      status: 'running',
      trigger_kind: input.triggerKind ?? 'scheduled',
      store_revision: catalogState.revision,
    })
    .select('id')
    .single<{ id: string }>()
  if (runError?.code === '23505') throw new StoreMatchSyncAlreadyRunningError()
  if (runError) throw runError

  try {
    const now = new Date().toISOString()
    const [stores, outages] = await Promise.all([
      loadAllStores(client),
      loadCurrentOutages(client, now),
    ])
    const outageIds = outages.map((outage) => outage.id)
    const [addresses, existingMatches] = await Promise.all([
      loadOutageAddresses(client, outageIds),
      loadExistingMatches(client, outageIds),
    ])
    const candidates = buildPowerOutageStoreMatches(stores, addresses)
    const existingByKey = new Map(
      existingMatches
        .filter((match) => match.store_id)
        .map((match) => [`${match.outage_id}:${match.store_id}`, match]),
    )
    const desiredKeys = new Set<string>()
    let preservedManualCount = 0
    const rows = []

    for (const candidate of candidates) {
      const key = `${candidate.outageId}:${candidate.store.id}`
      desiredKeys.add(key)
      const existing = existingByKey.get(key)
      if (existing?.resolved_at || existing?.match_method === 'manual') {
        preservedManualCount += 1
        continue
      }
      rows.push({
        outage_id: candidate.outageId,
        outage_address_id: candidate.outageAddressId,
        store_id: candidate.store.id,
        match_status: candidate.matchStatus,
        match_method: 'city_street',
        confidence: candidate.confidence,
        match_reasons: candidate.reasons,
        store_chain_name: candidate.store.chainName,
        store_number: candidate.store.storeNumber,
        store_city: candidate.store.city,
        store_address: candidate.store.address,
        store_revision: catalogState.revision,
        last_verified_at: now,
        resolved_at: null,
        resolved_by: null,
      })
    }

    for (const batch of chunks(rows, 400)) {
      const { error } = await client
        .from('power_outage_store_matches')
        .upsert(batch, { onConflict: 'outage_id,store_id' })
      if (error) throw error
    }

    const staleIds = existingMatches
      .filter((match) => (
        match.store_id
        && match.match_method === 'city_street'
        && !match.resolved_at
        && !desiredKeys.has(`${match.outage_id}:${match.store_id}`)
      ))
      .map((match) => match.id)
    for (const ids of chunks(staleIds, 400)) {
      const { error } = await client
        .from('power_outage_store_matches')
        .delete()
        .in('id', ids)
      if (error) throw error
    }

    const completedAt = new Date().toISOString()
    const sources = [...new Set(outages.map((outage) => outage.source))]
    const { error: revisionError } = await client
      .from('power_outage_source_state')
      .update({ store_revision_processed: catalogState.revision })
      .in('source', ['cez', 'egd'])
    if (revisionError) throw revisionError

    const confirmedCount = existingMatches.filter((item) => (
      item.match_status === 'confirmed'
      && item.store_id
      && desiredKeys.has(`${item.outage_id}:${item.store_id}`)
    )).length
    const reviewCount = candidates.length
    const { error: finishError } = await client
      .from('power_outage_match_runs')
      .update({
        status: 'succeeded',
        finished_at: completedAt,
        outage_count: outages.length,
        address_count: addresses.length,
        store_count: stores.length,
        confirmed_count: confirmedCount,
        review_count: reviewCount,
        preserved_manual_count: preservedManualCount,
        removed_stale_count: staleIds.length,
        metadata: { sourceCount: sources.length },
      })
      .eq('id', run.id)
    if (finishError) throw finishError

    return {
      status: 'succeeded' as const,
      matchRunId: run.id,
      storeRevision: catalogState.revision,
      outageCount: outages.length,
      addressCount: addresses.length,
      storeCount: stores.length,
      confirmedCount,
      reviewCount,
      preservedManualCount,
      removedStaleCount: staleIds.length,
    }
  } catch (error) {
    const failedAt = new Date().toISOString()
    await client
      .from('power_outage_match_runs')
      .update({
        status: 'failed',
        finished_at: failedAt,
        error_code: 'STORE_MATCH_FAILED',
        error_message: errorMessage(error).slice(0, 2_000),
      })
      .eq('id', run.id)
    throw error
  }
}
