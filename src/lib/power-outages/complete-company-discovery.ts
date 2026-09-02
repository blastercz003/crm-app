import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { powerOutageErrorMessage } from './error-message'
import { normalizePowerOutageText, powerOutageSha256 } from './normalization'
import { claimCompletePowerOutageTask, finishCompletePowerOutageTask } from './complete-task-lock'
import {
  cacheSafeCandidates,
  discoverCompanies,
  providerAcceptsTarget,
  providerConfigured,
  providerLookupKind,
  PROVIDER_LIMITS,
  type CompleteCompanyCandidate,
  type CompleteDiscoveryProvider,
  type CompleteDiscoveryTarget,
} from './complete-company-providers'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type TargetRow = {
  id: string
  outage_address_id: string
  target_kind: CompleteDiscoveryTarget['targetKind']
  municipality: string
  town_part: string | null
  street: string
  number_token: string | null
  query_text: string
  latitude: number | string | null
  longitude: number | string | null
}

type CacheRow = {
  id: string
  lookup_status: 'ready' | 'not_found' | 'error'
  normalized_results: unknown
  expires_at: string | null
  next_attempt_at: string | null
  attempt_count: number
}

type ExistingCompany = {
  id: string
  candidate_key: string
  entity_kind: 'registered_office' | 'establishment' | 'mixed'
  company_name: string
  ico: string | null
  legal_form: string | null
  nace_codes: string[]
  display_address: string | null
  latitude: number | string | null
  longitude: number | string | null
  confidence: number | string
  candidate_status: 'new' | 'confirmed' | 'needs_review' | 'dismissed' | 'stale'
  normalized_company_name: string
  resolved_by: string | null
  first_seen_at: string
  last_seen_at: string
  last_verified_at: string
  metadata: Record<string, unknown> | null
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function taskKey(provider: CompleteDiscoveryProvider) {
  return `discover_${provider}` as const
}

function targetInput(row: TargetRow): CompleteDiscoveryTarget {
  return {
    targetKind: row.target_kind,
    queryText: row.query_text,
    municipality: row.municipality,
    townPart: row.town_part,
    street: row.street,
    numberToken: row.number_token,
    latitude: finiteNumber(row.latitude),
    longitude: finiteNumber(row.longitude),
  }
}

function lookupIdentity(provider: CompleteDiscoveryProvider, target: TargetRow) {
  const lookupKind = providerLookupKind(provider)
  const lookupKey = powerOutageSha256({
    provider,
    lookupKind,
    query: normalizePowerOutageText(target.query_text),
    latitude: finiteNumber(target.latitude),
    longitude: finiteNumber(target.longitude),
  })
  const requestFingerprint = powerOutageSha256({
    contract: `complete-company-${provider}-v1`,
    lookupKind,
    lookupKey,
  })
  return { lookupKind, lookupKey, requestFingerprint }
}

function cachedCandidates(value: unknown) {
  return Array.isArray(value) ? value as CompleteCompanyCandidate[] : []
}

async function claimProviderQuota(client: ServiceClient, provider: CompleteDiscoveryProvider) {
  const limits = PROVIDER_LIMITS[provider]
  const { data, error } = await client.rpc('claim_complete_power_outage_provider_quota', {
    requested_provider: provider,
    requested_minute_limit: limits.minute,
    requested_day_limit: limits.day,
  })
  if (error) throw error
  return data === true
}

async function loadTargets(client: ServiceClient, provider: CompleteDiscoveryProvider, limit: number) {
  // Databázová funkce vybere pouze skutečně nezpracované cíle a prokládá
  // ČEZ, EG.D a PRE po jednom. Větší načtená dávka dovolí odbavit cache bez
  // spotřeby externí kvóty; `limit` níže omezuje jen nové externí požadavky.
  const scanLimit = Math.min(5000, Math.max(300, limit * 20))
  const { data, error } = await client.rpc('get_complete_power_outage_discovery_targets', {
    requested_provider: provider,
    requested_limit: scanLimit,
  })
  if (error) throw error
  return (data ?? []) as TargetRow[]
}

async function loadCache(
  client: ServiceClient,
  provider: CompleteDiscoveryProvider,
  lookupKind: string,
  lookupKey: string,
) {
  const { data, error } = await client
    .from('complete_power_outage_lookup_cache')
    .select('id,lookup_status,normalized_results,expires_at,next_attempt_at,attempt_count')
    .eq('provider', provider)
    .eq('lookup_kind', lookupKind)
    .eq('lookup_key', lookupKey)
    .maybeSingle<CacheRow>()
  if (error) throw error
  if (!data) return null
  if (data.lookup_status === 'error') return null
  if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) return null
  return data
}

async function saveLookup(input: {
  client: ServiceClient
  targetId: string
  provider: CompleteDiscoveryProvider
  lookupKind: string
  lookupKey: string
  status: 'ready' | 'not_found' | 'error' | 'skipped'
  cacheId?: string | null
  resultCount?: number
  error?: string | null
  errorCode?: string | null
  metadata?: Record<string, unknown>
}) {
  const now = new Date().toISOString()
  const retryAt = input.status === 'error' ? new Date(Date.now() + 15 * 60_000).toISOString() : null
  const { error } = await input.client.from('complete_power_outage_target_lookups').upsert({
    target_id: input.targetId,
    provider: input.provider,
    lookup_kind: input.lookupKind,
    lookup_key: input.lookupKey,
    lookup_status: input.status,
    cache_id: input.cacheId ?? null,
    result_count: input.resultCount ?? 0,
    attempt_count: 1,
    next_attempt_at: retryAt,
    last_attempt_at: now,
    finished_at: input.status === 'error' ? null : now,
    last_error_code: input.status === 'error'
      ? input.errorCode ?? 'COMPLETE_PROVIDER_LOOKUP_FAILED'
      : null,
    last_error_message: input.status === 'error' ? input.error?.slice(0, 2_000) ?? null : null,
    metadata: input.metadata ?? {},
  }, { onConflict: 'target_id,provider' })
  if (error) throw error
}

async function saveCache(input: {
  client: ServiceClient
  provider: CompleteDiscoveryProvider
  lookupKind: string
  lookupKey: string
  requestFingerprint: string
  candidates: CompleteCompanyCandidate[]
  error?: string | null
}) {
  const safeCandidates = cacheSafeCandidates(input.provider, input.candidates)
  const status: 'ready' | 'not_found' | 'error' = input.error
    ? 'error'
    : safeCandidates.length > 0
      ? 'ready'
      : 'not_found'
  const now = new Date()
  const cacheHours = PROVIDER_LIMITS[input.provider].cacheHours
  const expiresAt = cacheHours ? new Date(now.getTime() + cacheHours * 60 * 60_000).toISOString() : null
  const nextAttemptAt = input.error ? new Date(now.getTime() + 15 * 60_000).toISOString() : null
  const { data, error } = await input.client.from('complete_power_outage_lookup_cache').upsert({
    provider: input.provider,
    lookup_kind: input.lookupKind,
    lookup_key: input.lookupKey,
    request_fingerprint: input.requestFingerprint,
    lookup_status: status,
    response_count: safeCandidates.length,
    response_sha256: safeCandidates.length ? powerOutageSha256(safeCandidates) : null,
    normalized_results: safeCandidates,
    attempt_count: 1,
    fetched_at: now.toISOString(),
    expires_at: expiresAt,
    next_attempt_at: nextAttemptAt,
    last_error_code: input.error ? 'COMPLETE_PROVIDER_LOOKUP_FAILED' : null,
    last_error_message: input.error?.slice(0, 2_000) ?? null,
    metadata: {
      contract: `complete-company-${input.provider}-cache-v1`,
      googleContentStored: false,
    },
  }, { onConflict: 'provider,lookup_kind,lookup_key' }).select('id').single<{ id: string }>()
  if (error) throw error
  return { id: data.id, status, safeCandidates }
}

async function materializeCandidates(input: {
  client: ServiceClient
  provider: CompleteDiscoveryProvider
  target: TargetRow
  candidates: CompleteCompanyCandidate[]
}) {
  const { data, error } = await input.client
    .from('complete_power_outage_companies')
    .select('id,candidate_key,entity_kind,company_name,ico,legal_form,nace_codes,display_address,latitude,longitude,confidence,candidate_status,normalized_company_name,resolved_by,first_seen_at,last_seen_at,last_verified_at,metadata')
    .eq('outage_address_id', input.target.outage_address_id)
  if (error) throw error
  const existing = (data ?? []) as ExistingCompany[]
  const refreshSourceCount = async (companyId: string) => {
    const { data: evidenceRows, error: evidenceCountError } = await input.client
      .from('complete_power_outage_company_evidence')
      .select('provider')
      .eq('company_id', companyId)
    if (evidenceCountError) throw evidenceCountError
    const sourceCount = new Set((evidenceRows ?? []).map((row) => String(row.provider))).size
    const { error: sourceUpdateError } = await input.client
      .from('complete_power_outage_companies')
      .update({ source_count: Math.max(1, sourceCount) })
      .eq('id', companyId)
    if (sourceUpdateError) throw sourceUpdateError
  }
  let companyCount = 0
  let evidenceCount = 0
  for (const candidate of input.candidates) {
    const normalizedName = normalizePowerOutageText(candidate.displayName)
    if (!normalizedName) continue
    const current = existing.find((company) => (
      (candidate.ico && company.ico === candidate.ico)
      || company.normalized_company_name === normalizedName
    ))
    if (input.provider === 'google' && !current) continue
    if (input.provider === 'google' && current) {
      const { error: googleEvidenceError } = await input.client
        .from('complete_power_outage_company_evidence')
        .upsert({
          company_id: current.id,
          provider: input.provider,
          provider_entity_id: candidate.providerEntityId,
          evidence_kind: candidate.entityKind,
          match_level: input.target.target_kind === 'exact_number' ? 'exact_address' : 'nearby',
          display_name: current.company_name,
          display_address: null,
          source_url: `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(candidate.providerEntityId)}`,
          confidence: candidate.confidence,
          payload_sha256: powerOutageSha256({ provider: input.provider, id: candidate.providerEntityId }),
          metadata: { contract: 'google-place-id-corroboration-v1' },
        }, { onConflict: 'company_id,provider,provider_entity_id' })
      if (googleEvidenceError) throw googleEvidenceError
      const { error: resetError } = await input.client
        .from('complete_power_outage_companies')
        .update({ evaluation_version: 0, evaluation_reasons: [], evaluated_at: null })
        .eq('id', current.id)
      if (resetError) throw resetError
      await refreshSourceCount(current.id)
      evidenceCount += 1
      continue
    }
    const candidateKey = current?.candidate_key
      ?? (candidate.ico
        ? `ico:${candidate.ico}`
        : `name:${powerOutageSha256(normalizedName).slice(0, 40)}`)
    const observedAt = new Date().toISOString()
    const { data: company, error: companyError } = await input.client
      .from('complete_power_outage_companies')
      .upsert({
        outage_address_id: input.target.outage_address_id,
        candidate_key: candidateKey,
        entity_kind: current && current.entity_kind !== candidate.entityKind
          ? 'mixed'
          : current?.entity_kind ?? candidate.entityKind,
        company_name: current?.company_name ?? candidate.displayName,
        normalized_company_name: current?.normalized_company_name ?? normalizedName,
        ico: current?.ico ?? candidate.ico,
        legal_form: current?.legal_form ?? candidate.legalForm,
        nace_codes: current?.nace_codes.length ? current.nace_codes : candidate.naceCodes,
        display_address: current?.display_address ?? candidate.displayAddress,
        latitude: finiteNumber(current?.latitude) ?? candidate.latitude,
        longitude: finiteNumber(current?.longitude) ?? candidate.longitude,
        confidence: Math.max(finiteNumber(current?.confidence) ?? 0, candidate.confidence),
        candidate_status: current?.resolved_by ? current.candidate_status : 'new',
        evaluation_version: 0,
        evaluation_reasons: [],
        evaluated_at: null,
        first_seen_at: current?.first_seen_at ?? observedAt,
        last_seen_at: observedAt,
        last_verified_at: observedAt,
        metadata: { ...(current?.metadata ?? {}), discoveryVersion: 1 },
      }, { onConflict: 'outage_address_id,candidate_key' })
      .select('id').single<{ id: string }>()
    if (companyError) throw companyError
    companyCount += current ? 0 : 1
    if (!current) {
      existing.push({
        id: company.id,
        candidate_key: candidateKey,
        entity_kind: candidate.entityKind,
        company_name: candidate.displayName ?? normalizedName,
        ico: candidate.ico,
        legal_form: candidate.legalForm,
        nace_codes: candidate.naceCodes,
        display_address: candidate.displayAddress,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        confidence: candidate.confidence,
        candidate_status: 'new',
        normalized_company_name: normalizedName,
        resolved_by: null,
        first_seen_at: observedAt,
        last_seen_at: observedAt,
        last_verified_at: observedAt,
        metadata: { discoveryVersion: 1 },
      })
    }
    const { error: evidenceError } = await input.client.from('complete_power_outage_company_evidence').upsert({
      company_id: company.id,
      provider: input.provider,
      provider_entity_id: candidate.providerEntityId,
      evidence_kind: candidate.entityKind,
      match_level: input.target.target_kind === 'exact_number' ? 'exact_address' : 'nearby',
      display_name: candidate.displayName,
      display_address: candidate.displayAddress,
      source_url: candidate.sourceUrl,
      confidence: candidate.confidence,
      payload_sha256: powerOutageSha256({ provider: input.provider, id: candidate.providerEntityId }),
      metadata: candidate.metadata,
    }, { onConflict: 'company_id,provider,provider_entity_id' })
    if (evidenceError) throw evidenceError
    await refreshSourceCount(company.id)
    evidenceCount += 1
  }
  return { companyCount, evidenceCount }
}

export async function discoverCompletePowerOutageCompanies(
  provider: CompleteDiscoveryProvider,
  requestedLimit = 5,
) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro dohledávání firem.')
  if (!providerConfigured(provider)) {
    throw new Error(provider === 'mapy' ? 'Na serveru chybí MAPY_API_KEY.' : 'Na serveru chybí GOOGLE_MAPS_API_KEY.')
  }
  const limit = Math.min(PROVIDER_LIMITS[provider].maxPerRun, Math.max(1, Math.trunc(requestedLimit)))
  const lockToken = await claimCompletePowerOutageTask(taskKey(provider), 30 * 60)
  if (!lockToken) return { status: 'skipped' as const, reason: 'already_running' as const }
  const startedAt = new Date().toISOString()
  const staleBefore = new Date(Date.now() - 30 * 60_000).toISOString()
  const { error: staleRunError } = await client.from('complete_power_outage_runs').update({
    status: 'failed', finished_at: startedAt, error_count: 1,
    error_code: 'COMPLETE_COMPANY_DISCOVERY_STALE',
    error_message: 'Předchozí dohledávání firem překročilo bezpečnostní limit 30 minut.',
  }).eq('run_kind', 'company_discovery').eq('provider', provider).eq('status', 'running').lt('started_at', staleBefore)
  if (staleRunError) {
    await finishCompletePowerOutageTask({
      taskKey: taskKey(provider), lockToken, status: 'failed',
      errorCode: 'COMPLETE_COMPANY_STALE_CLEANUP_FAILED', errorMessage: staleRunError.message,
    }).catch(() => undefined)
    throw staleRunError
  }
  const { data: run, error: runError } = await client.from('complete_power_outage_runs').insert({
    run_kind: 'company_discovery', provider, trigger_kind: 'manual', status: 'running',
  }).select('id').single<{ id: string }>()
  if (runError) {
    await finishCompletePowerOutageTask({ taskKey: taskKey(provider), lockToken, status: 'failed', errorMessage: runError.message })
    throw runError
  }

  let processedCount = 0
  let externalRequestCount = 0
  let cacheHitCount = 0
  let companyCount = 0
  let evidenceCount = 0
  let errorCount = 0
  let quotaReached = false
  try {
    const targets = await loadTargets(client, provider, limit)
    for (const target of targets) {
      const identity = lookupIdentity(provider, target)
      if (!providerAcceptsTarget(provider, target.target_kind)) {
        await saveLookup({ client, targetId: target.id, provider, ...identity, status: 'skipped', metadata: { reason: 'target_too_broad' } })
        processedCount += 1
        continue
      }
      const cache = await loadCache(client, provider, identity.lookupKind, identity.lookupKey)
      if (cache) {
        const candidates = cachedCandidates(cache.normalized_results)
        const materialized = await materializeCandidates({ client, provider, target, candidates })
        companyCount += materialized.companyCount
        evidenceCount += materialized.evidenceCount
        cacheHitCount += 1
        processedCount += 1
        await saveLookup({
          client, targetId: target.id, provider, ...identity,
          status: cache.lookup_status, cacheId: cache.id, resultCount: candidates.length,
          metadata: { cacheHit: true },
        })
        continue
      }
      if (externalRequestCount >= limit) break
      if (!await claimProviderQuota(client, provider)) {
        quotaReached = true
        break
      }
      let candidates: CompleteCompanyCandidate[]
      externalRequestCount += 1
      try {
        candidates = await discoverCompanies(provider, targetInput(target))
      } catch (error) {
        errorCount += 1
        const message = powerOutageErrorMessage(error, `${provider.toUpperCase()} lookup selhal.`)
        const savedCache = await saveCache({ client, provider, ...identity, candidates: [], error: message })
        await saveLookup({ client, targetId: target.id, provider, ...identity, status: 'error', cacheId: savedCache.id, error: message })
        const delay = provider === 'google' ? 1_200 : provider === 'mapy' ? 800 : 650
        await new Promise((resolve) => setTimeout(resolve, delay))
        continue
      }
      let savedCacheId: string | null = null
      try {
        const savedCache = await saveCache({ client, provider, ...identity, candidates })
        savedCacheId = savedCache.id
        const materialized = await materializeCandidates({ client, provider, target, candidates })
        companyCount += materialized.companyCount
        evidenceCount += materialized.evidenceCount
        processedCount += 1
        await saveLookup({
          client, targetId: target.id, provider, ...identity,
          status: savedCache.status, cacheId: savedCache.id, resultCount: savedCache.safeCandidates.length,
          metadata: { cacheHit: false },
        })
      } catch (error) {
        errorCount += 1
        const message = powerOutageErrorMessage(error, `Uložení výsledku ${provider.toUpperCase()} selhalo.`)
        await saveLookup({
          client,
          targetId: target.id,
          provider,
          ...identity,
          status: 'error',
          cacheId: savedCacheId,
          error: message,
          errorCode: 'COMPLETE_PROVIDER_MATERIALIZATION_FAILED',
          metadata: { providerRequestSucceeded: true, materializationFailed: true },
        })
      }
      const delay = provider === 'google' ? 1_200 : provider === 'mapy' ? 800 : 650
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
    const finishedAt = new Date().toISOString()
    const status = errorCount > 0 ? 'partial' : processedCount === 0 ? 'no_change' : 'succeeded'
    const { error: finishError } = await client.from('complete_power_outage_runs').update({
      status, finished_at: finishedAt, source_record_count: processedCount,
      company_upsert_count: companyCount, evidence_upsert_count: evidenceCount,
      cache_hit_count: cacheHitCount, error_count: errorCount,
      metadata: { externalRequestCount, quotaReached, requestedLimit: limit },
    }).eq('id', run.id)
    if (finishError) throw finishError
    await finishCompletePowerOutageTask({
      taskKey: taskKey(provider), lockToken,
      status: errorCount > 0 ? 'partial' : 'succeeded', processedCount,
      cursor: { finishedAt, externalRequestCount, quotaReached },
    })
    return {
      status, provider, processedCount, externalRequestCount, cacheHitCount,
      companyCount, evidenceCount, errorCount, quotaReached, startedAt, finishedAt,
    }
  } catch (error) {
    const failedAt = new Date().toISOString()
    const message = powerOutageErrorMessage(error, 'Dohledávání firem selhalo.')
    await Promise.allSettled([
      client.from('complete_power_outage_runs').update({
        status: 'failed', finished_at: failedAt, error_count: errorCount + 1,
        error_code: 'COMPLETE_COMPANY_DISCOVERY_FAILED', error_message: message.slice(0, 2_000),
      }).eq('id', run.id),
      finishCompletePowerOutageTask({
        taskKey: taskKey(provider), lockToken, status: 'failed',
        errorCode: 'COMPLETE_COMPANY_DISCOVERY_FAILED', errorMessage: message,
      }),
    ])
    throw error
  }
}
