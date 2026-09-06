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
  if (storeIds.length === 0 || input.exactExternalIds.length === 0) return 0

  let changedCount = 0
  for (const storeId of storeIds) {
    for (const externalId of input.exactExternalIds) {
      const outageId = input.outageIdByExternal.get(externalId)
      if (!outageId) continue
      const { data, error } = await input.client.rpc(
        'record_power_outage_cez_market_exact_store_match',
        {
          requested_target_id: input.target.target_id,
          requested_external_id: externalId,
          requested_outage_id: outageId,
          requested_store_id: storeId,
          requested_observed_at: input.observedAt,
        },
      )
      if (error) throw error
      if (data && typeof data === 'object' && !Array.isArray(data) && data.changed === true) {
        changedCount += 1
      }
    }
  }
  return changedCount
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
