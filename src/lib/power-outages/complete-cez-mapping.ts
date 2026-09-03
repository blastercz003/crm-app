import 'server-only'

import {
  searchCezAddresses,
  type CezAddress,
} from './cez-source'
import { normalizePowerOutageText } from './normalization'
import { getServiceRoleClient } from '@/lib/supabase/service'

type MappingCandidate = {
  municipality_code: string
  municipality_name: string
  representative_address_code: string
  representative_street: string | null
  representative_house_number: string
  representative_orientation_number: string | null
  representative_postal_code: string | null
  mapping_attempt_count: number
  mapping_lock_token: string
  metadata: Record<string, unknown> | null
}

function text(value: string | number | null | undefined) {
  return value == null ? '' : String(value).trim()
}

function same(left: string | number | null | undefined, right: string | number | null | undefined) {
  return Boolean(text(left) && normalizePowerOutageText(text(left)) === normalizePowerOutageText(text(right)))
}

function representativeTownPart(candidate: MappingCandidate) {
  const imported = candidate.metadata?.ruianAddressImport
  if (!imported || typeof imported !== 'object' || !('townPart' in imported)) return null
  const townPart = (imported as { townPart?: unknown }).townPart
  return typeof townPart === 'string' && townPart.trim() ? townPart.trim() : null
}

function mappingQuery(candidate: MappingCandidate) {
  const number = candidate.representative_orientation_number
    ? `${candidate.representative_house_number}/${candidate.representative_orientation_number}`
    : candidate.representative_house_number
  const locality = representativeTownPart(candidate) ?? candidate.municipality_name
  return [
    [candidate.representative_street ?? locality, number].filter(Boolean).join(' '),
    candidate.municipality_name,
    candidate.representative_postal_code,
  ].filter(Boolean).join(', ')
}

function chooseMappedAddress(candidates: CezAddress[], target: MappingCandidate) {
  const representativeId = Number(target.representative_address_code)
  const exactId = candidates.find((candidate) => candidate.id === representativeId)
  if (exactId) return { address: exactId, matchKind: 'ruian_address_id' as const }

  const targetTownPart = representativeTownPart(target)
  const townCandidates = candidates.filter((candidate) => (
    String(candidate.townCode) === target.municipality_code
    || same(candidate.town, target.municipality_name)
  ))
  const scored = townCandidates.map((candidate) => {
    const streetMatches = target.representative_street
      ? same(candidate.street, target.representative_street)
      : true
    const houseMatches = same(candidate.houseNum, target.representative_house_number)
    const orientationMatches = target.representative_orientation_number
      ? same(candidate.streetNum, target.representative_orientation_number)
      : true
    const townPartMatches = targetTownPart ? same(candidate.townPart, targetTownPart) : true
    return {
      candidate,
      streetMatches,
      houseMatches,
      orientationMatches,
      townPartMatches,
      score: (String(candidate.townCode) === target.municipality_code ? 100 : 0)
        + (streetMatches ? 30 : 0)
        + (houseMatches ? 20 : 0)
        + (orientationMatches ? 10 : 0)
        + (townPartMatches ? 5 : 0),
    }
  }).sort((left, right) => right.score - left.score || left.candidate.id - right.candidate.id)

  const selected = scored[0]
  if (
    !selected
    || !selected.streetMatches
    || !selected.houseMatches
    || !selected.orientationMatches
    || !selected.townPartMatches
  ) {
    return null
  }
  return { address: selected.candidate, matchKind: 'address_fields' as const }
}

function distribution(address: CezAddress) {
  const normalized = normalizePowerOutageText(address.dso)
  if (normalized.includes('cez')) return 'cez' as const
  // Veřejný adresní endpoint ČEZ vrací pro přesné adresy v území EG.D/PRE
  // prázdné dso; na adresách ČEZ používá hodnotu CEZd.
  if (!normalized) return 'not_cez' as const
  if (
    normalized.includes('egd')
    || normalized.includes('eon')
    || normalized.includes('predistribuce')
    || normalized === 'pre'
  ) return 'not_cez' as const
  return 'unknown' as const
}

function retryDelay(attemptCount: number) {
  if (attemptCount <= 1) return 15 * 60_000
  if (attemptCount === 2) return 60 * 60_000
  return 6 * 60 * 60_000
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message
  }
  return 'Mapování adresy na ČEZ selhalo.'
}

async function updateClaimedCandidate(
  candidate: MappingCandidate,
  values: Record<string, unknown>,
) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro mapování ČEZ.')
  const { data, error } = await client
    .from('complete_power_outage_cez_municipalities')
    .update({
      ...values,
      mapping_lock_token: null,
      mapping_lock_expires_at: null,
    })
    .eq('municipality_code', candidate.municipality_code)
    .eq('mapping_status', 'processing')
    .eq('mapping_lock_token', candidate.mapping_lock_token)
    .select('municipality_code')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error(`Mapovací zámek obce ${candidate.municipality_code} již není platný.`)
}

export async function mapCompleteCezMunicipalities(requestedLimit = 5) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro mapování ČEZ.')
  const limit = Math.min(25, Math.max(1, Math.trunc(requestedLimit)))
  const { data, error } = await client.rpc('claim_complete_power_outage_cez_mapping_batch', {
    requested_limit: limit,
  })
  if (error) throw error
  const claimed = (data ?? []) as MappingCandidate[]

  let resolvedCount = 0
  let outsideCezCount = 0
  let reviewCount = 0
  let errorCount = 0

  for (const candidate of claimed) {
    const attemptedAt = new Date().toISOString()
    try {
      const query = mappingQuery(candidate)
      const candidates = await searchCezAddresses(query)
      const selected = chooseMappedAddress(candidates, candidate)
      if (!selected) {
        reviewCount += 1
        await updateClaimedCandidate(candidate, {
          mapping_status: 'needs_review',
          distribution_status: 'needs_review',
          mapping_last_attempt_at: attemptedAt,
          mapping_next_attempt_at: null,
          mapping_error_code: 'CEZ_ADDRESS_NOT_MATCHED',
          mapping_error_message: `ČEZ nenalezl jednoznačnou shodu pro dotaz „${query}“ (${candidates.length} kandidátů).`,
          scan_status: 'disabled',
          metadata: {
            ...(candidate.metadata ?? {}),
            cezMapping: { attemptedAt, query, candidateCount: candidates.length },
          },
        })
      } else {
        const mappedDistribution = distribution(selected.address)
        const isCez = mappedDistribution === 'cez'
        if (isCez) resolvedCount += 1
        else if (mappedDistribution === 'not_cez') outsideCezCount += 1
        else reviewCount += 1
        await updateClaimedCandidate(candidate, {
          mapping_status: isCez
            ? 'resolved'
            : mappedDistribution === 'not_cez'
              ? 'not_cez'
              : 'needs_review',
          distribution_status: isCez
            ? 'cez'
            : mappedDistribution === 'not_cez'
              ? 'not_cez'
              : 'needs_review',
          cez_address_id: selected.address.id,
          cez_town_code: selected.address.townCode,
          cez_town_name: selected.address.town,
          cez_town_part: selected.address.townPart ?? null,
          district_name: selected.address.district ?? null,
          region_name: selected.address.region ?? null,
          mapping_last_attempt_at: attemptedAt,
          mapping_last_success_at: attemptedAt,
          mapping_next_attempt_at: null,
          mapping_error_code: mappedDistribution === 'unknown' ? 'CEZ_DSO_UNKNOWN' : null,
          mapping_error_message: mappedDistribution === 'unknown'
            ? 'ČEZ vrátil adresu bez rozpoznatelného distributora.'
            : null,
          scan_status: isCez ? 'pending' : 'disabled',
          metadata: {
            ...(candidate.metadata ?? {}),
            cezMapping: {
              attemptedAt,
              query,
              candidateCount: candidates.length,
              matchKind: selected.matchKind,
              selectedDso: selected.address.dso ?? null,
            },
          },
        })
      }
    } catch (mappingError) {
      errorCount += 1
      const terminal = candidate.mapping_attempt_count >= 3
      const message = errorMessage(mappingError).slice(0, 2_000)
      try {
        await updateClaimedCandidate(candidate, {
          mapping_status: terminal ? 'needs_review' : 'error',
          distribution_status: terminal ? 'needs_review' : 'unknown',
          cez_address_id: null,
          cez_town_code: null,
          mapping_last_attempt_at: attemptedAt,
          mapping_next_attempt_at: terminal
            ? null
            : new Date(Date.now() + retryDelay(candidate.mapping_attempt_count)).toISOString(),
          mapping_error_code: terminal ? 'CEZ_MAPPING_RETRIES_EXHAUSTED' : 'CEZ_MAPPING_FAILED',
          mapping_error_message: message,
          scan_status: 'disabled',
          metadata: {
            ...(candidate.metadata ?? {}),
            cezMapping: { attemptedAt, query: mappingQuery(candidate), error: message },
          },
        })
      } catch {
        // Zámek má omezenou platnost a další claim případný nedokončený řádek obnoví.
      }
    }
    // Stejné veřejné rozhraní využívá i MARKETY; krok 3 proto nevytváří bursty.
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }

  const { count: remainingCount, error: countError } = await client
    .from('complete_power_outage_cez_municipalities')
    .select('municipality_code', { count: 'exact', head: true })
    .eq('is_active', true)
    .eq('representative_status', 'resolved')
    .in('mapping_status', ['pending', 'processing', 'error'])
  if (countError) throw countError

  return {
    status: errorCount > 0 || reviewCount > 0 ? 'partial' as const : 'succeeded' as const,
    processedCount: claimed.length,
    resolvedCount,
    outsideCezCount,
    reviewCount,
    errorCount,
    remainingCount: remainingCount ?? 0,
  }
}
