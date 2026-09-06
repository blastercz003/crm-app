import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { normalizeCezOutage } from './cez-normalizer'
import { inspectCezAddress, type CezOutage } from './cez-source'
import {
  upsertCezOutagesAdditively,
  type CezServiceClient,
} from './cez-sync'
import { powerOutageErrorMessage } from './error-message'

type V2Target = {
  cycle_id: string
  target_id: string
  address_id: number
  municipality: string
  street: string
  house_number: string | null
  orientation_number: string | null
  store_ids: unknown
  lock_token: string
}

type StoreRow = {
  id: string
  chain_name: string
  store_number: string
  city: string
  address: string
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => (
        typeof item === 'string' && item.length > 0
      )))]
    : []
}

function uniqueOutages(outages: CezOutage[]) {
  return [...new Map(outages.map((outage) => [String(outage.id), outage])).values()]
}

async function createMissingExactStoreMatches(input: {
  client: CezServiceClient
  target: V2Target
  exactExternalIds: string[]
  outageIdByExternal: Map<string, string>
  observedAt: string
}) {
  const storeIds = stringArray(input.target.store_ids)
  const outageIds = input.exactExternalIds
    .map((externalId) => input.outageIdByExternal.get(externalId))
    .filter((outageId): outageId is string => Boolean(outageId))
  if (storeIds.length === 0 || outageIds.length === 0) return 0

  const [
    { data: stores, error: storesError },
    { data: catalogState, error: catalogError },
    { data: existingMatches, error: existingError },
  ] = await Promise.all([
    input.client
      .from('stores')
      .select('id,chain_name,store_number,city,address')
      .in('id', storeIds),
    input.client
      .from('power_outage_store_catalog_state')
      .select('revision')
      .eq('singleton', true)
      .single<{ revision: number }>(),
    input.client
      .from('power_outage_store_matches')
      .select('outage_id,store_id')
      .in('outage_id', outageIds)
      .in('store_id', storeIds),
  ])
  if (storesError) throw storesError
  if (catalogError) throw catalogError
  if (existingError) throw existingError

  const existingKeys = new Set(
    (existingMatches ?? []).map((match) => `${match.outage_id}:${match.store_id}`),
  )
  let insertedCount = 0
  for (const store of (stores ?? []) as StoreRow[]) {
    for (const outageId of outageIds) {
      if (existingKeys.has(`${outageId}:${store.id}`)) continue
      const { error } = await input.client
        .from('power_outage_store_matches')
        .insert({
          outage_id: outageId,
          outage_address_id: null,
          store_id: store.id,
          match_status: 'confirmed',
          match_method: 'city_street',
          confidence: 1,
          match_reasons: [{
            code: 'cez_v2_exact_ruian_address',
            ruianAddressId: input.target.address_id,
            collectorVersion: 'v2',
          }],
          store_chain_name: store.chain_name,
          store_number: store.store_number,
          store_city: store.city,
          store_address: store.address,
          store_revision: catalogState.revision,
          last_verified_at: input.observedAt,
          resolved_at: null,
          resolved_by: null,
        })
      // Paralelní bezpečný běh mohl stejnou dvojici vložit o okamžik dříve.
      if (error?.code === '23505') continue
      if (error) throw error
      insertedCount += 1
    }
  }
  return insertedCount
}

async function finishTarget(input: {
  client: CezServiceClient
  target: V2Target
  succeeded: boolean
  exactExternalIds?: string[]
  townExternalIds?: string[]
  error?: unknown
}) {
  const { data, error } = await input.client.rpc(
    'finish_power_outage_cez_market_v2_target',
    {
      requested_target_id: input.target.target_id,
      requested_lock_token: input.target.lock_token,
      requested_succeeded: input.succeeded,
      requested_exact_outage_ids: input.exactExternalIds ?? [],
      requested_town_outage_ids: input.townExternalIds ?? [],
      requested_error_code: input.succeeded ? null : 'CEZ_MARKET_V2_TARGET_FAILED',
      requested_error_message: input.succeeded
        ? null
        : powerOutageErrorMessage(
            input.error,
            'Kontrola adresy ČEZ MARKETY v2 selhala.',
          ).slice(0, 2_000),
    },
  )
  if (error) throw error
  return data as Record<string, unknown> | null
}

export async function runMarketCezV2CollectorBatch(requestedLimit = 6) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro sběrač ČEZ MARKETY v2.')

  const limit = Math.min(8, Math.max(1, Math.trunc(requestedLimit)))
  const { data: versionState, error: versionStateError } = await client
    .from('power_outage_cez_market_version_state')
    .select('last_complete_at')
    .eq('collector_version', 'v2')
    .maybeSingle<{ last_complete_at: string | null }>()
  if (versionStateError) throw versionStateError
  const lastCompleteTime = versionState?.last_complete_at
    ? Date.parse(versionState.last_complete_at)
    : Number.NaN
  if (Number.isFinite(lastCompleteTime)
    && Date.now() - lastCompleteTime < 6 * 60 * 60 * 1_000) {
    return {
      status: 'cooldown' as const,
      processedCount: 0,
      successCount: 0,
      errorCount: 0,
      savedOutageCount: 0,
      savedAddressCount: 0,
      insertedStoreMatchCount: 0,
      nextEligibleAt: new Date(lastCompleteTime + 6 * 60 * 60 * 1_000).toISOString(),
    }
  }
  const { data, error } = await client.rpc(
    'claim_power_outage_cez_market_v2_batch',
    { requested_limit: limit },
  )
  if (error) throw error
  const targets = (data ?? []) as V2Target[]
  if (targets.length === 0) {
    return {
      status: 'inactive_or_empty' as const,
      processedCount: 0,
      successCount: 0,
      errorCount: 0,
      savedOutageCount: 0,
      savedAddressCount: 0,
      insertedStoreMatchCount: 0,
    }
  }

  let successCount = 0
  let errorCount = 0
  let savedOutageCount = 0
  let savedAddressCount = 0
  let insertedStoreMatchCount = 0
  let cycleState: Record<string, unknown> | null = null

  for (const target of targets) {
    try {
      const inspection = await inspectCezAddress(Number(target.address_id))
      const exactOutages = uniqueOutages(inspection.outages ?? [])
      const townOutages = uniqueOutages(inspection.outages_in_town ?? [])
      const exactExternalIds = exactOutages.map((outage) => String(outage.id)).sort()
      const townExternalIds = townOutages.map((outage) => String(outage.id)).sort()
      const normalized = uniqueOutages([...exactOutages, ...townOutages])
        .map((outage) => normalizeCezOutage(outage))
      const observedAt = new Date().toISOString()

      const saved = await upsertCezOutagesAdditively(client, normalized, observedAt, {
        collectorVersion: 'v2',
        cycleId: target.cycle_id,
        exactExternalIds: new Set(exactExternalIds),
        townExternalIds: new Set(townExternalIds),
      })
      savedOutageCount += saved.outageCount
      savedAddressCount += saved.addressCount
      insertedStoreMatchCount += await createMissingExactStoreMatches({
        client,
        target,
        exactExternalIds,
        outageIdByExternal: saved.outageIdByExternal,
        observedAt,
      })
      cycleState = await finishTarget({
        client,
        target,
        succeeded: true,
        exactExternalIds,
        townExternalIds,
      })
      successCount += 1
    } catch (targetError) {
      errorCount += 1
      try {
        cycleState = await finishTarget({
          client,
          target,
          succeeded: false,
          error: targetError,
        })
      } catch {
        // Expirovaný zámek bezpečně převezme další dávka.
      }
    }

    // Veřejné ČEZ rozhraní nezatěžujeme okamžitou sérií požadavků.
    await new Promise((resolve) => setTimeout(resolve, 900))
  }

  return {
    status: errorCount > 0 ? 'partial' as const : 'succeeded' as const,
    cycleId: targets[0]?.cycle_id ?? null,
    cycleState,
    processedCount: targets.length,
    successCount,
    errorCount,
    savedOutageCount,
    savedAddressCount,
    insertedStoreMatchCount,
  }
}
