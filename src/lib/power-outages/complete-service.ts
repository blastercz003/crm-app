import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getPowerOutageRuntimeContext } from './access'
import type {
  CompleteEvidenceProvider,
  CompletePowerOutageAssignment,
  CompletePowerOutageDetail,
  CompletePowerOutageEvidence,
  CompletePowerOutageListItem,
  CompletePowerOutageWorkspace,
  CompleteProviderState,
  CompleteSourceState,
} from './complete-types'
import type { PowerOutageSource } from './types'
import { providerConfigured } from './complete-company-providers'

type OverviewRow = {
  candidate_id: string
  outage_address_id: string
  outage_id: string
  source: PowerOutageSource
  external_id: string
  source_status: CompletePowerOutageListItem['sourceStatus']
  title: string | null
  description: string | null
  starts_at: string
  ends_at: string
  source_url: string | null
  announcement_url: string | null
  first_seen_at: string
  last_seen_at: string
  address_scope: CompletePowerOutageListItem['addressScope']
  municipality: string
  town_part: string | null
  street: string
  house_number: string | null
  orientation_number: string | null
  postal_code: string | null
  raw_address: string
  address_latitude: number | string | null
  address_longitude: number | string | null
  company_name: string
  ico: string | null
  legal_form: string | null
  nace_codes: unknown
  employee_category: string | null
  entity_kind: CompletePowerOutageListItem['entityKind']
  display_address: string | null
  latitude: number | string | null
  longitude: number | string | null
  confidence: number | string
  candidate_status: CompletePowerOutageListItem['candidateStatus']
  source_count: number
  evaluation_reasons: unknown
  evaluated_at: string | null
  evidence_providers: unknown
  evidence_count: number
  metadata: Record<string, unknown> | null
}

type AssignmentRow = {
  candidate_id: string
  owner_id: string
  owner_name: string
  communication_status: CompletePowerOutageAssignment['communicationStatus']
  notes: string
  claimed_at: string
  updated_at: string
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function providers(value: unknown) {
  return stringArray(value).filter((item): item is CompleteEvidenceProvider => (
    ['ares', 'res', 'mapy', 'google'].includes(item)
  ))
}

function explanations(metadata: Record<string, unknown> | null) {
  const evaluation = metadata?.evaluation
  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) return []
  return stringArray((evaluation as Record<string, unknown>).explanations)
}

function ownershipSchemaMissing(error: { code?: string; message?: string } | null) {
  return error?.code === 'PGRST205'
    || error?.code === '42P01'
    || Boolean(error?.message?.includes('complete_power_outage_company_assignments'))
}

function mapAssignment(row: AssignmentRow | undefined): CompletePowerOutageAssignment | null {
  if (!row) return null
  return {
    ownerId: row.owner_id,
    ownerName: row.owner_name,
    communicationStatus: row.communication_status,
    notes: row.notes,
    claimedAt: row.claimed_at,
    updatedAt: row.updated_at,
  }
}

function mapOverview(row: OverviewRow, assignment?: AssignmentRow): CompletePowerOutageListItem {
  return {
    candidateId: row.candidate_id,
    outageId: row.outage_id,
    outageAddressId: row.outage_address_id,
    source: row.source,
    externalId: row.external_id,
    sourceStatus: row.source_status,
    title: row.title?.trim() || 'Plánovaná odstávka elektřiny',
    description: row.description,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    sourceUrl: row.source_url,
    announcementUrl: row.announcement_url,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    addressScope: row.address_scope,
    municipality: row.municipality,
    townPart: row.town_part,
    street: row.street,
    houseNumber: row.house_number,
    orientationNumber: row.orientation_number,
    postalCode: row.postal_code,
    rawAddress: row.raw_address,
    companyName: row.company_name,
    ico: row.ico,
    legalForm: row.legal_form,
    naceCodes: stringArray(row.nace_codes),
    employeeCategory: row.employee_category,
    entityKind: row.entity_kind,
    displayAddress: row.display_address,
    confidence: finiteNumber(row.confidence) ?? 0,
    candidateStatus: row.candidate_status,
    sourceCount: Number(row.source_count) || 1,
    evaluationReasons: stringArray(row.evaluation_reasons),
    evaluationExplanations: explanations(row.metadata),
    evaluatedAt: row.evaluated_at,
    providers: providers(row.evidence_providers),
    evidenceCount: Number(row.evidence_count) || 0,
    assignment: mapAssignment(assignment),
  }
}

async function loadOverviewItems(client: SupabaseClient, now: string, archived: boolean) {
  let query = client
    .from('complete_power_outage_company_overview')
    .select('*')
    .in('candidate_status', ['new', 'confirmed', 'needs_review', 'dismissed'])
  query = archived
    ? query.lt('ends_at', now).order('ends_at', { ascending: false }).limit(200)
    : query.gte('ends_at', now).in('source_status', ['scheduled', 'active']).order('starts_at', { ascending: true }).limit(500)
  const { data, error } = await query
  if (error) throw new Error(`Přehled kompletních odstávek se nepodařilo načíst: ${error.message}`)
  const rows = (data ?? []) as OverviewRow[]
  if (rows.length === 0) return []
  const { data: assignmentData, error: assignmentError } = await client
    .from('complete_power_outage_company_assignments')
    .select('candidate_id,owner_id,owner_name,communication_status,notes,claimed_at,updated_at')
    .in('candidate_id', rows.map((row) => row.candidate_id))
  if (assignmentError && !ownershipSchemaMissing(assignmentError)) throw new Error(`Přiřazení kompletních odstávek se nepodařilo načíst: ${assignmentError.message}`)
  const assignmentByCandidate = new Map(
    ((assignmentError ? [] : assignmentData ?? []) as AssignmentRow[]).map((assignment) => [assignment.candidate_id, assignment]),
  )
  return rows.map((row) => mapOverview(row, assignmentByCandidate.get(row.candidate_id)))
}

async function countRows(query: PromiseLike<{ count: number | null; error: { message: string } | null }>, label: string) {
  const result = await query
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.count ?? 0
}

export async function getCompletePowerOutageWorkspace(): Promise<CompletePowerOutageWorkspace> {
  const { supabase, user, profile } = await getPowerOutageRuntimeContext({ redirectOnDenied: true })
  const now = new Date().toISOString()
  const [
    currentItems,
    archivedItems,
    currentOutageCount,
    currentCompanyCount,
    reviewCount,
    totalAddressCount,
    normalizedAddressCount,
    exactAddressCount,
    insufficientAddressCount,
    errorAddressCount,
    sourceResult,
    providerResult,
    taskResult,
  ] = await Promise.all([
    loadOverviewItems(supabase, now, false),
    loadOverviewItems(supabase, now, true),
    countRows(supabase.from('complete_power_outages').select('id', { count: 'exact', head: true }).gte('ends_at', now).in('source_status', ['scheduled', 'active']), 'Počet aktuálních odstávek se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_company_overview').select('candidate_id', { count: 'exact', head: true }).gte('ends_at', now).in('source_status', ['scheduled', 'active']).in('candidate_status', ['new', 'confirmed', 'needs_review']), 'Počet nalezených firem se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_company_overview').select('candidate_id', { count: 'exact', head: true }).gte('ends_at', now).in('source_status', ['scheduled', 'active']).eq('candidate_status', 'needs_review'), 'Počet firem k ověření se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }), 'Počet adres se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).gte('normalization_version', 2), 'Počet normalizovaných adres se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).eq('address_scope', 'exact'), 'Počet přesných adres se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).in('address_scope', ['street', 'municipality', 'unresolved']), 'Počet nedostatečných adres se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).eq('lookup_status', 'error'), 'Počet chyb adres se nepodařilo načíst'),
    supabase.from('complete_power_outage_source_state').select('source,coverage_status,last_attempt_at,last_success_at,last_complete_at,published_outage_count,published_address_count,future_outage_count,active_outage_count,coverage_processed_count,coverage_total_count,last_error_message,metadata').order('source'),
    supabase.from('complete_power_outage_provider_overview').select('provider,ready_count,pending_count,not_found_count,error_count,minute_request_count,day_request_count,last_request_at').order('provider'),
    supabase.from('complete_power_outage_task_state').select('task_key,last_status,last_started_at,last_finished_at,last_success_at,consecutive_failure_count,last_error_message,lock_expires_at').order('task_key'),
  ])
  if (sourceResult.error) throw new Error(`Stav zdrojů kompletních odstávek se nepodařilo načíst: ${sourceResult.error.message}`)
  if (providerResult.error) throw new Error(`Stav vyhledávání firem se nepodařilo načíst: ${providerResult.error.message}`)
  if (taskResult.error) throw new Error(`Provozní stav kompletních odstávek se nepodařilo načíst: ${taskResult.error.message}`)

  const sources = (sourceResult.data ?? []).map((row): CompleteSourceState => ({
    source: row.source as PowerOutageSource,
    coverageStatus: row.coverage_status as CompleteSourceState['coverageStatus'],
    lastAttemptAt: row.last_attempt_at,
    lastSuccessAt: row.last_success_at,
    lastCompleteAt: row.last_complete_at,
    publishedOutageCount: Number(row.published_outage_count),
    publishedAddressCount: Number(row.published_address_count),
    futureOutageCount: Number(row.future_outage_count),
    activeOutageCount: Number(row.active_outage_count),
    coverageProcessedCount: Number(row.coverage_processed_count),
    coverageTotalCount: Number(row.coverage_total_count),
    lastErrorMessage: row.last_error_message,
    coverageMessage: row.metadata && typeof row.metadata === 'object'
      && typeof (row.metadata as Record<string, unknown>).coverageMessage === 'string'
      ? String((row.metadata as Record<string, unknown>).coverageMessage)
      : null,
  }))
  const providerStates = (providerResult.data ?? []).map((row): CompleteProviderState => ({
    provider: row.provider as CompleteProviderState['provider'],
    configured: providerConfigured(row.provider as CompleteProviderState['provider']),
    readyCount: Number(row.ready_count),
    pendingCount: Number(row.pending_count),
    notFoundCount: Number(row.not_found_count),
    errorCount: Number(row.error_count),
    minuteRequestCount: Number(row.minute_request_count),
    dayRequestCount: Number(row.day_request_count),
    lastRequestAt: row.last_request_at,
  }))

  const nowMs = Date.now()
  const freshnessMs: Record<PowerOutageSource, number> = {
    cez: 90 * 60_000,
    egd: 8 * 60 * 60_000,
    pre: 5 * 60 * 60_000,
  }
  const staleSources = sources.filter((source) => {
    if (!source.lastSuccessAt) return true
    const value = new Date(source.lastSuccessAt).getTime()
    return !Number.isFinite(value) || nowMs - value > freshnessMs[source.source]
  })
  const tasks = taskResult.data ?? []
  const failedTasks = tasks.filter((task) => (
    task.last_status === 'failed'
    || task.last_status === 'partial'
    || Number(task.consecutive_failure_count) > 0
  ))
  const runningTasks = tasks.filter((task) => task.last_status === 'running')
  const expiredTasks = runningTasks.filter((task) => (
    task.lock_expires_at && new Date(task.lock_expires_at).getTime() <= nowMs
  ))
  const lastActivityAt = tasks
    .flatMap((task) => [task.last_finished_at, task.last_started_at])
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null
  const issues = [
    ...staleSources.map((source) => `${source.source.toUpperCase()}: interní projekce nemá čerstvá data.`),
    ...failedTasks.map((task) => `${String(task.task_key)}: ${task.last_error_message || 'poslední běh selhal.'}`),
    ...expiredTasks.map((task) => `${String(task.task_key)}: běh překročil bezpečnostní čas.`),
  ]
  const runtimeStatus = issues.length > 0
    ? 'attention'
    : runningTasks.length > 0
      ? 'processing'
      : sources.some((source) => !source.lastSuccessAt)
        ? 'waiting'
        : 'healthy'

  return {
    generatedAt: now,
    currentUser: {
      id: user.id,
      name: profile.name?.trim() || 'Uživatel',
      isAdmin: profile.role === 'admin',
    },
    statistics: { currentOutageCount, currentCompanyCount, needsReviewCount: reviewCount, normalizedAddressCount },
    currentItems,
    archivedItems,
    filters: {
      owners: [...new Map(
        [...currentItems, ...archivedItems]
          .flatMap((item) => item.assignment ? [[item.assignment.ownerId, item.assignment.ownerName] as const] : []),
      ).entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'cs')),
      sources: [...new Set([...currentItems, ...archivedItems].map((item) => item.source))].sort(),
      entityKinds: [...new Set([...currentItems, ...archivedItems].map((item) => item.entityKind))].sort(),
    },
    sources,
    providers: providerStates,
    runtime: {
      status: runtimeStatus,
      runningTaskCount: runningTasks.length,
      failedTaskCount: failedTasks.length,
      staleSourceCount: staleSources.length,
      lastActivityAt,
      issues: issues.slice(0, 8),
    },
    addressCoverage: {
      totalCount: totalAddressCount,
      normalizedCount: normalizedAddressCount,
      exactCount: exactAddressCount,
      insufficientCount: insufficientAddressCount,
      errorCount: errorAddressCount,
    },
  }
}

export async function getCompletePowerOutageDetail(candidateId: string): Promise<CompletePowerOutageDetail> {
  const cleanId = candidateId.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(cleanId)) throw new Error('Neplatné technické ID firmy.')
  const { supabase } = await getPowerOutageRuntimeContext()
  const [{ data: overview, error: overviewError }, { data: evidenceRows, error: evidenceError }, { data: assignmentRow, error: assignmentError }] = await Promise.all([
    supabase.from('complete_power_outage_company_overview').select('*').eq('candidate_id', cleanId).maybeSingle<OverviewRow>(),
    supabase.from('complete_power_outage_company_evidence')
      .select('id,provider,provider_entity_id,evidence_kind,match_level,display_name,display_address,source_url,distance_meters,confidence,observed_at')
      .eq('company_id', cleanId).order('confidence', { ascending: false }),
    supabase.from('complete_power_outage_company_assignments')
      .select('candidate_id,owner_id,owner_name,communication_status,notes,claimed_at,updated_at')
      .eq('candidate_id', cleanId).maybeSingle<AssignmentRow>(),
  ])
  if (overviewError) throw new Error(`Detail firmy se nepodařilo načíst: ${overviewError.message}`)
  if (evidenceError) throw new Error(`Důkazy firmy se nepodařilo načíst: ${evidenceError.message}`)
  if (assignmentError && !ownershipSchemaMissing(assignmentError)) throw new Error(`Přiřazení firmy se nepodařilo načíst: ${assignmentError.message}`)
  if (!overview) throw new Error('Požadovaná firma nebyla nalezena.')
  const evidence: CompletePowerOutageEvidence[] = (evidenceRows ?? []).map((row) => ({
    id: row.id,
    provider: row.provider as CompleteEvidenceProvider,
    providerEntityId: row.provider_entity_id,
    evidenceKind: row.evidence_kind as CompletePowerOutageEvidence['evidenceKind'],
    matchLevel: row.match_level as CompletePowerOutageEvidence['matchLevel'],
    displayName: row.display_name,
    displayAddress: row.display_address,
    sourceUrl: row.source_url,
    distanceMeters: row.distance_meters,
    confidence: finiteNumber(row.confidence) ?? 0,
    observedAt: row.observed_at,
  }))
  return {
    ...mapOverview(overview, assignmentError ? undefined : assignmentRow ?? undefined),
    addressLatitude: finiteNumber(overview.address_latitude),
    addressLongitude: finiteNumber(overview.address_longitude),
    companyLatitude: finiteNumber(overview.latitude),
    companyLongitude: finiteNumber(overview.longitude),
    metadata: overview.metadata ?? {},
    evidence,
  }
}
