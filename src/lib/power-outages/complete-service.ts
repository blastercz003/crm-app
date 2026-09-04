import 'server-only'

import { getPowerOutageRuntimeContext } from './access'
import type {
  CompleteEvidenceProvider,
  CompleteAddressCoverage,
  CompleteAddressCoverageDiagnostic,
  CompleteAddressCoverageRun,
  CompleteCezNewState,
  CompletePowerOutageAssignment,
  CompletePowerOutageCommunicationNote,
  CompletePowerOutageDetail,
  CompletePowerOutageEvidence,
  CompletePowerOutageListItem,
  CompletePowerOutagePage,
  CompletePowerOutagePageCursor,
  CompletePowerOutagePageFilters,
  CompletePowerOutageSidebarWorkspace,
  CompletePowerOutageStatistics,
  CompletePowerOutageWorkspace,
  CompleteProviderDiagnostic,
  CompleteProviderRun,
  CompleteProviderState,
  CompleteSourceDiagnostic,
  CompleteSourceRun,
  CompleteSourceState,
} from './complete-types'
import type { PowerOutageSource } from './types'
import { MAPY_MONTHLY_CREDIT_LIMIT, MAPY_MONTHLY_CREDIT_SAFETY_CAP, providerConfigured, PROVIDER_LIMITS } from './complete-company-providers'

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

type PagedOverviewRow = OverviewRow & Partial<Omit<AssignmentRow, 'candidate_id'>> & {
  assignment_updated_at?: string | null
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

function cezNewMonitoringSchemaMissing(error: { code?: string; message?: string } | null) {
  return error?.code === 'PGRST205'
    || error?.code === '42P01'
    || Boolean(error?.message?.includes('complete_power_outage_cez_new_status'))
}

async function loadCezNewMonitoringState(
  supabase: Awaited<ReturnType<typeof getPowerOutageRuntimeContext>>['supabase'],
) {
  const enhanced = await supabase.from('complete_power_outage_cez_new_status_v3').select('*').maybeSingle()
  if (!enhanced.error) return enhanced
  if (!cezNewMonitoringSchemaMissing(enhanced.error)
    && !enhanced.error.message?.includes('complete_power_outage_cez_new_status_v3')) return enhanced
  const current = await supabase.from('complete_power_outage_cez_new_status_v2').select('*').maybeSingle()
  if (!current.error) return current
  if (!cezNewMonitoringSchemaMissing(current.error)
    && !current.error.message?.includes('complete_power_outage_cez_new_status_v2')) return current
  return supabase.from('complete_power_outage_cez_new_status').select('*').maybeSingle()
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

function metadataText(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = (value as Record<string, unknown>)[key]
  return typeof item === 'string' && item.trim() ? item.trim() : null
}

function mapSourceDiscovery(
  sourceRow: Record<string, unknown>,
  row?: Record<string, unknown> | null,
  taskRows: Array<Record<string, unknown>> = [],
): CompleteSourceState['discovery'] {
  if (!row) {
    return {
      status: sourceRow.coverage_status === 'error' ? 'error' : sourceRow.coverage_status === 'partial' ? 'partial' : 'waiting',
      statusMessage: sourceRow.coverage_status === 'error'
        ? String(sourceRow.last_error_message || 'Zpracování distributora skončilo chybou.')
        : sourceRow.coverage_status === 'partial'
          ? String((sourceRow.metadata as Record<string, unknown> | null)?.coverageMessage || 'Zdroj neposkytl kompletní očekávané pokrytí.')
          : 'Provozní přehled vyhledávání firem zatím není dostupný.',
      totalTargetCount: 0,
      completedTargetCount: 0,
      remainingTargetCount: 0,
      pendingTargetCount: 0,
      errorTargetCount: 0,
      exactTargetCount: 0,
      streetTargetCount: 0,
      progressPercent: 0,
      lastProgressAt: null,
    }
  }
  const totalTargetCount = Number(row?.total_target_count ?? 0)
  const completedTargetCount = Number(row?.completed_target_count ?? 0)
  const pendingTargetCount = Number(row?.pending_target_count ?? Math.max(0, totalTargetCount - completedTargetCount))
  const errorTargetCount = Number(row?.error_target_count ?? 0)
  const exactTargetCount = Number(row?.exact_target_count ?? 0)
  const streetTargetCount = Number(row?.street_target_count ?? 0)
  const exactPendingTargetCount = Number(row?.exact_pending_target_count ?? 0)
  const streetPendingTargetCount = Number(row?.street_pending_target_count ?? 0)
  const remainingTargetCount = Math.max(0, totalTargetCount - completedTargetCount)
  const lastProgressAt = (row.last_progress_at as string | null | undefined) ?? null
  const progressPercent = totalTargetCount > 0
    ? Math.round((completedTargetCount / totalTargetCount) * 1000) / 10
    : 100
  const progressIsStale = (lastProviderProgress: unknown, oldestPending: unknown) => {
    const reference = typeof lastProviderProgress === 'string' && lastProviderProgress
      ? lastProviderProgress
      : typeof oldestPending === 'string' && oldestPending
        ? oldestPending
        : null
    if (!reference) return false
    const referenceMs = new Date(reference).getTime()
    return Number.isFinite(referenceMs) && Date.now() - referenceMs > 30 * 60_000
  }
  const stalledProviders = [
    exactPendingTargetCount > 0 && progressIsStale(row.exact_last_progress_at, row.exact_oldest_pending_at)
      ? 'ARES'
      : null,
    streetPendingTargetCount > 0 && progressIsStale(row.street_last_progress_at, row.street_oldest_pending_at)
      ? 'Mapy.com'
      : null,
  ].filter((provider): provider is string => Boolean(provider))
  // Starší verze pohledu nemá rozpad podle povinného providera. Fallback
  // zachová dosavadní diagnostiku během bezpečného nasazení SQL před aplikací.
  const splitProgressAvailable = row.exact_pending_target_count != null
    && row.street_pending_target_count != null
  const fallbackLastProgressMs = lastProgressAt ? new Date(lastProgressAt).getTime() : Number.NaN
  const delayed = splitProgressAvailable
    ? stalledProviders.length > 0
    : pendingTargetCount > 0
      && Number.isFinite(fallbackLastProgressMs)
      && Date.now() - fallbackLastProgressMs > 30 * 60_000
  const requiredTaskKeys = [
    ...(exactTargetCount > 0 ? ['discover_ares'] : []),
    ...(streetTargetCount > 0 ? ['discover_mapy'] : []),
  ]
  const failedRequiredTask = taskRows.find((task) => (
    requiredTaskKeys.includes(String(task.task_key))
    && task.last_status === 'failed'
  ))
  const failedEvaluationTask = taskRows.find((task) => (
    task.task_key === 'reconcile_companies'
    && task.last_status === 'failed'
    && Number(task.consecutive_failure_count ?? 0) > 0
  ))
  const coverageStatus = sourceRow.coverage_status
  const status: CompleteSourceState['discovery']['status'] = coverageStatus === 'error'
    ? 'error'
    : failedRequiredTask
      ? 'error'
    : failedEvaluationTask
      ? 'error'
    : coverageStatus === 'partial'
      ? 'partial'
      : coverageStatus === 'processing'
        ? 'processing'
        : coverageStatus === 'idle'
          ? 'waiting'
          : pendingTargetCount === 0 && errorTargetCount > 0
              ? 'partial'
              : remainingTargetCount === 0
              ? 'current'
              : delayed
                ? 'delayed'
                : completedTargetCount === 0
                  ? 'waiting'
                  : 'processing'
  const statusMessage = status === 'current'
    ? 'Zdrojová data i prioritní fronta do 30 dnů jsou zpracované.'
    : status === 'processing'
      ? coverageStatus === 'processing'
        ? 'Právě se aktualizují zdrojová data distributora.'
        : `${remainingTargetCount} prioritních cílů ještě čeká na prověření.${errorTargetCount > 0 ? ` Dílčí chyby: ${errorTargetCount}.` : ''}`
      : status === 'delayed'
        ? splitProgressAvailable && stalledProviders.length > 0
          ? `${stalledProviders.join(' + ')}: povinný krok se déle než 30 minut neposunul · zbývá ${remainingTargetCount} cílů.`
          : `Povinné vyhledávání se déle než 30 minut neposunulo · zbývá ${remainingTargetCount} cílů.`
        : status === 'error'
          ? failedRequiredTask
            ? String(failedRequiredTask.last_error_message || 'Povinná úloha vyhledávání firem skončila chybou.')
            : failedEvaluationTask
              ? 'Vyhodnocení nalezených firem je zablokované. Otevřete detail.'
            : String(sourceRow.last_error_message || 'Zpracování distributora skončilo chybou.')
          : status === 'partial'
            ? coverageStatus === 'partial'
              ? String((sourceRow.metadata as Record<string, unknown> | null)?.coverageMessage || 'Zdroj neposkytl kompletní očekávané pokrytí.')
              : `Zpracování skončilo částečně; ${errorTargetCount} cílů vyžaduje kontrolu.`
            : 'Prioritní cíle čekají na první dokončený průchod.'
  return {
    status,
    statusMessage,
    totalTargetCount,
    completedTargetCount,
    remainingTargetCount,
    pendingTargetCount,
    errorTargetCount,
    exactTargetCount,
    streetTargetCount,
    progressPercent,
    lastProgressAt,
  }
}

function mapSourceState(
  row: Record<string, unknown>,
  discovery?: Record<string, unknown> | null,
  taskRows: Array<Record<string, unknown>> = [],
): CompleteSourceState {
  return {
    source: row.source as PowerOutageSource,
    coverageStatus: row.coverage_status as CompleteSourceState['coverageStatus'],
    lastAttemptAt: row.last_attempt_at as string | null,
    lastSuccessAt: row.last_success_at as string | null,
    lastCompleteAt: row.last_complete_at as string | null,
    lastChangeAt: row.last_change_at as string | null,
    horizonFrom: row.horizon_from as string | null,
    horizonTo: row.horizon_to as string | null,
    latestSourceRef: row.latest_source_ref as string | null,
    latestPayloadSha256: row.latest_payload_sha256 as string | null,
    dataVersion: Number(row.data_version),
    publishedOutageCount: Number(row.published_outage_count),
    publishedAddressCount: Number(row.published_address_count),
    futureOutageCount: Number(row.future_outage_count),
    activeOutageCount: Number(row.active_outage_count),
    coverageProcessedCount: Number(row.coverage_processed_count),
    coverageTotalCount: Number(row.coverage_total_count),
    lastErrorMessage: row.last_error_message as string | null,
    coverageMessage: metadataText(row.metadata, 'coverageMessage'),
    queryScope: metadataText(row.metadata, 'upstreamQueryScope') ?? metadataText(row.metadata, 'sourceScope'),
    discovery: mapSourceDiscovery(row, discovery, taskRows),
  }
}

function mapCezNewState(row: Record<string, unknown>): CompleteCezNewState {
  const stage = row.current_stage as CompleteCezNewState['stage']
  const status = (row.effective_readiness_status ?? row.readiness_status ?? row.overall_status) as CompleteCezNewState['status']
  const done = Number(row.progress_done ?? 0)
  const total = Number(row.progress_total ?? 0)
  const stageLabel = ({
    ruian: 'Načítá se katalog a reprezentativní adresy RÚIAN.',
    mapping: 'Obce se přiřazují k distribučnímu území ČEZ.',
    scan: 'Probíhá celoplošná kontrola odstávek ČEZ.',
    normalization: 'Nalezené adresy se ověřují proti RÚIAN.',
    projection: 'Ověřená data se promítají do stínového katalogu.',
    ready: 'Nový celoplošný ČEZ katalog je připravený.',
  } as const)[stage] ?? 'Stav nového ČEZ procesu není dostupný.'
  return {
    activeSource: row.active_source === 'shadow' ? 'shadow' : 'legacy',
    status,
    stage,
    statusMessage: status === 'error'
      ? String(row.readiness_error_message || row.last_error_message || 'Nový ČEZ proces vyžaduje kontrolu.')
      : Number(row.scan_retryable_error_count ?? 0) > 0
        ? String(row.warning_message || 'Některé obce čekají na automatické opakování po dokončení aktuálního snapshotu.')
      : stageLabel,
    progressDone: done,
    progressTotal: total,
    progressPercent: total > 0 ? Math.round((done / total) * 1000) / 10 : 0,
    catalogTotal: Number(row.catalog_total ?? 0),
    representativeDone: Number(row.representative_done ?? 0),
    representativeRemaining: Number(row.representative_remaining ?? 0),
    representativeError: Number(row.representative_error ?? 0),
    mappingDone: Number(row.mapping_done ?? 0),
    mappingRemaining: Number(row.mapping_remaining ?? 0),
    mappingError: Number(row.mapping_error ?? 0),
    cezMapped: Number(row.cez_mapped ?? 0),
    scanTotal: Number(row.scan_total ?? 0),
    scanProcessed: Number(row.scan_processed ?? 0),
    scanError: Number(row.scan_error ?? 0),
    scanRetryableErrorCount: Number(row.scan_retryable_error_count ?? 0),
    scanReviewErrorCount: Number(row.scan_review_error_count ?? 0),
    scanNextRetryAt: (row.scan_next_retry_at ?? null) as string | null,
    scanOutageCount: Number(row.scan_outage_count ?? 0),
    scanAddressCount: Number(row.scan_address_count ?? 0),
    scanStartedAt: row.scan_started_at as string | null,
    scanFinishedAt: row.scan_finished_at as string | null,
    normalizationTotal: Number(row.normalization_total ?? 0),
    normalizationDone: Number(row.normalization_done ?? 0),
    normalizationRemaining: Number(row.normalization_remaining ?? 0),
    normalizationError: Number(row.normalization_error ?? 0),
    projectedOutageCount: Number(row.projected_outage_count ?? 0),
    projectedCurrentOutageCount: Number(row.projected_current_outage_count ?? 0),
    projectedAddressCount: Number(row.projected_address_count ?? 0),
    projectionStatus: String(row.projection_status ?? 'waiting'),
    projectionPendingCount: Number(row.projection_pending_count ?? 0),
    lastProjectionAt: row.last_projection_at as string | null,
    publishableCycleCount: Number(row.publishable_cycle_count ?? 0),
    recentCycleCount: Number(row.recent_cycle_count ?? 0),
    safeRecentCycleCount: Number(row.safe_recent_cycle_count ?? 0),
    latestTwoCyclesSafe: row.latest_two_cycles_safe === true,
    latestProjectionMatches: row.latest_projection_matches === true,
    warningStage: (row.warning_stage ?? null) as CompleteCezNewState['warningStage'],
    warningCode: (row.warning_code ?? null) as string | null,
    warningMessage: (row.warning_message ?? null) as string | null,
    errorStage: (row.effective_error_stage ?? row.readiness_error_stage ?? null) as CompleteCezNewState['errorStage'],
    errorCode: (row.effective_error_code ?? row.readiness_error_code ?? null) as string | null,
    lastErrorMessage: (row.effective_error_message ?? row.readiness_error_message ?? row.last_error_message ?? null) as string | null,
  }
}

function providerStatus(input: {
  configured: boolean
  errorCount: number
  quotaExhausted: boolean
  task?: Record<string, unknown> | null
}): Pick<CompleteProviderState, 'status' | 'statusMessage'> {
  if (!input.configured) return { status: 'inactive', statusMessage: 'Poskytovatel není nakonfigurovaný.' }
  if (input.task?.last_status === 'running') return { status: 'processing', statusMessage: 'Právě probíhá dohledávání firem.' }
  if (input.task?.last_status === 'failed') return { status: 'error', statusMessage: String(input.task.last_error_message || 'Poslední běh selhal.') }
  if (input.quotaExhausted) return { status: 'exhausted', statusMessage: 'Měsíční bezpečnostní rozpočet Mapy.com je vyčerpaný.' }
  if (input.errorCount > 0) return { status: 'partial', statusMessage: `${input.errorCount} aktuálních dotazů čeká na opravu nebo opakování.` }
  if (input.task?.last_success_at) return { status: 'current', statusMessage: 'Automatické dohledávání pracuje správně.' }
  return { status: 'waiting', statusMessage: 'Poskytovatel čeká na první dokončený běh.' }
}

function mapProviderState(row: Record<string, unknown>, task?: Record<string, unknown> | null): CompleteProviderState {
  const provider = row.provider as CompleteProviderState['provider']
  const configured = providerConfigured(provider)
  const errorCount = Number(row.error_count)
  const lastRequestAt = row.last_request_at as string | null
  const lastRequestMs = lastRequestAt ? new Date(lastRequestAt).getTime() : Number.NaN
  const lastRequestAge = Number.isFinite(lastRequestMs) ? Date.now() - lastRequestMs : Number.POSITIVE_INFINITY
  const minuteRequestCount = lastRequestAge <= 60_000 ? Number(row.minute_request_count) : 0
  const dayRequestCount = lastRequestAge <= 24 * 60 * 60_000 ? Number(row.day_request_count) : 0
  const dayRequestLimit = PROVIDER_LIMITS[provider].day
  const monthlyCreditLimit = provider === 'mapy' ? MAPY_MONTHLY_CREDIT_LIMIT : 0
  const monthlyCreditSafetyCap = provider === 'mapy' ? MAPY_MONTHLY_CREDIT_SAFETY_CAP : 0
  const monthlyCreditCount = provider === 'mapy' ? Number(row.monthly_credit_count ?? 0) : 0
  return {
    provider,
    configured,
    ...providerStatus({ configured, errorCount, quotaExhausted: monthlyCreditSafetyCap > 0 && monthlyCreditCount >= monthlyCreditSafetyCap, task }),
    readyCount: Number(row.ready_count),
    pendingCount: Number(row.pending_count),
    notFoundCount: Number(row.not_found_count),
    errorCount,
    minuteRequestCount,
    dayRequestCount,
    dayRequestLimit,
    dayRequestRemaining: Math.max(0, dayRequestLimit - dayRequestCount),
    monthlyCreditCount,
    monthlyCreditLimit,
    monthlyCreditSafetyCap,
    monthlyCreditRemaining: Math.max(0, monthlyCreditLimit - monthlyCreditCount),
    completeCreditCount: provider === 'mapy' ? Number(row.complete_credit_count ?? 0) : 0,
    marketsCreditCount: provider === 'mapy' ? Number(row.markets_credit_count ?? 0) : 0,
    lastRequestAt,
  }
}

function mapAddressCoverage(input: {
  totalCount: number
  normalizedCount: number
  exactCount: number
  broadCount: number
  unresolvedCount: number
  errorCount: number
  task?: Record<string, unknown> | null
}): CompleteAddressCoverage {
  const pendingCount = Math.max(0, input.totalCount - input.normalizedCount)
  const taskStatus = input.task?.last_status
  const status = taskStatus === 'running'
    ? 'processing'
    : taskStatus === 'failed'
      ? 'error'
      : taskStatus === 'partial' || input.errorCount > 0
        ? 'partial'
        : !input.task?.last_success_at
          ? 'waiting'
          : pendingCount > 0
            ? 'processing'
            : 'current'
  const statusMessage = status === 'current'
    ? 'Všechny adresy prošly aktuální verzí normalizátoru.'
    : status === 'processing'
      ? taskStatus === 'running' ? 'Právě se zpracovává další dávka adres.' : `${pendingCount} adres čeká na nejbližší dávku.`
      : status === 'error'
        ? String(input.task?.last_error_message || 'Poslední normalizace adres selhala.')
        : status === 'partial'
          ? `${input.errorCount} adres nebo poslední dávka vyžaduje kontrolu.`
          : 'Normalizátor čeká na první úspěšný běh.'
  return { ...input, pendingCount, status, statusMessage }
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

function mapPagedOverview(row: PagedOverviewRow) {
  const assignment = row.owner_id && row.owner_name && row.communication_status && row.claimed_at && row.assignment_updated_at
    ? {
        candidate_id: row.candidate_id,
        owner_id: row.owner_id,
        owner_name: row.owner_name,
        communication_status: row.communication_status,
        notes: row.notes ?? '',
        claimed_at: row.claimed_at,
        updated_at: row.assignment_updated_at,
      } satisfies AssignmentRow
    : undefined
  return mapOverview(row, assignment)
}

export async function getCompletePowerOutagePage(
  filters: CompletePowerOutagePageFilters,
  cursor: CompletePowerOutagePageCursor | null = null,
  pageSize = 60,
): Promise<CompletePowerOutagePage> {
  const { supabase } = await getPowerOutageRuntimeContext({ redirectOnDenied: true })
  const args = {
    p_mode: filters.mode,
    p_limit: Math.min(100, Math.max(1, Math.trunc(pageSize))),
    p_cursor_at: cursor?.at ?? null,
    p_cursor_id: cursor?.id ?? null,
    p_query: filters.query.trim(),
    p_owner_filter: filters.owner,
    p_source: filters.source,
    p_entity_kind: filters.entityKind,
    p_candidate_status: filters.candidateStatus,
  }
  let { data, error } = await supabase.rpc('get_complete_power_outage_company_page_v2', args)
  if (error?.code === 'PGRST202' || error?.message?.includes('get_complete_power_outage_company_page_v2')) {
    const fallback = await supabase.rpc('get_complete_power_outage_company_page', args)
    data = fallback.data
    error = fallback.error
  }
  if (error) throw new Error(`Přehled kompletních odstávek se nepodařilo načíst: ${error.message}`)
  const payload = data && typeof data === 'object' && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {}
  const rows = Array.isArray(payload.items) ? payload.items as PagedOverviewRow[] : []
  const next = payload.nextCursor && typeof payload.nextCursor === 'object' && !Array.isArray(payload.nextCursor)
    ? payload.nextCursor as Record<string, unknown>
    : null
  return {
    items: rows.map(mapPagedOverview),
    totalCount: payload.totalCount == null ? null : Number(payload.totalCount) || 0,
    hasMore: payload.hasMore === true,
    nextCursor: next && typeof next.at === 'string' && typeof next.id === 'string'
      ? { at: next.at, id: next.id }
      : null,
  }
}

export async function getCompletePowerOutageCount(
  filters: CompletePowerOutagePageFilters,
): Promise<number> {
  const { supabase } = await getPowerOutageRuntimeContext({ redirectOnDenied: true })
  const { data, error } = await supabase.rpc('count_complete_power_outage_companies', {
    p_mode: filters.mode,
    p_query: filters.query.trim(),
    p_owner_filter: filters.owner,
    p_source: filters.source,
    p_entity_kind: filters.entityKind,
    p_candidate_status: filters.candidateStatus,
  })
  if (error) throw new Error(`Počet kompletních odstávek se nepodařilo načíst: ${error.message}`)
  return Number(data) || 0
}

export async function getCompletePowerOutageOwners() {
  const { supabase } = await getPowerOutageRuntimeContext({ redirectOnDenied: true })
  const { data, error } = await supabase
    .from('complete_power_outage_company_assignments')
    .select('owner_id,owner_name')
    .order('owner_name')
    .limit(1_000)
  if (error) {
    if (ownershipSchemaMissing(error)) return []
    throw new Error(`Seznam vlastníků se nepodařilo načíst: ${error.message}`)
  }
  return [...new Map((data ?? []).map((row) => [row.owner_id, row.owner_name] as const)).entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
}

async function countRows(query: PromiseLike<{ count: number | null; error: { message: string } | null }>, label: string) {
  const result = await query
  if (result.error) throw new Error(`${label}: ${result.error.message}`)
  return result.count ?? 0
}

export async function getCompletePowerOutageStatistics(): Promise<CompletePowerOutageStatistics> {
  const { supabase } = await getPowerOutageRuntimeContext({ redirectOnDenied: true })
  const now = new Date().toISOString()
  const [currentOutageCount, currentCompanyCount, needsReviewCount, normalizedAddressCount] = await Promise.all([
    countRows(supabase.from('complete_power_outages').select('id', { count: 'exact', head: true }).gte('ends_at', now).in('source_status', ['scheduled', 'active']), 'Počet aktuálních odstávek se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_company_overview').select('candidate_id', { count: 'exact', head: true }).gte('ends_at', now).in('source_status', ['scheduled', 'active']).in('candidate_status', ['confirmed', 'needs_review']).eq('business_relevance_status', 'eligible'), 'Počet nalezených firem se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_company_overview').select('candidate_id', { count: 'exact', head: true }).gte('ends_at', now).in('source_status', ['scheduled', 'active']).eq('candidate_status', 'needs_review').eq('business_relevance_status', 'eligible'), 'Počet firem k ověření se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).gte('normalization_version', 2), 'Počet normalizovaných adres se nepodařilo načíst'),
  ])
  return { currentOutageCount, currentCompanyCount, needsReviewCount, normalizedAddressCount }
}

export async function getCompletePowerOutageSidebarWorkspace(): Promise<CompletePowerOutageSidebarWorkspace> {
  const { supabase, user, profile } = await getPowerOutageRuntimeContext({ redirectOnDenied: true })
  const [
    totalAddressCount, normalizedAddressCount, exactAddressCount, broadAddressCount,
    unresolvedAddressCount, errorAddressCount, sourceResult, sourceDiscoveryResult,
    cezNewResult, providerResult, taskResult,
  ] = await Promise.all([
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }), 'Počet adres se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).gte('normalization_version', 2), 'Počet normalizovaných adres se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).gte('normalization_version', 2).eq('address_scope', 'exact'), 'Počet přesných adres se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).gte('normalization_version', 2).in('address_scope', ['street', 'municipality']), 'Počet adres s širším rozsahem se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).gte('normalization_version', 2).eq('address_scope', 'unresolved'), 'Počet nerozpoznaných adres se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).eq('lookup_status', 'error'), 'Počet chyb adres se nepodařilo načíst'),
    supabase.from('complete_power_outage_source_state').select('source,coverage_status,last_attempt_at,last_success_at,last_complete_at,last_change_at,horizon_from,horizon_to,latest_source_ref,latest_payload_sha256,data_version,published_outage_count,published_address_count,future_outage_count,active_outage_count,coverage_processed_count,coverage_total_count,last_error_message,metadata').order('source'),
    supabase.from('complete_power_outage_source_discovery_overview').select('*').order('source'),
    loadCezNewMonitoringState(supabase),
    supabase.from('complete_power_outage_provider_overview').select('provider,ready_count,pending_count,not_found_count,error_count,minute_request_count,day_request_count,monthly_credit_count,complete_credit_count,markets_credit_count,last_request_at').order('provider'),
    supabase.from('complete_power_outage_task_state').select('task_key,last_status,last_started_at,last_finished_at,last_success_at,consecutive_failure_count,last_error_code,last_error_message,lock_expires_at').order('task_key'),
  ])
  if (sourceResult.error) throw new Error(`Stav zdrojů kompletních odstávek se nepodařilo načíst: ${sourceResult.error.message}`)
  if (cezNewResult.error && !cezNewMonitoringSchemaMissing(cezNewResult.error)) throw new Error(`Stav nového sběru ČEZ se nepodařilo načíst: ${cezNewResult.error.message}`)
  if (providerResult.error) throw new Error(`Stav vyhledávání firem se nepodařilo načíst: ${providerResult.error.message}`)
  if (taskResult.error) throw new Error(`Provozní stav kompletních odstávek se nepodařilo načíst: ${taskResult.error.message}`)

  const tasks = taskResult.data ?? []
  const discoveryRows = sourceDiscoveryResult.error ? [] : sourceDiscoveryResult.data ?? []
  const sources = (sourceResult.data ?? []).map((row) => mapSourceState(
    row, discoveryRows.find((item) => item.source === row.source) ?? null,
    tasks as Array<Record<string, unknown>>,
  ))
  const providers = (providerResult.data ?? []).map((row) => mapProviderState(
    row, tasks.find((task) => task.task_key === `discover_${row.provider}`) ?? null,
  ))
  const addressCoverage = mapAddressCoverage({
    totalCount: totalAddressCount, normalizedCount: normalizedAddressCount,
    exactCount: exactAddressCount, broadCount: broadAddressCount,
    unresolvedCount: unresolvedAddressCount, errorCount: errorAddressCount,
    task: tasks.find((task) => task.task_key === 'normalize_addresses') ?? null,
  })
  const nowMs = Date.now()
  const freshnessMs: Record<PowerOutageSource, number> = { cez: 90 * 60_000, egd: 8 * 60 * 60_000, pre: 5 * 60 * 60_000 }
  const staleSources = sources.filter((source) => {
    const value = source.lastSuccessAt ? new Date(source.lastSuccessAt).getTime() : Number.NaN
    return !Number.isFinite(value) || nowMs - value > freshnessMs[source.source]
  })
  const failedTasks = tasks.filter((task) => task.last_status === 'failed' || task.last_status === 'partial' || Number(task.consecutive_failure_count) > 0)
  const runningTasks = tasks.filter((task) => task.last_status === 'running')
  const expiredTasks = runningTasks.filter((task) => task.lock_expires_at && new Date(task.lock_expires_at).getTime() <= nowMs)
  const lastActivityAt = tasks.flatMap((task) => [task.last_finished_at, task.last_started_at])
    .filter((value): value is string => Boolean(value)).sort().at(-1) ?? null
  const issues = [
    ...staleSources.map((source) => `${source.source.toUpperCase()}: interní projekce nemá čerstvá data.`),
    ...sources.filter((source) => source.discovery.status === 'error' || source.discovery.status === 'delayed').map((source) => `${source.source.toUpperCase()}: ${source.discovery.statusMessage}`),
    ...failedTasks.map((task) => `${String(task.task_key)}: ${task.last_error_message || 'poslední běh selhal.'}`),
    ...expiredTasks.map((task) => `${String(task.task_key)}: běh překročil bezpečnostní čas.`),
  ]
  return {
    currentUser: { id: user.id, name: profile.name?.trim() || 'Uživatel', isAdmin: profile.role === 'admin' },
    sources,
    cezNew: cezNewResult.data ? mapCezNewState(cezNewResult.data) : null,
    providers,
    runtime: {
      status: issues.length > 0 ? 'attention' : runningTasks.length > 0 ? 'processing' : sources.some((source) => !source.lastSuccessAt) ? 'waiting' : 'healthy',
      runningTaskCount: runningTasks.length, failedTaskCount: failedTasks.length,
      staleSourceCount: staleSources.length, lastActivityAt, issues: issues.slice(0, 8),
    },
    addressCoverage,
  }
}

export async function getCompletePowerOutageWorkspace(): Promise<CompletePowerOutageWorkspace> {
  const { supabase, user, profile } = await getPowerOutageRuntimeContext({ redirectOnDenied: true })
  const now = new Date().toISOString()
  const [
    initialPageResult,
    currentOutageCount,
    currentCompanyCount,
    reviewCount,
    totalAddressCount,
    normalizedAddressCount,
    exactAddressCount,
    broadAddressCount,
    unresolvedAddressCount,
    errorAddressCount,
    sourceResult,
    sourceDiscoveryResult,
    cezNewResult,
    providerResult,
    taskResult,
    ownerResult,
  ] = await Promise.all([
    getCompletePowerOutagePage({ mode: 'current', query: '', owner: 'all', source: 'all', entityKind: 'all', candidateStatus: 'visible' })
      .then((page) => ({ page, error: null as string | null }))
      .catch((error: unknown) => ({
        page: { items: [], totalCount: 0, hasMore: false, nextCursor: null } satisfies CompletePowerOutagePage,
        error: error instanceof Error ? error.message : 'Přehled kompletních odstávek se nepodařilo načíst.',
      })),
    countRows(supabase.from('complete_power_outages').select('id', { count: 'exact', head: true }).gte('ends_at', now).in('source_status', ['scheduled', 'active']), 'Počet aktuálních odstávek se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_company_overview').select('candidate_id', { count: 'exact', head: true }).gte('ends_at', now).in('source_status', ['scheduled', 'active']).in('candidate_status', ['confirmed', 'needs_review']).eq('business_relevance_status', 'eligible'), 'Počet nalezených firem se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_company_overview').select('candidate_id', { count: 'exact', head: true }).gte('ends_at', now).in('source_status', ['scheduled', 'active']).eq('candidate_status', 'needs_review').eq('business_relevance_status', 'eligible'), 'Počet firem k ověření se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }), 'Počet adres se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).gte('normalization_version', 2), 'Počet normalizovaných adres se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).gte('normalization_version', 2).eq('address_scope', 'exact'), 'Počet přesných adres se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).gte('normalization_version', 2).in('address_scope', ['street', 'municipality']), 'Počet adres s širším rozsahem se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).gte('normalization_version', 2).eq('address_scope', 'unresolved'), 'Počet nerozpoznaných adres se nepodařilo načíst'),
    countRows(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).eq('lookup_status', 'error'), 'Počet chyb adres se nepodařilo načíst'),
    supabase.from('complete_power_outage_source_state').select('source,coverage_status,last_attempt_at,last_success_at,last_complete_at,last_change_at,horizon_from,horizon_to,latest_source_ref,latest_payload_sha256,data_version,published_outage_count,published_address_count,future_outage_count,active_outage_count,coverage_processed_count,coverage_total_count,last_error_message,metadata').order('source'),
    supabase.from('complete_power_outage_source_discovery_overview').select('*').order('source'),
    loadCezNewMonitoringState(supabase),
    supabase.from('complete_power_outage_provider_overview').select('provider,ready_count,pending_count,not_found_count,error_count,minute_request_count,day_request_count,monthly_credit_count,complete_credit_count,markets_credit_count,last_request_at').order('provider'),
    supabase.from('complete_power_outage_task_state').select('task_key,last_status,last_started_at,last_finished_at,last_success_at,consecutive_failure_count,last_error_code,last_error_message,lock_expires_at').order('task_key'),
    supabase.from('complete_power_outage_company_assignments').select('owner_id,owner_name').order('owner_name').limit(1_000),
  ])
  if (sourceResult.error) throw new Error(`Stav zdrojů kompletních odstávek se nepodařilo načíst: ${sourceResult.error.message}`)
  const discoveryRows = sourceDiscoveryResult.error ? [] : sourceDiscoveryResult.data ?? []
  if (cezNewResult.error && !cezNewMonitoringSchemaMissing(cezNewResult.error)) throw new Error(`Stav nového sběru ČEZ se nepodařilo načíst: ${cezNewResult.error.message}`)
  if (providerResult.error) throw new Error(`Stav vyhledávání firem se nepodařilo načíst: ${providerResult.error.message}`)
  if (taskResult.error) throw new Error(`Provozní stav kompletních odstávek se nepodařilo načíst: ${taskResult.error.message}`)
  if (ownerResult.error && !ownershipSchemaMissing(ownerResult.error)) throw new Error(`Seznam vlastníků se nepodařilo načíst: ${ownerResult.error.message}`)

  const tasks = taskResult.data ?? []
  const sources = (sourceResult.data ?? []).map((row) => mapSourceState(
    row,
    discoveryRows.find((item) => item.source === row.source) ?? null,
    tasks as Array<Record<string, unknown>>,
  ))
  const providerStates = (providerResult.data ?? []).map((row) => mapProviderState(
    row,
    tasks.find((task) => task.task_key === `discover_${row.provider}`) ?? null,
  ))
  const normalizationTask = tasks.find((task) => task.task_key === 'normalize_addresses') ?? null
  const addressCoverage = mapAddressCoverage({
    totalCount: totalAddressCount,
    normalizedCount: normalizedAddressCount,
    exactCount: exactAddressCount,
    broadCount: broadAddressCount,
    unresolvedCount: unresolvedAddressCount,
    errorCount: errorAddressCount,
    task: normalizationTask,
  })

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
    ...sources
      .filter((source) => source.discovery.status === 'error' || source.discovery.status === 'delayed')
      .map((source) => `${source.source.toUpperCase()}: ${source.discovery.statusMessage}`),
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
    initialPage: initialPageResult.page,
    initialPageError: initialPageResult.error,
    filters: {
      owners: [...new Map((ownerResult.data ?? []).map((row) => [row.owner_id, row.owner_name] as const)).entries()]
        .map(([id, name]) => ({ id, name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'cs')),
      sources: ['cez', 'egd', 'pre'],
      entityKinds: ['registered_office', 'establishment', 'mixed'],
    },
    sources,
    cezNew: cezNewResult.data ? mapCezNewState(cezNewResult.data) : null,
    providers: providerStates,
    runtime: {
      status: runtimeStatus,
      runningTaskCount: runningTasks.length,
      failedTaskCount: failedTasks.length,
      staleSourceCount: staleSources.length,
      lastActivityAt,
      issues: issues.slice(0, 8),
    },
    addressCoverage,
  }
}

export async function getCompletePowerOutageSourceDiagnostic(
  source: PowerOutageSource,
): Promise<CompleteSourceDiagnostic> {
  if (!['cez', 'egd', 'pre'].includes(source)) throw new Error('Neplatný distributor.')
  const { supabase } = await getPowerOutageRuntimeContext()
  const taskKey = source === 'cez' ? 'sync_cez' : source === 'egd' ? 'sync_egd' : 'sync_pre'
  const [stateResult, discoveryResult, providersResult, runsResult, taskResult, evaluationTaskResult, pendingEvaluationResult] = await Promise.all([
    supabase.from('complete_power_outage_source_state')
      .select('source,coverage_status,last_attempt_at,last_success_at,last_complete_at,last_change_at,horizon_from,horizon_to,latest_source_ref,latest_payload_sha256,data_version,published_outage_count,published_address_count,future_outage_count,active_outage_count,coverage_processed_count,coverage_total_count,last_error_message,metadata')
      .eq('source', source).maybeSingle(),
    supabase.from('complete_power_outage_source_discovery_overview')
      .select('*')
      .eq('source', source).maybeSingle(),
    supabase.from('complete_power_outage_source_provider_overview')
      .select('source,provider,total_target_count,completed_target_count,pending_target_count,found_target_count,not_found_target_count,error_target_count,last_progress_at')
      .eq('source', source).order('provider'),
    supabase.from('complete_power_outage_runs')
      .select('id,status,started_at,finished_at,source_record_count,outage_upsert_count,address_upsert_count,error_count,error_code,error_message,metadata')
      .eq('source', source).eq('run_kind', 'source_sync').order('started_at', { ascending: false }).limit(8),
    supabase.from('complete_power_outage_task_state')
      .select('last_status,last_started_at,last_finished_at,last_success_at,consecutive_failure_count,last_error_code,last_error_message')
      .eq('task_key', taskKey).maybeSingle(),
    supabase.from('complete_power_outage_task_state')
      .select('task_key,last_status,last_started_at,last_finished_at,last_success_at,consecutive_failure_count,last_error_code,last_error_message')
      .eq('task_key', 'reconcile_companies').maybeSingle(),
    supabase.from('complete_power_outage_company_overview')
      .select('candidate_id', { count: 'exact', head: true })
      .eq('source', source)
      .eq('candidate_status', 'new')
      .gte('ends_at', new Date().toISOString())
      .in('source_status', ['scheduled', 'active']),
  ])
  if (stateResult.error) throw new Error(`Stav distributora se nepodařilo načíst: ${stateResult.error.message}`)
  if (discoveryResult.error) throw new Error(`Postup vyhledávání firem se nepodařilo načíst: ${discoveryResult.error.message}`)
  if (providersResult.error) throw new Error(`Postup poskytovatelů se nepodařilo načíst: ${providersResult.error.message}`)
  if (runsResult.error) throw new Error(`Historii distributora se nepodařilo načíst: ${runsResult.error.message}`)
  if (taskResult.error) throw new Error(`Stav plánované úlohy se nepodařilo načíst: ${taskResult.error.message}`)
  if (evaluationTaskResult.error) throw new Error(`Stav vyhodnocování firem se nepodařilo načíst: ${evaluationTaskResult.error.message}`)
  if (pendingEvaluationResult.error) throw new Error(`Počet firem čekajících na vyhodnocení se nepodařilo načíst: ${pendingEvaluationResult.error.message}`)
  if (!stateResult.data) throw new Error('Stav distributora není dostupný.')

  const runs = (runsResult.data ?? []).map((row): CompleteSourceRun => ({
    id: String(row.id),
    status: row.status as CompleteSourceRun['status'],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    sourceRecordCount: Number(row.source_record_count),
    outageUpsertCount: Number(row.outage_upsert_count),
    addressUpsertCount: Number(row.address_upsert_count),
    errorCount: Number(row.error_count),
    errorCode: row.error_code,
    errorMessage: row.error_message,
    removedAddressCount: Number((row.metadata as Record<string, unknown> | null)?.removedAddressCount ?? 0),
  }))
  const providers = (providersResult.data ?? []).map((row) => {
    const totalTargetCount = Number(row.total_target_count)
    const completedTargetCount = Number(row.completed_target_count)
    return {
      provider: row.provider as CompleteProviderState['provider'],
      configured: providerConfigured(row.provider as CompleteProviderState['provider']),
      totalTargetCount,
      completedTargetCount,
      pendingTargetCount: Number(row.pending_target_count),
      foundTargetCount: Number(row.found_target_count),
      notFoundTargetCount: Number(row.not_found_target_count),
      errorTargetCount: Number(row.error_target_count),
      progressPercent: totalTargetCount > 0 ? Math.round((completedTargetCount / totalTargetCount) * 1000) / 10 : 100,
      lastProgressAt: row.last_progress_at as string | null,
    }
  })
  return {
    source,
    state: mapSourceState(stateResult.data, discoveryResult.data, [
      ...(taskResult.data ? [{ ...taskResult.data, task_key: taskKey }] : []),
      ...(evaluationTaskResult.data ? [evaluationTaskResult.data] : []),
    ]),
    providers,
    runs,
    task: taskResult.data ? {
      status: taskResult.data.last_status === 'idle' ? null : taskResult.data.last_status as CompleteSourceDiagnostic['task'] extends infer T ? T extends { status: infer S } ? S : never : never,
      lastStartedAt: taskResult.data.last_started_at,
      lastFinishedAt: taskResult.data.last_finished_at,
      lastSuccessAt: taskResult.data.last_success_at,
      consecutiveFailureCount: Number(taskResult.data.consecutive_failure_count),
      lastErrorMessage: taskResult.data.last_error_message,
    } : null,
    evaluationTask: evaluationTaskResult.data ? {
      status: evaluationTaskResult.data.last_status === 'idle'
        ? null
        : evaluationTaskResult.data.last_status as CompleteSourceDiagnostic['evaluationTask'] extends infer T ? T extends { status: infer S } ? S : never : never,
      lastStartedAt: evaluationTaskResult.data.last_started_at,
      lastFinishedAt: evaluationTaskResult.data.last_finished_at,
      lastSuccessAt: evaluationTaskResult.data.last_success_at,
      consecutiveFailureCount: Number(evaluationTaskResult.data.consecutive_failure_count),
      lastErrorCode: evaluationTaskResult.data.last_error_code,
      lastErrorMessage: evaluationTaskResult.data.last_error_message,
      pendingCandidateCount: pendingEvaluationResult.count ?? 0,
    } : null,
  }
}

export async function getCompletePowerOutageProviderDiagnostic(
  provider: CompleteProviderState['provider'],
): Promise<CompleteProviderDiagnostic> {
  if (!['ares', 'mapy', 'google'].includes(provider)) throw new Error('Neplatný poskytovatel.')
  const { supabase } = await getPowerOutageRuntimeContext()
  const [overviewResult, taskResult, runsResult, errorsResult] = await Promise.all([
    supabase.from('complete_power_outage_provider_overview')
      .select('provider,ready_count,pending_count,not_found_count,error_count,minute_request_count,day_request_count,monthly_credit_count,complete_credit_count,markets_credit_count,last_request_at')
      .eq('provider', provider).maybeSingle(),
    supabase.from('complete_power_outage_task_state')
      .select('last_status,last_started_at,last_finished_at,last_success_at,consecutive_failure_count,last_error_code,last_error_message')
      .eq('task_key', `discover_${provider}`).maybeSingle(),
    supabase.from('complete_power_outage_runs')
      .select('id,status,started_at,finished_at,source_record_count,company_upsert_count,evidence_upsert_count,cache_hit_count,error_count,error_code,error_message,metadata')
      .eq('provider', provider).eq('run_kind', 'company_discovery').order('started_at', { ascending: false }).limit(8),
    supabase.from('complete_power_outage_active_provider_errors')
      .select('id,target_id,query_text,target_kind,attempt_count,last_attempt_at,next_attempt_at,last_error_code,last_error_message')
      .eq('provider', provider).in('lookup_status', ['error', 'needs_review']).order('last_attempt_at', { ascending: false }).limit(8),
  ])
  if (overviewResult.error) throw new Error(`Stav poskytovatele se nepodařilo načíst: ${overviewResult.error.message}`)
  if (taskResult.error) throw new Error(`Stav úlohy se nepodařilo načíst: ${taskResult.error.message}`)
  if (runsResult.error) throw new Error(`Historii vyhledávání se nepodařilo načíst: ${runsResult.error.message}`)
  if (errorsResult.error) throw new Error(`Chybné dotazy se nepodařilo načíst: ${errorsResult.error.message}`)
  if (!overviewResult.data) throw new Error('Stav poskytovatele není dostupný.')

  const task = taskResult.data as Record<string, unknown> | null
  const state = mapProviderState(overviewResult.data, task)
  const runs = (runsResult.data ?? []).map((row): CompleteProviderRun => {
    const metadata = row.metadata as Record<string, unknown> | null
    return {
      id: String(row.id),
      status: row.status as CompleteProviderRun['status'],
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      processedCount: Number(row.source_record_count),
      companyCount: Number(row.company_upsert_count),
      evidenceCount: Number(row.evidence_upsert_count),
      cacheHitCount: Number(row.cache_hit_count),
      externalRequestCount: Number(metadata?.externalRequestCount ?? 0),
      errorCount: Number(row.error_count),
      quotaReached: metadata?.quotaReached === true,
      errorCode: row.error_code,
      errorMessage: row.error_message,
    }
  })
  return {
    provider,
    observedAt: new Date().toISOString(),
    state,
    limits: PROVIDER_LIMITS[provider],
    task: task ? {
      status: task.last_status as CompleteProviderDiagnostic['task'] extends infer T ? T extends { status: infer S } ? S : never : never,
      lastStartedAt: task.last_started_at as string | null,
      lastFinishedAt: task.last_finished_at as string | null,
      lastSuccessAt: task.last_success_at as string | null,
      consecutiveFailureCount: Number(task.consecutive_failure_count),
      lastErrorCode: task.last_error_code as string | null,
      lastErrorMessage: task.last_error_message as string | null,
    } : null,
    runs,
    recentErrors: (errorsResult.data ?? []).map((row) => {
      return {
        id: String(row.id),
        queryText: String(row.query_text ?? 'Neuvedený dotaz'),
        targetKind: String(row.target_kind ?? 'unknown'),
        attemptCount: Number(row.attempt_count),
        lastAttemptAt: row.last_attempt_at,
        nextAttemptAt: row.next_attempt_at,
        errorCode: row.last_error_code,
        errorMessage: row.last_error_message,
      }
    }),
  }
}

export async function getCompletePowerOutageAddressCoverageDiagnostic(): Promise<CompleteAddressCoverageDiagnostic> {
  const { supabase } = await getPowerOutageRuntimeContext()
  const count = (query: PromiseLike<{ count: number | null; error: { message: string } | null }>, label: string) => countRows(query, label)
  const sourceCount = (source: PowerOutageSource, mode: 'total' | 'normalized' | 'exact' | 'broad' = 'total') => {
    let query = supabase.from('complete_power_outage_addresses')
      .select('id,complete_power_outages!inner(source)', { count: 'exact', head: true })
      .eq('complete_power_outages.source', source)
    if (mode !== 'total') query = query.gte('normalization_version', 2)
    if (mode === 'exact') query = query.eq('address_scope', 'exact')
    if (mode === 'broad') query = query.in('address_scope', ['street', 'municipality'])
    return count(query, `Pokrytí adres ${source.toUpperCase()} se nepodařilo načíst`)
  }
  const sources = ['cez', 'egd', 'pre'] as const
  const [
    totalCount, normalizedCount, exactCount, broadCount, unresolvedCount, errorCount,
    exactTargetCount, streetTargetCount, municipalityTargetCount, totalTargetCount,
    taskResult, runsResult, ...sourceCounts
  ] = await Promise.all([
    count(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }), 'Počet adres se nepodařilo načíst'),
    count(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).gte('normalization_version', 2), 'Počet normalizovaných adres se nepodařilo načíst'),
    count(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).gte('normalization_version', 2).eq('address_scope', 'exact'), 'Počet přesných adres se nepodařilo načíst'),
    count(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).gte('normalization_version', 2).in('address_scope', ['street', 'municipality']), 'Počet širších adres se nepodařilo načíst'),
    count(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).gte('normalization_version', 2).eq('address_scope', 'unresolved'), 'Počet nerozpoznaných adres se nepodařilo načíst'),
    count(supabase.from('complete_power_outage_addresses').select('id', { count: 'exact', head: true }).eq('lookup_status', 'error'), 'Počet chybných adres se nepodařilo načíst'),
    count(supabase.from('complete_power_outage_address_targets').select('id', { count: 'exact', head: true }).eq('target_kind', 'exact_number'), 'Počet přesných cílů se nepodařilo načíst'),
    count(supabase.from('complete_power_outage_address_targets').select('id', { count: 'exact', head: true }).eq('target_kind', 'street'), 'Počet uličních cílů se nepodařilo načíst'),
    count(supabase.from('complete_power_outage_address_targets').select('id', { count: 'exact', head: true }).eq('target_kind', 'municipality'), 'Počet obecních cílů se nepodařilo načíst'),
    count(supabase.from('complete_power_outage_address_targets').select('id', { count: 'exact', head: true }), 'Počet adresních cílů se nepodařilo načíst'),
    supabase.from('complete_power_outage_task_state')
      .select('last_status,last_started_at,last_finished_at,last_success_at,consecutive_failure_count,last_error_code,last_error_message')
      .eq('task_key', 'normalize_addresses').maybeSingle(),
    supabase.from('complete_power_outage_runs')
      .select('id,status,started_at,finished_at,source_record_count,address_upsert_count,error_code,error_message,metadata')
      .eq('run_kind', 'address_normalization').order('started_at', { ascending: false }).limit(10),
    ...sources.flatMap((source) => [
      sourceCount(source),
      sourceCount(source, 'normalized'),
      sourceCount(source, 'exact'),
      sourceCount(source, 'broad'),
    ]),
  ])
  if (taskResult.error) throw new Error(`Stav normalizátoru se nepodařilo načíst: ${taskResult.error.message}`)
  if (runsResult.error) throw new Error(`Historii normalizace se nepodařilo načíst: ${runsResult.error.message}`)
  const task = taskResult.data as Record<string, unknown> | null
  const coverage = mapAddressCoverage({
    totalCount: Number(totalCount), normalizedCount: Number(normalizedCount), exactCount: Number(exactCount),
    broadCount: Number(broadCount), unresolvedCount: Number(unresolvedCount), errorCount: Number(errorCount), task,
  })
  const runs = (runsResult.data ?? []).map((row): CompleteAddressCoverageRun => {
    const metadata = row.metadata as Record<string, unknown> | null
    return {
      id: String(row.id),
      status: row.status as CompleteAddressCoverageRun['status'],
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      processedAddressCount: Number(row.source_record_count),
      createdTargetCount: Number(row.address_upsert_count),
      removedTargetCount: Number(metadata?.removedTargetCount ?? 0),
      exactTargetCount: Number(metadata?.exactTargetCount ?? 0),
      broadTargetCount: Number(metadata?.broadTargetCount ?? 0),
      unresolvedAddressCount: Number(metadata?.unresolvedAddressCount ?? 0),
      remainingCount: metadata?.remainingCount == null ? null : Number(metadata.remainingCount),
      errorCode: row.error_code,
      errorMessage: row.error_message,
    }
  })
  return {
    observedAt: new Date().toISOString(),
    coverage,
    normalizerVersion: Number((runsResult.data?.[0]?.metadata as Record<string, unknown> | null)?.normalizerVersion ?? 2),
    targets: {
      exactCount: Number(exactTargetCount), streetCount: Number(streetTargetCount),
      municipalityCount: Number(municipalityTargetCount), totalCount: Number(totalTargetCount),
    },
    sources: sources.map((source, index) => ({
      source,
      totalCount: Number(sourceCounts[index * 4]),
      normalizedCount: Number(sourceCounts[index * 4 + 1]),
      exactCount: Number(sourceCounts[index * 4 + 2]),
      broadCount: Number(sourceCounts[index * 4 + 3]),
    })),
    task: task ? {
      status: task.last_status as CompleteAddressCoverageDiagnostic['task'] extends infer T ? T extends { status: infer S } ? S : never : never,
      lastStartedAt: task.last_started_at as string | null,
      lastFinishedAt: task.last_finished_at as string | null,
      lastSuccessAt: task.last_success_at as string | null,
      consecutiveFailureCount: Number(task.consecutive_failure_count),
      lastErrorCode: task.last_error_code as string | null,
      lastErrorMessage: task.last_error_message as string | null,
    } : null,
    runs,
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

export async function getCompletePowerOutageCommunicationNotes(
  candidateId: string,
): Promise<CompletePowerOutageCommunicationNote[]> {
  const cleanId = candidateId.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(cleanId)) throw new Error('Neplatné technické ID firmy.')
  const { supabase } = await getPowerOutageRuntimeContext()
  const { data, error } = await supabase
    .from('complete_power_outage_company_notes')
    .select('id,author_id,author_name,body,created_at')
    .eq('candidate_id', cleanId)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    if (ownershipSchemaMissing(error)) return []
    throw new Error(`Historii komunikace se nepodařilo načíst: ${error.message}`)
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    authorId: String(row.author_id),
    authorName: String(row.author_name),
    body: String(row.body),
    createdAt: String(row.created_at),
  }))
}
