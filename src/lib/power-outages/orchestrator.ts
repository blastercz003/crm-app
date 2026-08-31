import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { CezSyncAlreadyRunningError, importCezOutagesForStores } from './cez-sync'
import { EgdSyncAlreadyRunningError, importEgdOutages } from './egd-sync'
import {
  reconcilePowerOutageStoreMatches,
  StoreMatchSyncAlreadyRunningError,
} from './store-match-sync'
import { powerOutageErrorMessage } from './error-message'

export type PowerOutageSyncSource = 'all' | 'cez' | 'egd'

type StoreRow = {
  id: string
  city: string
  address: string
}

type StoreRegistryLookup = {
  store_id: string
  ruian_address_id: number | null
  municipality_code: string | null
  distributor: 'cez' | 'egd' | 'unknown'
}

async function loadStoreCatalog() {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení Supabase pro načtení Prodejen.')

  const stores: StoreRow[] = []
  const pageSize = 1_000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('stores')
      .select('id,city,address')
      .order('id')
      .range(from, from + pageSize - 1)
    if (error) throw error
    stores.push(...((data ?? []) as StoreRow[]))
    if ((data?.length ?? 0) < pageSize) break
  }

  if (stores.length === 0) {
    throw new Error('Databáze Prodejen je prázdná; synchronizaci odstávek nelze bezpečně spustit.')
  }

  const { data: registryData, error: registryError } = await client
    .from('power_outage_store_registry')
    .select('store_id,ruian_address_id,municipality_code,distributor')
    .eq('is_active', true)
    .not('store_id', 'is', null)
  if (registryError) throw registryError
  const registryByStore = new Map(
    ((registryData ?? []) as StoreRegistryLookup[]).map((row) => [row.store_id, row]),
  )

  return stores.map((store) => {
    const registry = registryByStore.get(store.id)
    const townCode = registry?.municipality_code
      ? Number(registry.municipality_code)
      : null
    return {
      ...store,
      verifiedAddressId: registry?.ruian_address_id ?? null,
      verifiedTownCode: Number.isSafeInteger(townCode) ? townCode : null,
      distributor: registry?.distributor ?? 'unknown',
    }
  })
}

export async function syncPowerOutages(source: PowerOutageSyncSource = 'all') {
  const startedAt = new Date().toISOString()
  const stores = await loadStoreCatalog()
  const sourceResults: Array<{
    source: 'cez' | 'egd'
    ok: boolean
    skipped?: boolean
    result?: unknown
    error?: string
  }> = []

  // Zdroje zpracujeme postupně. Snižuje to maximální paměť při velkém EG.D
  // snapshotu a omezuje současný tlak na dvě veřejná rozhraní.
  if (source === 'all' || source === 'cez') {
    try {
      const result = await importCezOutagesForStores({
        stores,
        triggerKind: 'scheduled',
        completeCatalogScan: true,
        batchSize: 80,
      })
      sourceResults.push({ source: 'cez', ok: true, result })
    } catch (error) {
      if (error instanceof CezSyncAlreadyRunningError) {
        sourceResults.push({ source: 'cez', ok: true, skipped: true })
      } else {
        sourceResults.push({
          source: 'cez',
          ok: false,
          error: powerOutageErrorMessage(error, 'Synchronizace ČEZ selhala.'),
        })
      }
    }
  }

  if (source === 'all' || source === 'egd') {
    try {
      const result = await importEgdOutages({
        daysAhead: 90,
        fallbackCities: [...new Set(stores.map((store) => store.city).filter(Boolean))],
        triggerKind: 'scheduled',
      })
      sourceResults.push({ source: 'egd', ok: true, result })
    } catch (error) {
      if (error instanceof EgdSyncAlreadyRunningError) {
        sourceResults.push({ source: 'egd', ok: true, skipped: true })
      } else {
        sourceResults.push({
          source: 'egd',
          ok: false,
          error: powerOutageErrorMessage(error, 'Synchronizace EG.D selhala.'),
        })
      }
    }
  }

  const successfulCount = sourceResults.filter((result) => result.ok).length
  let matching: Awaited<ReturnType<typeof reconcilePowerOutageStoreMatches>> | null = null
  let matchingError: string | null = null
  let matchingSkipped = false
  if (successfulCount > 0) {
    try {
      matching = await reconcilePowerOutageStoreMatches({ triggerKind: 'source_sync' })
    } catch (error) {
      if (error instanceof StoreMatchSyncAlreadyRunningError) {
        matchingSkipped = true
      } else {
        matchingError = error instanceof Error
          ? error.message
          : 'Párování odstávek s Prodejnami selhalo.'
      }
    }
  }

  return {
    ok: successfulCount === sourceResults.length && matchingError === null,
    partial: successfulCount > 0
      && (successfulCount < sourceResults.length || matchingError !== null),
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceResults,
    matching,
    matchingSkipped,
    matchingError,
  }
}
