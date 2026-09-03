import 'server-only'

import { normalizeCezOutage, type NormalizedPowerOutage } from './cez-normalizer'
import { inspectCezAddress, type CezOutage } from './cez-source'
import { powerOutageSha256 } from './normalization'
import { getServiceRoleClient } from '@/lib/supabase/service'

type ScanCandidate = {
  cycle_id: string
  municipality_code: string
  municipality_name: string
  cez_address_id: number
  cez_town_code: number
  scan_attempt_count: number
  scan_lock_token: string
  attempt_number: number
}

type ExistingOutage = {
  external_id: string
  payload_sha256: string
  first_seen_at: string
}

type ExistingAddress = {
  id: string
  outage_external_id: string
  address_key: string
  payload_sha256: string
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return 'Celoplošná kontrola obce ČEZ selhala.'
}

function retryDelay(attemptCount: number) {
  if (attemptCount <= 1) return 15 * 60_000
  if (attemptCount === 2) return 60 * 60_000
  return 6 * 60 * 60_000
}

function uniqueOutages(outages: CezOutage[]) {
  return [...new Map(outages.map((outage) => [String(outage.id), outage])).values()]
}

async function updateAttempt(
  candidate: ScanCandidate,
  values: Record<string, unknown>,
) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro celoplošný sken ČEZ.')
  const { error } = await client
    .from('complete_power_outage_cez_scan_attempts')
    .update(values)
    .eq('cycle_id', candidate.cycle_id)
    .eq('municipality_code', candidate.municipality_code)
    .eq('attempt_number', candidate.attempt_number)
    .eq('status', 'running')
  if (error) throw error
}

async function updateMunicipality(
  candidate: ScanCandidate,
  values: Record<string, unknown>,
) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro celoplošný sken ČEZ.')
  const { data, error } = await client
    .from('complete_power_outage_cez_municipalities')
    .update({
      ...values,
      scan_lock_token: null,
      scan_lock_expires_at: null,
    })
    .eq('municipality_code', candidate.municipality_code)
    .eq('scan_status', 'processing')
    .eq('scan_lock_token', candidate.scan_lock_token)
    .select('municipality_code')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`Skenovací zámek obce ${candidate.municipality_code} již není platný.`)
}

async function saveStagingResult(
  candidate: ScanCandidate,
  normalized: NormalizedPowerOutage[],
) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro celoplošný sken ČEZ.')

  const now = new Date().toISOString()
  const externalIds = normalized.map((outage) => outage.externalId)
  let existingOutages: ExistingOutage[] = []
  let existingAddresses: ExistingAddress[] = []

  if (externalIds.length > 0) {
    const { data: outageRows, error: outageError } = await client
      .from('complete_power_outage_cez_staged_outages')
      .select('external_id,payload_sha256,first_seen_at')
      .in('external_id', externalIds)
    if (outageError) throw outageError
    existingOutages = (outageRows ?? []) as ExistingOutage[]

    const { data: addressRows, error: addressError } = await client
      .from('complete_power_outage_cez_staged_addresses')
      .select('id,outage_external_id,address_key,payload_sha256')
      .in('outage_external_id', externalIds)
    if (addressError) throw addressError
    existingAddresses = (addressRows ?? []) as ExistingAddress[]
  }

  const oldOutageHashes = new Map(
    existingOutages.map((outage) => [outage.external_id, outage.payload_sha256]),
  )
  const firstSeenByOutage = new Map(
    existingOutages.map((outage) => [outage.external_id, outage.first_seen_at]),
  )
  const oldAddressHashes = new Map(
    existingAddresses.map((address) => [
      `${address.outage_external_id}:${address.address_key}`,
      address.payload_sha256,
    ]),
  )

  const outageRows = normalized.map((outage) => ({
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
    first_seen_at: firstSeenByOutage.get(outage.externalId) ?? now,
    last_seen_at: now,
    last_seen_cycle_id: candidate.cycle_id,
    missing_since: null,
    metadata: {
      ...outage.metadata,
      completeCezScan: {
        cycleId: candidate.cycle_id,
        municipalityCode: candidate.municipality_code,
        municipalityName: candidate.municipality_name,
        inspectedAddressId: candidate.cez_address_id,
        inspectedAt: now,
      },
    },
  }))

  if (outageRows.length > 0) {
    const { error } = await client
      .from('complete_power_outage_cez_staged_outages')
      .upsert(outageRows, { onConflict: 'external_id' })
    if (error) throw error
  }

  const addressRows = normalized.flatMap((outage) => outage.addresses.map((address) => ({
    outage_external_id: outage.externalId,
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
    payload_sha256: powerOutageSha256(address),
    metadata: address.metadata,
  })))

  if (addressRows.length > 0) {
    const { error } = await client
      .from('complete_power_outage_cez_staged_addresses')
      .upsert(addressRows, { onConflict: 'outage_external_id,address_key' })
    if (error) throw error
  }

  const replacementAddressHashes = new Map(addressRows.map((row) => [
    `${row.outage_external_id}:${row.address_key}`,
    row.payload_sha256,
  ]))
  const changedExistingAddressIds = existingAddresses
    .filter((address) => {
      const replacementHash = replacementAddressHashes.get(
        `${address.outage_external_id}:${address.address_key}`,
      )
      return replacementHash && replacementHash !== address.payload_sha256
    })
    .map((address) => address.id)
  if (changedExistingAddressIds.length > 0) {
    const { error } = await client
      .from('complete_power_outage_cez_staged_addresses')
      .update({
        normalization_version: 0,
        normalization_status: 'pending',
        normalized_at: null,
        normalization_next_attempt_at: null,
        normalization_error_code: null,
        normalization_error_message: null,
        normalization_lock_token: null,
        normalization_lock_expires_at: null,
      })
      .in('id', changedExistingAddressIds)
    if (error) throw error
  }

  const currentAddressKeys = new Set(
    addressRows.map((address) => `${address.outage_external_id}:${address.address_key}`),
  )
  const staleAddressIds = existingAddresses
    .filter((address) => !currentAddressKeys.has(`${address.outage_external_id}:${address.address_key}`))
    .map((address) => address.id)
  if (staleAddressIds.length > 0) {
    const { error } = await client
      .from('complete_power_outage_cez_staged_addresses')
      .delete()
      .in('id', staleAddressIds)
    if (error) throw error
  }

  const changedOutageCount = normalized.filter(
    (outage) => oldOutageHashes.get(outage.externalId) !== outage.payloadSha256,
  ).length
  const changedAddressCount = addressRows.filter(
    (address) => oldAddressHashes.get(`${address.outage_external_id}:${address.address_key}`)
      !== address.payload_sha256,
  ).length + staleAddressIds.length

  return { addressCount: addressRows.length, changedOutageCount, changedAddressCount }
}

export async function scanCompleteCezMunicipalities(
  requestedLimit = 3,
  pilot = true,
) {
  if (!pilot) {
    throw new Error('Plný celoplošný sken ČEZ zatím není aktivován; povolen je pouze pilot.')
  }
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro celoplošný sken ČEZ.')
  const limit = Math.min(20, Math.max(1, Math.trunc(requestedLimit)))
  const { data, error } = await client.rpc('claim_complete_power_outage_cez_scan_batch', {
    requested_limit: limit,
    requested_pilot: true,
  })
  if (error) throw error
  const claimed = (data ?? []) as ScanCandidate[]
  if (claimed.length === 0) {
    return {
      status: 'no_change' as const,
      pilot: true,
      processedCount: 0,
      succeededCount: 0,
      noChangeCount: 0,
      errorCount: 0,
      exactOutageCount: 0,
      townOutageCount: 0,
      uniqueOutageCount: 0,
      addressCount: 0,
      changedOutageCount: 0,
      changedAddressCount: 0,
    }
  }

  const cycleId = claimed[0].cycle_id
  let succeededCount = 0
  let noChangeCount = 0
  let errorCount = 0
  let exactOutageCount = 0
  let townOutageCount = 0
  let uniqueOutageCount = 0
  let addressCount = 0
  let changedOutageCount = 0
  let changedAddressCount = 0

  for (const candidate of claimed) {
    const attemptedAt = new Date().toISOString()
    try {
      const inspection = await inspectCezAddress(Number(candidate.cez_address_id))
      const exact = inspection.outages ?? []
      const town = inspection.outages_in_town ?? []
      const sourceOutages = uniqueOutages([...exact, ...town])
      const normalized = sourceOutages.map((outage) => normalizeCezOutage(outage))
      const payloadSha256 = powerOutageSha256(
        normalized.map((outage) => outage.payloadSha256).sort(),
      )
      const saved = await saveStagingResult(candidate, normalized)
      const changed = saved.changedOutageCount > 0 || saved.changedAddressCount > 0

      exactOutageCount += exact.length
      townOutageCount += town.length
      uniqueOutageCount += normalized.length
      addressCount += saved.addressCount
      changedOutageCount += saved.changedOutageCount
      changedAddressCount += saved.changedAddressCount
      if (changed) succeededCount += 1
      else noChangeCount += 1

      await updateAttempt(candidate, {
        status: changed ? 'succeeded' : 'no_change',
        finished_at: new Date().toISOString(),
        exact_outage_count: exact.length,
        town_outage_count: town.length,
        unique_outage_count: normalized.length,
        address_count: saved.addressCount,
        payload_sha256: payloadSha256,
        error_code: null,
        error_message: null,
        metadata: {
          contract: 'complete-cez-municipality-scan-v1',
          changedOutageCount: saved.changedOutageCount,
          changedAddressCount: saved.changedAddressCount,
        },
      })
      await updateMunicipality(candidate, {
        scan_status: changed ? 'succeeded' : 'no_change',
        scan_last_attempt_at: attemptedAt,
        scan_last_success_at: new Date().toISOString(),
        scan_last_change_at: changed ? new Date().toISOString() : undefined,
        scan_next_attempt_at: new Date(Date.now() + 6 * 60 * 60_000).toISOString(),
        scan_error_code: null,
        scan_error_message: null,
        latest_payload_sha256: payloadSha256,
        latest_outage_count: normalized.length,
        latest_address_count: saved.addressCount,
      })
    } catch (scanError) {
      errorCount += 1
      const terminal = candidate.scan_attempt_count >= 3
      const message = errorMessage(scanError).slice(0, 2_000)
      try {
        await updateAttempt(candidate, {
          status: 'failed',
          finished_at: new Date().toISOString(),
          error_code: terminal ? 'CEZ_SCAN_RETRIES_EXHAUSTED' : 'CEZ_SCAN_FAILED',
          error_message: message,
          metadata: { contract: 'complete-cez-municipality-scan-v1' },
        })
        await updateMunicipality(candidate, {
          scan_status: terminal ? 'needs_review' : 'error',
          scan_last_attempt_at: attemptedAt,
          scan_next_attempt_at: terminal
            ? null
            : new Date(Date.now() + retryDelay(candidate.scan_attempt_count)).toISOString(),
          scan_error_code: terminal ? 'CEZ_SCAN_RETRIES_EXHAUSTED' : 'CEZ_SCAN_FAILED',
          scan_error_message: message,
        })
      } catch {
        // Expirovaný zámek bezpečně obnoví další claim; chyba jedné obce nezastaví dávku.
      }
    }
    // ČEZ používá stejné veřejné rozhraní také pro MARKETY, proto pilot nevytváří bursty.
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }

  const { data: finalStatus, error: finishError } = await client.rpc(
    'finish_complete_power_outage_cez_scan_cycle',
    { requested_cycle_id: cycleId },
  )
  if (finishError) throw finishError

  return {
    status: String(finalStatus ?? (errorCount > 0 ? 'partial' : 'succeeded')),
    cycleId,
    pilot: true,
    processedCount: claimed.length,
    succeededCount,
    noChangeCount,
    errorCount,
    exactOutageCount,
    townOutageCount,
    uniqueOutageCount,
    addressCount,
    changedOutageCount,
    changedAddressCount,
  }
}
