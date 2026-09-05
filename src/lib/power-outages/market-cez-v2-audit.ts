import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { inspectCezAddress, type CezOutage } from './cez-source'
import { normalizeCezOutage } from './cez-normalizer'

type AuditCandidate = {
  run_id: string
  case_id: string
  address_id: number
  municipality: string
  street: string
  house_number: string | null
  orientation_number: string | null
  store_ids: unknown
  lock_token: string
}

type ProductionOutage = { id: string; external_id: string }
type ProductionMatch = { outage_id: string; store_id: string | null; match_status: string }

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return 'Audit adresy ČEZ v2 selhal.'
}

function outageIds(outages: CezOutage[] | null | undefined) {
  return [...new Set((outages ?? []).map((outage) => String(outage.id)))].sort()
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))]
    : []
}

function missingOutageDetails(input: {
  exactOutages: CezOutage[]
  townOutages: CezOutage[]
  missingIds: string[]
}) {
  const missing = new Set(input.missingIds)
  const exact = new Set(outageIds(input.exactOutages))
  const town = new Set(outageIds(input.townOutages))
  const unique = new Map<string, CezOutage>()
  for (const outage of [...input.exactOutages, ...input.townOutages]) {
    const id = String(outage.id)
    if (missing.has(id)) unique.set(id, outage)
  }
  return [...unique.entries()].map(([externalId, outage]) => {
    const normalized = normalizeCezOutage(outage)
    return {
      externalId,
      returnedForExactAddress: exact.has(externalId),
      returnedForTown: town.has(externalId),
      startsAt: normalized.startsAt,
      endsAt: normalized.endsAt,
      municipality: normalized.municipality,
      municipalityCode: normalized.municipalityCode,
      announcementUrl: normalized.announcementUrl,
      sourceUrl: normalized.sourceUrl,
      addresses: normalized.addresses.map((address) => ({
        municipality: address.municipality,
        municipalityCode: address.municipalityCode,
        townPart: address.townPart,
        street: address.street,
        rawAddress: address.rawAddress,
        houseNumbers: address.metadata.houseNumbers ?? null,
        evidenceNumbers: address.metadata.evidenceNumbers ?? null,
        orientationNumbers: address.metadata.orientationNumbers ?? null,
      })),
    }
  })
}

async function finishCase(
  candidate: AuditCandidate,
  values: Record<string, unknown>,
) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro audit ČEZ v2.')
  const { data, error } = await client
    .from('power_outage_cez_market_v2_audit_cases')
    .update({
      ...values,
      lock_token: null,
      lock_expires_at: null,
      finished_at: new Date().toISOString(),
    })
    .eq('id', candidate.case_id)
    .eq('status', 'running')
    .eq('lock_token', candidate.lock_token)
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`Auditní zámek adresy ${candidate.address_id} již není platný.`)
}

export async function runMarketCezV2Audit(
  requestedSampleCount = 120,
  requestedLimit = 3,
  requestedRunId: string | null = null,
) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro audit ČEZ v2.')
  const sampleCount = Math.min(2_000, Math.max(20, Math.trunc(requestedSampleCount)))
  const limit = Math.min(5, Math.max(1, Math.trunc(requestedLimit)))
  const { data, error } = requestedRunId
    ? await client.rpc('claim_power_outage_cez_market_v2_audit_continuation', {
        requested_run_id: requestedRunId,
        requested_limit: limit,
      })
    : await client.rpc('claim_power_outage_cez_market_v2_audit_batch', {
        requested_sample_count: sampleCount,
        requested_limit: limit,
      })
  if (error) throw error
  const claimed = (data ?? []) as AuditCandidate[]

  let successCount = 0
  let errorCount = 0
  let riskCaseCount = 0

  for (const candidate of claimed) {
    try {
      const storeIds = stringArray(candidate.store_ids)
      const inspection = await inspectCezAddress(Number(candidate.address_id))
      const exactIds = outageIds(inspection.outages)
      const townIds = outageIds(inspection.outages_in_town)
      const unionIds = [...new Set([...exactIds, ...townIds])].sort()

      let productionOutages: ProductionOutage[] = []
      if (unionIds.length > 0) {
        const { data: outageRows, error: outageError } = await client
          .from('power_outages')
          .select('id,external_id')
          .eq('source', 'cez')
          .in('external_id', unionIds)
        if (outageError) throw outageError
        productionOutages = (outageRows ?? []) as ProductionOutage[]
      }

      const productionByExternalId = new Map(
        productionOutages.map((row) => [row.external_id, row.id]),
      )
      const productionLoadedIds = unionIds.filter((id) => productionByExternalId.has(id))
      const missingLoadedIds = unionIds.filter((id) => !productionByExternalId.has(id))
      const missingExactIds = exactIds.filter((id) => !productionByExternalId.has(id))
      const missingDetails = missingOutageDetails({
        exactOutages: inspection.outages ?? [],
        townOutages: inspection.outages_in_town ?? [],
        missingIds: missingLoadedIds,
      })

      const exactProductionOutageIds = exactIds
        .map((id) => productionByExternalId.get(id))
        .filter((id): id is string => Boolean(id))
      let productionMatches: ProductionMatch[] = []
      if (storeIds.length > 0 && exactProductionOutageIds.length > 0) {
        const { data: matchRows, error: matchError } = await client
          .from('power_outage_store_matches')
          .select('outage_id,store_id,match_status')
          .in('store_id', storeIds)
          .in('outage_id', exactProductionOutageIds)
        if (matchError) throw matchError
        productionMatches = (matchRows ?? []) as ProductionMatch[]
      }

      const productionMatchPairs = productionMatches
        .filter((match) => match.store_id && match.match_status !== 'dismissed')
        .map((match) => {
          const externalId = productionOutages.find((outage) => outage.id === match.outage_id)?.external_id
          return externalId ? `${match.store_id}:${externalId}` : null
        })
        .filter((pair): pair is string => Boolean(pair))
        .sort()
      const productionMatchSet = new Set(productionMatchPairs)
      const expectedMatchPairs = storeIds.flatMap((storeId) => (
        exactIds.map((externalId) => `${storeId}:${externalId}`)
      ))
      const missingStoreMatchPairs = expectedMatchPairs
        .filter((pair) => !productionMatchSet.has(pair))
        .sort()
      const riskDetected = missingExactIds.length > 0 || missingStoreMatchPairs.length > 0
      if (riskDetected) riskCaseCount += 1

      await finishCase(candidate, {
        status: 'succeeded',
        exact_outage_ids: exactIds,
        town_outage_ids: townIds,
        union_outage_ids: unionIds,
        production_loaded_outage_ids: productionLoadedIds,
        missing_loaded_outage_ids: missingLoadedIds,
        missing_exact_outage_ids: missingExactIds,
        missing_outage_details: missingDetails,
        production_match_pairs: productionMatchPairs,
        missing_store_match_pairs: missingStoreMatchPairs,
        risk_detected: riskDetected,
        error_code: null,
        error_message: null,
        metadata: {
          contract: 'cez-market-v2-read-only-full-audit-v2',
          productionWritesMade: false,
          directExactOutageCount: exactIds.length,
          directTownOutageCount: townIds.length,
        },
      })
      successCount += 1
    } catch (auditError) {
      errorCount += 1
      try {
        await finishCase(candidate, {
          status: 'failed',
          risk_detected: false,
          error_code: 'CEZ_V2_AUDIT_CASE_FAILED',
          error_message: errorMessage(auditError).slice(0, 2_000),
        })
      } catch {
        // Expirovaný zámek bezpečně převezme další dávka.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }

  let runId: string | null = claimed[0]?.run_id ?? requestedRunId
  if (!runId) {
    const { data: activeRun, error: activeRunError } = await client
      .from('power_outage_cez_market_v2_audit_runs')
      .select('id')
      .eq('status', 'running')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>()
    if (activeRunError) throw activeRunError
    runId = activeRun?.id ?? null
  }

  let status = 'no_change'
  if (runId) {
    const { data: finalized, error: finalizationError } = await client.rpc(
      'finish_power_outage_cez_market_v2_audit_run',
      { requested_run_id: runId },
    )
    if (finalizationError) throw finalizationError
    status = String(finalized ?? 'running')
  }

  return {
    status,
    runId,
    sampleCount,
    processedCount: claimed.length,
    successCount,
    errorCount,
    riskCaseCount,
    externalRequestCount: claimed.length,
  }
}
