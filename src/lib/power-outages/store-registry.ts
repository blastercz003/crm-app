import 'server-only'

import { createHash } from 'node:crypto'
import { getServiceRoleClient } from '@/lib/supabase/service'
import { chooseDistributionAddress, searchCezAddresses } from './cez-source'
import { normalizePowerOutageText } from './normalization'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type StoreRow = {
  id: string
  chain_name: string
  store_number: string
  city: string
  address: string
}

type RegistryRow = {
  id: string
  store_id: string
  store_chain_name: string
  store_number: string
  store_city: string
  store_address: string
  address_fingerprint: string
}

export class StoreRegistryRunAlreadyRunningError extends Error {
  constructor() {
    super('Předchozí úplný audit Prodejen stále probíhá.')
    this.name = 'StoreRegistryRunAlreadyRunningError'
  }
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}

function fingerprintPart(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('cs-CZ')
}

export function powerOutageStoreFingerprint(store: {
  chainName: string
  storeNumber: string
  city: string
  address: string
}) {
  return createHash('sha256')
    .update([
      store.chainName,
      store.storeNumber,
      store.city,
      store.address,
    ].map(fingerprintPart).join('|'), 'utf8')
    .digest('hex')
}

function streetName(value: string) {
  return normalizePowerOutageText(value.split(',')[0] ?? value)
    .replace(/\s+\d+[a-z]?(?:\s*\/\s*\d+[a-z]?)?.*$/, '')
    .trim()
}

function addressNumbers(value: string) {
  const match = value.match(/\b(\d+[a-z]?)(?:\s*\/\s*(\d+[a-z]?))?/i)
  return {
    houseNumber: match?.[1] ?? null,
    orientationNumber: match?.[2] ?? null,
  }
}

function distributor(value: string | null | undefined) {
  const normalized = normalizePowerOutageText(value)
  const compact = normalized.replace(/\s+/g, '')
  if (compact.includes('cez')) return 'cez' as const
  if (compact.includes('egd') || compact.includes('eon')) return 'egd' as const
  if (compact.includes('predistribuce') || compact === 'pre') return 'pre' as const
  return 'unknown' as const
}

function registrySnapshot(store: StoreRow) {
  return {
    store_id: store.id,
    store_chain_name: store.chain_name,
    store_number: store.store_number,
    store_city: store.city,
    store_address: store.address,
    address_fingerprint: powerOutageStoreFingerprint({
      chainName: store.chain_name,
      storeNumber: store.store_number,
      city: store.city,
      address: store.address,
    }),
    is_active: true,
  }
}

async function loadAllStores(client: ServiceClient) {
  const rows: StoreRow[] = []
  const pageSize = 1_000
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from('stores')
      .select('id,chain_name,store_number,city,address')
      .order('id')
      .range(from, from + pageSize - 1)
    if (error) throw error
    rows.push(...((data ?? []) as StoreRow[]))
    if ((data?.length ?? 0) < pageSize) break
  }
  return rows
}

export async function auditPowerOutageStoreRegistry(
  triggerKind: 'scheduled' | 'manual' | 'retry' = 'scheduled',
) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro audit Prodejen.')

  const startedAt = new Date().toISOString()
  await client
    .from('power_outage_store_audit_runs')
    .update({
      status: 'failed',
      finished_at: startedAt,
      error_code: 'STORE_AUDIT_STALE',
      error_message: 'Audit Prodejen překročil bezpečnostní limit 30 minut.',
    })
    .eq('status', 'running')
    .lt('started_at', new Date(Date.now() - 30 * 60_000).toISOString())

  const { data: run, error: runError } = await client
    .from('power_outage_store_audit_runs')
    .insert({ status: 'running', trigger_kind: triggerKind })
    .select('id')
    .single<{ id: string }>()
  if (runError?.code === '23505') throw new StoreRegistryRunAlreadyRunningError()
  if (runError) throw runError

  try {
    const [stores, registryResult] = await Promise.all([
      loadAllStores(client),
      client
        .from('power_outage_store_registry')
        .select('id,store_id,store_chain_name,store_number,store_city,store_address,address_fingerprint')
        .not('store_id', 'is', null),
    ])
    if (registryResult.error) throw registryResult.error
    const registry = (registryResult.data ?? []) as RegistryRow[]
    const byStoreId = new Map(registry.map((row) => [row.store_id, row]))
    const currentStoreIds = new Set(stores.map((store) => store.id))
    const changedSnapshots = stores.flatMap((store) => {
      const snapshot = registrySnapshot(store)
      const existing = byStoreId.get(store.id)
      const changed = !existing || existing.address_fingerprint !== snapshot.address_fingerprint
      return changed ? [{
        ...snapshot,
        needs_refresh: true,
        verification_status: 'pending',
        ruian_address_id: null,
        municipality_code: null,
        distributor: 'unknown',
        normalized_municipality: '',
        normalized_street: '',
        house_number: null,
        orientation_number: null,
        last_verified_at: null,
        last_error_code: null,
        last_error_message: null,
      }] : []
    })

    for (const batch of chunks(changedSnapshots, 400)) {
      const { error } = await client
        .from('power_outage_store_registry')
        .upsert(batch, { onConflict: 'store_id' })
      if (error) throw error
    }

    const orphanedIds = registry
      .filter((row) => !currentStoreIds.has(row.store_id))
      .map((row) => row.id)
    if (orphanedIds.length > 0) {
      const { error } = await client
        .from('power_outage_store_registry')
        .update({ store_id: null, is_active: false, needs_refresh: false })
        .in('id', orphanedIds)
      if (error) throw error
    }

    const finishedAt = new Date().toISOString()
    const { error: finishError } = await client
      .from('power_outage_store_audit_runs')
      .update({
        status: 'succeeded',
        finished_at: finishedAt,
        store_count: stores.length,
        queued_count: changedSnapshots.length,
        orphaned_count: orphanedIds.length,
      })
      .eq('id', run.id)
    if (finishError) throw finishError
    return {
      status: 'succeeded' as const,
      storeCount: stores.length,
      queuedCount: changedSnapshots.length,
      orphanedCount: orphanedIds.length,
    }
  } catch (error) {
    await client
      .from('power_outage_store_audit_runs')
      .update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error_code: 'STORE_AUDIT_FAILED',
        error_message: (error instanceof Error ? error.message : 'Audit Prodejen selhal.').slice(0, 2_000),
      })
      .eq('id', run.id)
    throw error
  }
}

export async function processPowerOutageStoreRegistryQueue(limit = 40) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro ověření adres Prodejen.')
  const safeLimit = Math.min(100, Math.max(1, Math.trunc(limit)))
  const { data, error } = await client
    .from('power_outage_store_registry')
    .select('id,store_id,store_chain_name,store_number,store_city,store_address,address_fingerprint')
    .eq('is_active', true)
    .eq('needs_refresh', true)
    .order('updated_at')
    .limit(safeLimit)
  if (error) throw error

  const rows = (data ?? []) as RegistryRow[]
  let verifiedCount = 0
  let reviewCount = 0
  let failedCount = 0

  for (const row of rows) {
    const attemptedAt = new Date().toISOString()
    try {
      const candidates = await searchCezAddresses(`${row.store_address}, ${row.store_city}`)
      const selected = chooseDistributionAddress(candidates, {
        id: row.store_id,
        city: row.store_city,
        address: row.store_address,
      })
      const storeStreet = streetName(row.store_address)
      const selectedStreet = streetName(selected?.street ?? '')
      const cityMatches = Boolean(
        selected
        && normalizePowerOutageText(selected.town) === normalizePowerOutageText(row.store_city),
      )
      const streetMatches = Boolean(storeStreet && selectedStreet === storeStreet)
      const numbers = addressNumbers(row.store_address)
      const sourceNumbers = new Set([
        selected?.houseNum == null ? '' : String(selected.houseNum),
        selected?.streetNum == null ? '' : String(selected.streetNum),
      ].filter(Boolean).map((value) => normalizePowerOutageText(value)))
      const requestedNumbers = [numbers.houseNumber, numbers.orientationNumber]
        .filter((value): value is string => Boolean(value))
        .map(normalizePowerOutageText)
      const numberMatches = requestedNumbers.length === 0
        || requestedNumbers.some((value) => sourceNumbers.has(value))
      const status = selected && cityMatches && streetMatches && numberMatches
        ? 'verified'
        : selected && cityMatches && streetMatches
          ? 'probable'
          : selected && cityMatches
            ? 'needs_review'
            : 'not_found'
      if (status === 'verified' || status === 'probable') verifiedCount += 1
      else reviewCount += 1

      const { error: updateError } = await client
        .from('power_outage_store_registry')
        .update({
          normalized_municipality: normalizePowerOutageText(selected?.town ?? row.store_city),
          normalized_street: normalizePowerOutageText(selected?.street ?? storeStreet),
          house_number: numbers.houseNumber,
          orientation_number: numbers.orientationNumber,
          ruian_address_id: selected?.id ?? null,
          municipality_code: selected?.townCode == null ? null : String(selected.townCode),
          distributor: distributor(selected?.dso),
          verification_status: status,
          needs_refresh: false,
          last_attempt_at: attemptedAt,
          last_verified_at: status === 'verified' || status === 'probable' ? attemptedAt : null,
          last_error_code: null,
          last_error_message: null,
          metadata: {
            resolver: 'cez-public-address-v1',
            candidateCount: candidates.length,
            selectedDso: selected?.dso ?? null,
            selectedTownPart: selected?.townPart ?? null,
            selectedDistrict: selected?.district ?? null,
            selectedRegion: selected?.region ?? null,
            cityMatches,
            streetMatches,
            numberMatches,
          },
        })
        .eq('id', row.id)
        .eq('address_fingerprint', row.address_fingerprint)
      if (updateError) throw updateError
    } catch (queueError) {
      failedCount += 1
      await client
        .from('power_outage_store_registry')
        .update({
          verification_status: 'error',
          needs_refresh: true,
          last_attempt_at: attemptedAt,
          last_error_code: 'STORE_ADDRESS_VERIFICATION_FAILED',
          last_error_message: (queueError instanceof Error ? queueError.message : 'Ověření adresy selhalo.').slice(0, 2_000),
        })
        .eq('id', row.id)
    }
    // Stejné veřejné rozhraní používá také synchronizace ČEZ. Pomalejší
    // fronta předchází krátkým burstům a následnému HTTP 429.
    await new Promise((resolve) => setTimeout(resolve, 900))
  }

  return {
    processedCount: rows.length,
    verifiedCount,
    reviewCount,
    failedCount,
    hasMore: rows.length === safeLimit,
  }
}
