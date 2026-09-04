import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import {
  loadCompleteCezRuianMunicipalityAddressPoints,
  type CompleteCezRuianAddressPoint,
} from './complete-cez-ruian'
import { inspectCezAddress, type CezOutage } from './cez-source'
import { normalizePowerOutageText, powerOutageSha256 } from './normalization'
import { cezAnnouncementUrl } from './public-links'

type PilotCandidate = {
  run_id: string
  case_id: string
  municipality_code: string
  municipality_name: string
  sample_kind: string
  primary_address_id: number
  primary_address_code: string
  primary_town_part: string | null
  primary_street: string | null
  primary_sjtsk_y: number | null
  primary_sjtsk_x: number | null
  lock_token: string
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return 'Ověření úplnosti městského seznamu ČEZ selhalo.'
}

function normalized(value: string | null | undefined) {
  return normalizePowerOutageText(value ?? '')
}

function distanceSquared(
  point: CompleteCezRuianAddressPoint,
  candidate: PilotCandidate,
) {
  if (
    point.sjtskY == null
    || point.sjtskX == null
    || candidate.primary_sjtsk_y == null
    || candidate.primary_sjtsk_x == null
  ) return 0
  const dy = point.sjtskY - candidate.primary_sjtsk_y
  const dx = point.sjtskX - candidate.primary_sjtsk_x
  return dy * dy + dx * dx
}

function chooseSecondaryAddress(
  points: CompleteCezRuianAddressPoint[],
  candidate: PilotCandidate,
) {
  const primaryTownPart = normalized(candidate.primary_town_part)
  const primaryStreet = normalized(candidate.primary_street)
  return points
    .filter((point) => point.addressCode !== candidate.primary_address_code)
    .sort((left, right) => {
      const leftDifferentTownPart = normalized(left.townPart) !== primaryTownPart ? 1 : 0
      const rightDifferentTownPart = normalized(right.townPart) !== primaryTownPart ? 1 : 0
      if (leftDifferentTownPart !== rightDifferentTownPart) {
        return rightDifferentTownPart - leftDifferentTownPart
      }
      const leftDifferentStreet = normalized(left.street) !== primaryStreet ? 1 : 0
      const rightDifferentStreet = normalized(right.street) !== primaryStreet ? 1 : 0
      if (leftDifferentStreet !== rightDifferentStreet) {
        return rightDifferentStreet - leftDifferentStreet
      }
      return distanceSquared(right, candidate) - distanceSquared(left, candidate)
    })[0] ?? null
}

function uniqueTownOutages(outages: CezOutage[] | null | undefined) {
  return [...new Map((outages ?? []).map((outage) => [String(outage.id), outage])).values()]
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
}

function outageIds(outages: CezOutage[]) {
  return outages.map((outage) => String(outage.id))
}

function outagePayloadHash(outages: CezOutage[]) {
  return powerOutageSha256(outages.map((outage) => ({
    id: String(outage.id),
    payload: powerOutageSha256(outage),
  })))
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

async function updatePilotCase(
  candidate: PilotCandidate,
  values: Record<string, unknown>,
) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro ověřovací pilot ČEZ.')
  const { data, error } = await client
    .from('complete_power_outage_cez_town_pilot_cases')
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
  if (!data) throw new Error(`Pilotní zámek obce ${candidate.municipality_code} již není platný.`)
}

export async function runCompleteCezTownPilot(
  requestedSampleCount = 120,
  requestedLimit = 3,
) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro ověřovací pilot ČEZ.')
  const sampleCount = Math.min(200, Math.max(20, Math.trunc(requestedSampleCount)))
  const limit = Math.min(4, Math.max(1, Math.trunc(requestedLimit)))
  const { data, error } = await client.rpc('claim_complete_power_outage_cez_town_pilot_batch', {
    requested_sample_count: sampleCount,
    requested_limit: limit,
  })
  if (error) throw error
  const claimed = (data ?? []) as PilotCandidate[]

  let matchedCount = 0
  let mismatchedCount = 0
  let reviewCount = 0
  let errorCount = 0
  let externalRequestCount = 0

  for (const candidate of claimed) {
    try {
      const ruian = await loadCompleteCezRuianMunicipalityAddressPoints(
        candidate.municipality_code,
      )
      const secondary = chooseSecondaryAddress(ruian.points, candidate)
      if (!secondary) {
        reviewCount += 1
        await updatePilotCase(candidate, {
          status: 'needs_review',
          error_code: 'CEZ_PILOT_SECOND_ADDRESS_MISSING',
          error_message: 'Obec nemá druhé použitelné adresní místo RÚIAN.',
          ruian_source_url: ruian.sourceUrl,
          ruian_source_valid_on: ruian.sourceValidOn,
        })
        continue
      }

      externalRequestCount += 1
      const primaryInspection = await inspectCezAddress(Number(candidate.primary_address_id))
      await new Promise((resolve) => setTimeout(resolve, 900))
      externalRequestCount += 1
      const secondaryInspection = await inspectCezAddress(Number(secondary.addressCode))
      const primaryOutages = uniqueTownOutages(primaryInspection.outages_in_town)
      const secondaryOutages = uniqueTownOutages(secondaryInspection.outages_in_town)
      const primaryIds = outageIds(primaryOutages)
      const secondaryIds = outageIds(secondaryOutages)
      const idsMatch = sameStrings(primaryIds, secondaryIds)
      const primaryHash = outagePayloadHash(primaryOutages)
      const secondaryHash = outagePayloadHash(secondaryOutages)
      const payloadsMatch = primaryHash === secondaryHash
      const status = idsMatch && payloadsMatch ? 'matched' : 'mismatched'
      if (status === 'matched') matchedCount += 1
      else mismatchedCount += 1

      const announcementUrls = [...new Set(
        [...primaryOutages, ...secondaryOutages]
          .map((outage) => cezAnnouncementUrl(outage.announcement_key))
          .filter((value): value is string => Boolean(value)),
      )]

      await updatePilotCase(candidate, {
        status,
        secondary_address_code: secondary.addressCode,
        secondary_address_id: Number(secondary.addressCode),
        secondary_town_part: secondary.townPart,
        secondary_street: secondary.street,
        secondary_house_number: secondary.houseNumber,
        secondary_orientation_number: secondary.orientationNumber,
        primary_outage_count: primaryOutages.length,
        secondary_outage_count: secondaryOutages.length,
        primary_outage_ids: primaryIds,
        secondary_outage_ids: secondaryIds,
        primary_payload_sha256: primaryHash,
        secondary_payload_sha256: secondaryHash,
        outage_ids_match: idsMatch,
        outage_payloads_match: payloadsMatch,
        announcement_urls: announcementUrls,
        ruian_source_url: ruian.sourceUrl,
        ruian_source_valid_on: ruian.sourceValidOn,
        error_code: null,
        error_message: null,
        metadata: {
          contract: 'complete-cez-town-pilot-v1',
          secondarySelection: {
            differentTownPart: normalized(secondary.townPart)
              !== normalized(candidate.primary_town_part),
            differentStreet: normalized(secondary.street)
              !== normalized(candidate.primary_street),
          },
        },
      })
    } catch (pilotError) {
      errorCount += 1
      try {
        await updatePilotCase(candidate, {
          status: 'failed',
          error_code: 'CEZ_TOWN_PILOT_FAILED',
          error_message: errorMessage(pilotError).slice(0, 2_000),
        })
      } catch {
        // Expirovaný zámek obnoví další pilot; chyba jedné obce nezastaví dávku.
      }
    }
    // Dva dotazy jedné obce jdou za sebou, další obec nezačíná okamžitě.
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }

  let runId = claimed[0]?.run_id ?? null
  if (!runId) {
    const { data: activeRun, error: activeRunError } = await client
      .from('complete_power_outage_cez_town_pilot_runs')
      .select('id')
      .eq('status', 'running')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>()
    if (activeRunError) throw activeRunError
    runId = activeRun?.id ?? null
  }
  let runStatus = 'no_change'
  if (runId) {
    const { data: finalized, error: finalizationError } = await client.rpc(
      'finish_complete_power_outage_cez_town_pilot_run',
      { requested_run_id: runId },
    )
    if (finalizationError) throw finalizationError
    runStatus = String(finalized ?? 'running')
  }

  return {
    status: runStatus,
    runId,
    sampleCount,
    processedCount: claimed.length,
    matchedCount,
    mismatchedCount,
    reviewCount,
    errorCount,
    externalRequestCount,
  }
}
