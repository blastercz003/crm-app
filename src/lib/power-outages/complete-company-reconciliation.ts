import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { powerOutageErrorMessage } from './error-message'
import { claimCompletePowerOutageTask, finishCompletePowerOutageTask } from './complete-task-lock'
import {
  COMPLETE_COMPANY_EVALUATION_VERSION,
  evaluateCompleteCompanyCandidate,
  shouldMergeCompleteCompanyCandidates,
  type CompleteCompanyEvaluationEvidence,
} from './complete-company-evaluation'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>

type CompanyRow = {
  id: string
  outage_address_id: string
  company_name: string
  normalized_company_name: string
  ico: string | null
  candidate_status: 'new' | 'confirmed' | 'needs_review' | 'dismissed' | 'stale'
  confidence: number | string
  resolved_at: string | null
  resolved_by: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

type AddressRow = {
  id: string
  address_scope: 'exact' | 'street' | 'municipality' | 'unresolved'
}

type EvidenceRow = {
  company_id: string
  provider: CompleteCompanyEvaluationEvidence['provider']
  evidence_kind: CompleteCompanyEvaluationEvidence['evidenceKind']
  match_level: CompleteCompanyEvaluationEvidence['matchLevel']
  display_name: string
  confidence: number | string
  distance_meters: number | null
  metadata: Record<string, unknown> | null
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

async function loadEvaluationQueue(client: ServiceClient, limit: number) {
  const { data, error } = await client
    .from('complete_power_outage_companies')
    .select('outage_address_id')
    .lt('evaluation_version', COMPLETE_COMPANY_EVALUATION_VERSION)
    .in('candidate_status', ['new', 'confirmed', 'needs_review'])
    .order('updated_at')
    .order('id')
    .limit(limit)
  if (error) throw error
  return [...new Set((data ?? []).map((row) => String(row.outage_address_id)))]
}

async function loadAddressBundle(client: ServiceClient, addressIds: string[]) {
  const addresses: AddressRow[] = []
  const companies: CompanyRow[] = []
  for (const ids of chunks(addressIds, 100)) {
    const [{ data: addressRows, error: addressError }, { data: companyRows, error: companyError }] = await Promise.all([
      client.from('complete_power_outage_addresses').select('id,address_scope').in('id', ids),
      client.from('complete_power_outage_companies')
        .select('id,outage_address_id,company_name,normalized_company_name,ico,candidate_status,confidence,resolved_at,resolved_by,metadata,created_at')
        .in('outage_address_id', ids),
    ])
    if (addressError) throw addressError
    if (companyError) throw companyError
    addresses.push(...((addressRows ?? []) as AddressRow[]))
    companies.push(...((companyRows ?? []) as CompanyRow[]))
  }
  return { addresses, companies }
}

async function loadEvidence(client: ServiceClient, companyIds: string[]) {
  const evidence: EvidenceRow[] = []
  for (const ids of chunks(companyIds, 100)) {
    const { data, error } = await client
      .from('complete_power_outage_company_evidence')
      .select('company_id,provider,evidence_kind,match_level,display_name,confidence,distance_meters,metadata')
      .in('company_id', ids)
    if (error) throw error
    evidence.push(...((data ?? []) as EvidenceRow[]))
  }
  return evidence
}

function chooseSurvivor(values: CompanyRow[]) {
  return [...values].sort((left, right) => {
    const manual = Number(Boolean(right.resolved_by)) - Number(Boolean(left.resolved_by))
    if (manual !== 0) return manual
    const ico = Number(Boolean(right.ico)) - Number(Boolean(left.ico))
    if (ico !== 0) return ico
    return left.created_at.localeCompare(right.created_at)
  })[0]
}

async function deduplicateAddressCompanies(client: ServiceClient, companies: CompanyRow[]) {
  const remaining = [...companies]
  let mergedCount = 0
  while (remaining.length > 1) {
    const seed = remaining.shift()
    if (!seed) break
    const matches = remaining.filter((candidate) => shouldMergeCompleteCompanyCandidates({
      ico: seed.ico,
      companyName: seed.company_name,
      manuallyResolved: Boolean(seed.resolved_by),
      candidateStatus: seed.candidate_status,
    }, {
      ico: candidate.ico,
      companyName: candidate.company_name,
      manuallyResolved: Boolean(candidate.resolved_by),
      candidateStatus: candidate.candidate_status,
    }))
    if (matches.length === 0) continue
    const group = [seed, ...matches]
    const survivor = chooseSurvivor(group)
    for (const duplicate of group) {
      if (duplicate.id === survivor.id) continue
      const { data, error } = await client.rpc('merge_complete_power_outage_company_candidates', {
        requested_survivor_id: survivor.id,
        requested_duplicate_id: duplicate.id,
      })
      if (error) throw error
      if (data === true) mergedCount += 1
      const index = remaining.findIndex((item) => item.id === duplicate.id)
      if (index >= 0) remaining.splice(index, 1)
    }
  }
  return mergedCount
}

function evidenceInput(row: EvidenceRow): CompleteCompanyEvaluationEvidence {
  return {
    provider: row.provider,
    evidenceKind: row.evidence_kind,
    matchLevel: row.match_level,
    displayName: row.display_name,
    confidence: finiteNumber(row.confidence),
    distanceMeters: row.distance_meters,
  }
}

function ruianAddressId(evidence: EvidenceRow[]) {
  for (const item of evidence) {
    const raw = item.metadata?.ruianAddressId
    const parsed = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed
  }
  return null
}

export async function reconcileCompletePowerOutageCompanies(requestedLimit = 250) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro vyhodnocení firem.')
  const limit = Math.min(1000, Math.max(1, Math.trunc(requestedLimit)))
  const lockToken = await claimCompletePowerOutageTask('reconcile_companies', 30 * 60)
  if (!lockToken) return { status: 'skipped' as const, reason: 'already_running' as const }
  const startedAt = new Date().toISOString()
  let runId: string | null = null

  try {
    const { data: run, error: runError } = await client.from('complete_power_outage_runs').insert({
      run_kind: 'company_reconciliation', trigger_kind: 'manual', status: 'running',
    }).select('id').single<{ id: string }>()
    if (runError) throw runError
    runId = run.id

    const addressIds = await loadEvaluationQueue(client, limit)
    let mergedCount = 0
    const initial = await loadAddressBundle(client, addressIds)
    for (const addressId of addressIds) {
      mergedCount += await deduplicateAddressCompanies(
        client,
        initial.companies.filter((company) => company.outage_address_id === addressId),
      )
    }

    const bundle = await loadAddressBundle(client, addressIds)
    const evidence = await loadEvidence(client, bundle.companies.map((company) => company.id))
    const addressById = new Map(bundle.addresses.map((address) => [address.id, address]))
    const evidenceByCompany = new Map<string, EvidenceRow[]>()
    for (const item of evidence) {
      const values = evidenceByCompany.get(item.company_id) ?? []
      values.push(item)
      evidenceByCompany.set(item.company_id, values)
    }

    let evaluatedCount = 0
    let confirmedCount = 0
    let reviewCount = 0
    let preservedManualCount = 0
    for (const addressId of addressIds) {
      const address = addressById.get(addressId)
      if (!address) continue
      const addressCompanies = bundle.companies.filter((company) => company.outage_address_id === addressId)
      const registeredOfficeCount = addressCompanies.filter((company) => (
        (evidenceByCompany.get(company.id) ?? []).some((item) => (
          (item.provider === 'ares' || item.provider === 'res')
          && item.evidence_kind === 'registered_office'
          && (item.match_level === 'exact_address' || item.match_level === 'same_building')
        ))
      )).length

      for (const company of addressCompanies) {
        if (company.candidate_status === 'dismissed' || company.candidate_status === 'stale') continue
        const companyEvidence = evidenceByCompany.get(company.id) ?? []
        if (companyEvidence.length === 0) continue
        const evaluation = evaluateCompleteCompanyCandidate({
          addressScope: address.address_scope,
          companyName: company.company_name,
          evidence: companyEvidence.map(evidenceInput),
          registeredOfficeCountAtAddress: registeredOfficeCount,
        })
        const manuallyResolved = Boolean(company.resolved_by)
        const metadata = {
          ...(company.metadata ?? {}),
          evaluation: {
            version: COMPLETE_COMPANY_EVALUATION_VERSION,
            explanations: evaluation.explanations,
            providers: evaluation.providers,
            exactProviderCount: evaluation.exactProviderCount,
            massRegisteredOffice: evaluation.massRegisteredOffice,
            nameConflict: evaluation.nameConflict,
          },
        }
        const evidenceRuianAddressId = ruianAddressId(companyEvidence)
        const update: Record<string, unknown> = {
          entity_kind: evaluation.entityKind,
          source_count: Math.max(1, evaluation.providers.length),
          evaluation_version: COMPLETE_COMPANY_EVALUATION_VERSION,
          evaluation_reasons: evaluation.reasonCodes,
          evaluated_at: new Date().toISOString(),
          metadata,
        }
        if (evidenceRuianAddressId !== null) update.ruian_address_id = evidenceRuianAddressId
        if (!manuallyResolved) {
          update.confidence = evaluation.confidence
          update.candidate_status = evaluation.candidateStatus
        } else {
          preservedManualCount += 1
        }
        const { error } = await client.from('complete_power_outage_companies').update(update).eq('id', company.id)
        if (error) throw error
        evaluatedCount += 1
        const finalStatus = manuallyResolved ? company.candidate_status : evaluation.candidateStatus
        if (finalStatus === 'confirmed') confirmedCount += 1
        else if (finalStatus === 'needs_review') reviewCount += 1
      }
    }

    const finishedAt = new Date().toISOString()
    const status = evaluatedCount === 0 ? 'no_change' : 'succeeded'
    const { error: finishRunError } = await client.from('complete_power_outage_runs').update({
      status,
      finished_at: finishedAt,
      source_record_count: evaluatedCount,
      company_upsert_count: evaluatedCount,
      metadata: { mergedCount, confirmedCount, reviewCount, preservedManualCount, evaluationVersion: COMPLETE_COMPANY_EVALUATION_VERSION },
    }).eq('id', run.id)
    if (finishRunError) throw finishRunError
    await finishCompletePowerOutageTask({
      taskKey: 'reconcile_companies', lockToken, status: 'succeeded', processedCount: evaluatedCount,
      cursor: { finishedAt, mergedCount, evaluationVersion: COMPLETE_COMPANY_EVALUATION_VERSION },
    })
    return { status, evaluatedCount, mergedCount, confirmedCount, reviewCount, preservedManualCount, startedAt, finishedAt }
  } catch (error) {
    const message = powerOutageErrorMessage(error, 'Vyhodnocení a deduplikace firem selhaly.')
    await Promise.allSettled([
      runId ? client.from('complete_power_outage_runs').update({
        status: 'failed', finished_at: new Date().toISOString(), error_count: 1,
        error_code: 'COMPLETE_COMPANY_RECONCILIATION_FAILED', error_message: message.slice(0, 2_000),
      }).eq('id', runId) : Promise.resolve(),
      finishCompletePowerOutageTask({
        taskKey: 'reconcile_companies', lockToken, status: 'failed',
        errorCode: 'COMPLETE_COMPANY_RECONCILIATION_FAILED', errorMessage: message,
      }),
    ])
    throw error
  }
}
