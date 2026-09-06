import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { getPowerOutageRuntimeContext } from './access'
import type {
  PowerOutageCezCollectorOverview,
  PowerOutageSource,
  PowerOutageSourceDiagnostic,
  PowerOutageSourceStatus,
} from './types'

type SourceState = {
  source: 'cez' | 'egd' | 'pre'
  last_attempt_at: string | null
  last_success_at: string | null
  last_change_at: string | null
  consecutive_failure_count: number
  last_error_code: string | null
  last_error_message: string | null
  active_outage_count: number
  future_outage_count: number
  data_version: number
  store_revision_processed: number
  metadata: Record<string, unknown> | null
}

type LatestRun = {
  source: 'cez' | 'egd' | 'pre'
  status: 'running' | 'succeeded' | 'no_change' | 'failed' | 'skipped'
  source_record_count: number
  outage_upsert_count: number
  metadata: Record<string, unknown> | null
}

type TaskState = {
  task_key: string
  lock_expires_at: string | null
  last_started_at: string | null
  last_finished_at: string | null
  last_success_at: string | null
  last_status: 'pending' | 'running' | 'succeeded' | 'failed'
  consecutive_failure_count: number
  last_error_code: string | null
  last_error_message: string | null
}

type MatchRun = {
  status: 'running' | 'succeeded' | 'failed'
  started_at: string
  finished_at: string | null
  store_revision: number
  address_count: number
  metadata: Record<string, unknown> | null
  error_code: string | null
  error_message: string | null
}

type CezVersionOverviewRow = {
  collector_version: 'v1' | 'v2'
  display_name: string
  operating_mode: 'v1_only' | 'dual' | 'v2_only'
  primary_version: 'v1' | 'v2'
  secondary_version: 'v1' | 'v2' | null
  activation_ready: boolean
  switched_at: string
  is_enabled: boolean
  is_primary: boolean
  cadence_seconds: number
  last_attempt_at: string | null
  last_success_at: string | null
  last_complete_at: string | null
  last_target_count: number
  last_outage_count: number
  consecutive_failure_count: number
  last_error_code: string | null
  last_error_message: string | null
  latest_cycle_status: 'pending' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled' | null
  target_count: number | null
  processed_count: number | null
  success_count: number | null
  error_count: number | null
  observed_outage_count: number
  exact_outage_count: number
  town_outage_count: number
  cycle_started_at: string | null
  cycle_finished_at: string | null
  cycle_error_code: string | null
  cycle_error_message: string | null
  health_status: 'inactive' | 'waiting' | 'processing' | 'current' | 'delayed' | 'error'
}

type CezUnionOverviewRow = {
  operating_mode: 'v1_only' | 'dual' | 'v2_only'
  primary_version: 'v1' | 'v2'
  secondary_version: 'v1' | 'v2' | null
  activation_ready: boolean
  switched_at: string
  v1_outage_count: number
  v2_outage_count: number
  shared_outage_count: number
  v1_only_outage_count: number
  v2_only_outage_count: number
  unique_outage_count: number
  calculated_at: string
}

async function getCezCollectorOverview(
  supabase: Awaited<ReturnType<typeof getPowerOutageRuntimeContext>>['supabase'],
  source: PowerOutageSource,
) {
  if (source !== 'cez') return { versions: null, union: null, error: null }

  const [versionsResult, unionResult] = await Promise.all([
    supabase
      .from('power_outage_cez_market_version_overview')
      .select('collector_version,display_name,operating_mode,primary_version,secondary_version,activation_ready,switched_at,is_enabled,is_primary,cadence_seconds,last_attempt_at,last_success_at,last_complete_at,last_target_count,last_outage_count,consecutive_failure_count,last_error_code,last_error_message,latest_cycle_status,target_count,processed_count,success_count,error_count,observed_outage_count,exact_outage_count,town_outage_count,cycle_started_at,cycle_finished_at,cycle_error_code,cycle_error_message,health_status')
      .order('collector_version'),
    supabase
      .from('power_outage_cez_market_union_overview')
      .select('operating_mode,primary_version,secondary_version,activation_ready,switched_at,v1_outage_count,v2_outage_count,shared_outage_count,v1_only_outage_count,v2_only_outage_count,unique_outage_count,calculated_at')
      .maybeSingle(),
  ])

  return {
    versions: versionsResult.data as CezVersionOverviewRow[] | null,
    union: unionResult.data as CezUnionOverviewRow | null,
    error: versionsResult.error ?? unionResult.error,
  }
}

function buildCezCollectorOverview(
  versions: CezVersionOverviewRow[] | null,
  union: CezUnionOverviewRow | null,
  sourceState: SourceState | null,
): PowerOutageCezCollectorOverview | null {
  if (!versions || !union) return null

  const sourceMetadata = objectValue(sourceState?.metadata) ?? {}
  const v1Scan = objectValue(sourceMetadata.cezScan)
  const v1ScanTarget = finiteInteger(v1Scan?.totalStoreCount)
  const v1ScanProcessed = finiteInteger(v1Scan?.nextStoreIndex)
  const v1ScanStartedAt = typeof v1Scan?.startedAt === 'string' ? v1Scan.startedAt : null

  return {
    operatingMode: union.operating_mode,
    primaryVersion: union.primary_version,
    secondaryVersion: union.secondary_version,
    activationReady: union.activation_ready,
    switchedAt: union.switched_at,
    calculatedAt: union.calculated_at,
    v1OutageCount: Number(union.v1_outage_count),
    v2OutageCount: Number(union.v2_outage_count),
    sharedOutageCount: Number(union.shared_outage_count),
    v1OnlyOutageCount: Number(union.v1_only_outage_count),
    v2OnlyOutageCount: Number(union.v2_only_outage_count),
    uniqueOutageCount: Number(union.unique_outage_count),
    versions: versions.map((version) => {
      const isV1 = version.collector_version === 'v1'
      const v1Running = isV1 && v1Scan !== null
      // The legacy v1 worker records batch failures in the shared source state.
      // Fold that state into the v1 card so the per-version UI cannot look healthy
      // while the main ČEZ badge correctly reports an error.
      const v1SourceErrorCode = isV1 ? sourceState?.last_error_code ?? null : null
      const v1SourceErrorMessage = isV1 ? sourceState?.last_error_message ?? null : null
      const targetCount = isV1
        ? v1Running
          ? v1ScanTarget ?? Number(version.last_target_count ?? 0)
          : Number(version.last_target_count ?? 0)
        : Number(version.target_count ?? version.last_target_count ?? 0)
      const processedCount = isV1
        ? v1Running
          ? Math.min(targetCount, v1ScanProcessed ?? 0)
          : version.last_complete_at
            ? targetCount
            : 0
        : Number(version.processed_count ?? 0)
      const lastErrorCode = version.cycle_error_code ?? version.last_error_code ?? v1SourceErrorCode
      const lastErrorMessage = version.cycle_error_message ?? version.last_error_message ?? v1SourceErrorMessage
      const latestCycleStatus = isV1
        ? lastErrorCode
          ? 'failed' as const
          : v1Running
            ? 'running' as const
            : version.last_complete_at
              ? 'succeeded' as const
              : 'pending' as const
        : version.latest_cycle_status
      const healthStatus = isV1 && lastErrorCode
        ? 'error' as const
        : v1Running
          ? 'processing' as const
          : version.health_status

      return {
        version: version.collector_version,
        displayName: version.display_name,
        isEnabled: version.is_enabled,
        isPrimary: version.is_primary,
        cadenceSeconds: Number(version.cadence_seconds),
        healthStatus,
        lastAttemptAt: isV1 ? sourceState?.last_attempt_at ?? version.last_attempt_at : version.last_attempt_at,
        lastSuccessAt: version.last_success_at,
        lastCompleteAt: version.last_complete_at,
        consecutiveFailureCount: isV1
          ? Math.max(Number(version.consecutive_failure_count), Number(sourceState?.consecutive_failure_count ?? 0))
          : Number(version.consecutive_failure_count),
        lastErrorCode,
        lastErrorMessage,
        latestCycleStatus,
        targetCount,
        processedCount,
        successCount: isV1 ? (lastErrorCode ? 0 : processedCount) : Number(version.success_count ?? 0),
        errorCount: isV1 ? (lastErrorCode ? 1 : 0) : Number(version.error_count ?? 0),
        observedOutageCount: Number(version.observed_outage_count),
        exactOutageCount: Number(version.exact_outage_count),
        townOutageCount: Number(version.town_outage_count),
        cycleStartedAt: isV1 ? v1ScanStartedAt : version.cycle_started_at,
        cycleFinishedAt: isV1 ? version.last_complete_at : version.cycle_finished_at,
        cycleErrorCode: isV1 ? lastErrorCode : version.cycle_error_code,
        cycleErrorMessage: isV1 ? lastErrorMessage : version.cycle_error_message,
      }
    }),
  }
}

const SOURCE_STATUS_PRIORITY: Record<PowerOutageSourceStatus, number> = {
  live: 0,
  processing: 1,
  pending: 2,
  warning: 3,
  error: 4,
}

function collectorHealthToSourceStatus(
  status: PowerOutageCezCollectorOverview['versions'][number]['healthStatus'],
): PowerOutageSourceStatus | null {
  if (status === 'inactive') return null
  if (status === 'error') return 'error'
  if (status === 'delayed') return 'warning'
  if (status === 'waiting') return 'pending'
  if (status === 'processing') return 'processing'
  return 'live'
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function finiteInteger(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null
}

function sourceHealth(
  state: SourceState,
  storeRevision: number,
  storeRevisionChangedAt: string,
  nowMs: number,
  latestRun: LatestRun | undefined,
  taskState: TaskState | undefined,
  matchRun: MatchRun | null,
) {
  const successMs = state.last_success_at
    ? new Date(state.last_success_at).getTime()
    : Number.NaN
  const ageHours = Number.isFinite(successMs)
    ? Math.max(0, (nowMs - successMs) / 3_600_000)
    : null
  const storeCatalogPending = state.store_revision_processed < storeRevision
  const consecutiveFailureCount = Math.max(
    state.consecutive_failure_count,
    taskState?.consecutive_failure_count ?? 0,
  )

  const metadata = state.metadata ?? {}
  const latestRunMetadata = latestRun?.metadata ?? {}
  const cezScan = state.source === 'cez' ? objectValue(metadata.cezScan) : null
  const activeCezScan = Boolean(
    cezScan
    && finiteInteger(cezScan.storeRevision) === storeRevision,
  )
  const catalogProcessing = state.source === 'cez'
    && storeCatalogPending
    && (activeCezScan || consecutiveFailureCount === 0)
  const processing = taskState?.last_status === 'running' || (
    catalogProcessing
  )
  const lastProgressMs = state.last_attempt_at ? Date.parse(state.last_attempt_at) : Number.NaN
  const taskStartedMs = taskState?.last_started_at ? Date.parse(taskState.last_started_at) : Number.NaN
  const catalogChangedMs = Date.parse(storeRevisionChangedAt)
  const processingStalled = processing && (
    activeCezScan
      ? !Number.isFinite(lastProgressMs) || nowMs - lastProgressMs > 45 * 60 * 1_000
      : taskState?.last_status === 'running'
        ? !Number.isFinite(taskStartedMs) || nowMs - taskStartedMs > 90 * 60 * 1_000
        : catalogProcessing
          && Number.isFinite(catalogChangedMs)
          && nowMs - catalogChangedMs > 45 * 60 * 1_000
  )

  let status: 'pending' | 'live' | 'processing' | 'warning' | 'error'
  if (ageHours === null) {
    status = consecutiveFailureCount >= 2
      ? 'error'
      : consecutiveFailureCount > 0
        ? 'warning'
        : 'pending'
  }
  else if (consecutiveFailureCount >= 2 || ageHours > (state.source === 'pre' ? 8 : 14)) status = 'error'
  else if (consecutiveFailureCount > 0 || ageHours > (state.source === 'pre' ? 5 : 8) || processingStalled) status = 'warning'
  else if (processing) status = 'processing'
  else status = 'live'
  const changeValue = latestRunMetadata.changedRecordCount
  const coverageValue = state.source === 'cez'
    ? latestRunMetadata.coveredTownCount
    : latestRunMetadata.coveredMunicipalityCount
  const matchMetadata = matchRun?.metadata ?? {}
  const matchSourceVersions = objectValue(matchMetadata.sourceDataVersions)
  const matchedSourceDataVersion = finiteInteger(matchSourceVersions?.[state.source])
  const matchesCurrentSourceData = matchedSourceDataVersion !== null
    && matchedSourceDataVersion >= state.data_version
  const matchSourceProgress = objectValue(matchMetadata.sourceProgress)
  const currentSourceProgress = state.source === 'cez'
    ? null
    : objectValue(matchSourceProgress?.[state.source])
  const matchProcessedCount = finiteInteger(currentSourceProgress?.processedCount)
    ?? finiteInteger(matchMetadata.processedCount)
  const matchTotalCount = finiteInteger(currentSourceProgress?.totalCount)
    ?? finiteInteger(matchMetadata.totalCount)
  const sourceProgressPercent = currentSourceProgress && matchTotalCount !== null
    ? matchTotalCount > 0
      ? ((matchProcessedCount ?? 0) / matchTotalCount) * 100
      : 100
    : null
  const matchProgressPercent = sourceProgressPercent !== null
    ? Math.min(100, Math.max(0, sourceProgressPercent))
    : typeof matchMetadata.progressPercent === 'number' && Number.isFinite(matchMetadata.progressPercent)
      ? Math.min(100, Math.max(0, matchMetadata.progressPercent))
      : 0
  const matchPhase = matchMetadata.phase === 'saving_matches' ? 'saving_matches' as const : 'matching_addresses' as const
  const comparisonProgress = activeCezScan
    ? {
        status: 'processing' as const,
        phase: 'source_scan' as const,
        processedCount: finiteInteger(cezScan?.nextStoreIndex) ?? 0,
        totalCount: finiteInteger(cezScan?.totalStoreCount),
        percent: finiteInteger(cezScan?.totalStoreCount)
          ? Math.min(100, Math.max(0, ((finiteInteger(cezScan?.nextStoreIndex) ?? 0) / (finiteInteger(cezScan?.totalStoreCount) ?? 1)) * 100))
          : 0,
        lastProgressAt: state.last_attempt_at,
      }
    : taskState?.last_status === 'running'
      ? {
          status: 'processing' as const,
          phase: 'source_sync' as const,
          processedCount: null,
          totalCount: null,
          percent: 0,
          lastProgressAt: taskState.last_started_at,
        }
      : matchRun?.status === 'running'
        ? {
            status: 'processing' as const,
            phase: matchPhase,
            processedCount: matchProcessedCount,
            totalCount: matchTotalCount,
            percent: matchProgressPercent,
            lastProgressAt: typeof matchMetadata.lastProgressAt === 'string' ? matchMetadata.lastProgressAt : matchRun.started_at,
          }
        : matchRun?.status === 'failed'
          ? {
              status: 'error' as const,
              phase: matchPhase,
              processedCount: matchProcessedCount,
              totalCount: matchTotalCount,
              percent: matchProgressPercent,
              lastProgressAt: typeof matchMetadata.lastProgressAt === 'string' ? matchMetadata.lastProgressAt : matchRun.finished_at,
            }
          : matchRun?.status === 'succeeded'
            && Number(matchRun.store_revision) >= storeRevision
            && matchesCurrentSourceData
            ? {
                status: 'current' as const,
                phase: 'complete' as const,
                processedCount: matchProcessedCount ?? Number(matchRun.address_count),
                totalCount: matchTotalCount ?? Number(matchRun.address_count),
                percent: 100,
                lastProgressAt: matchRun.finished_at,
              }
            : {
                status: 'queued' as const,
                phase: 'matching_addresses' as const,
                processedCount: 0,
                totalCount: null,
                percent: 0,
                lastProgressAt: null,
              }

  type Attention = {
    code: string
    message: string
    recoveryAction: 'source_sync' | 'matching' | 'cez_v1' | 'cez_v2'
  }
  let attention: Attention | null = null
  const sourceStatus = status
  if (sourceStatus === 'warning' || sourceStatus === 'error') {
    attention = {
      code: state.last_error_code ?? taskState?.last_error_code ?? (processingStalled ? 'SOURCE_SYNC_STALLED' : 'SOURCE_DATA_STALE'),
      message: state.last_error_message
        ?? taskState?.last_error_message
        ?? (processingStalled
          ? `${state.source.toUpperCase()} se během probíhající kontroly neposouvá v očekávaném intervalu.`
          : `Poslední úspěšné načtení ${state.source.toUpperCase()} je starší než očekávaný interval.`),
      recoveryAction: state.source === 'cez' ? 'cez_v1' : 'source_sync',
    }
  }

  const comparisonProgressMs = comparisonProgress.lastProgressAt
    ? Date.parse(comparisonProgress.lastProgressAt)
    : Number.NaN
  const comparisonAgeMinutes = Number.isFinite(comparisonProgressMs)
    ? Math.max(0, (nowMs - comparisonProgressMs) / 60_000)
    : null
  const queueReferenceMs = Math.max(
    Number.isFinite(Date.parse(state.last_change_at ?? '')) ? Date.parse(state.last_change_at!) : 0,
    Number.isFinite(catalogChangedMs) ? catalogChangedMs : 0,
  )
  const queuedMinutes = queueReferenceMs > 0 ? Math.max(0, (nowMs - queueReferenceMs) / 60_000) : null
  let comparisonIssue: { status: 'warning' | 'error'; attention: Attention } | null = null
  if (ageHours !== null && matchRun?.status === 'failed') {
    comparisonIssue = {
      status: 'error',
      attention: {
        code: matchRun.error_code ?? 'STORE_MATCH_FAILED',
        message: matchRun.error_message ?? 'Porovnání odstávek s katalogem prodejen selhalo.',
        recoveryAction: 'matching',
      },
    }
  } else if (ageHours !== null && matchRun?.status === 'running' && comparisonAgeMinutes !== null && comparisonAgeMinutes > 20) {
    comparisonIssue = {
      status: comparisonAgeMinutes > 45 ? 'error' : 'warning',
      attention: {
        code: 'STORE_MATCH_STALLED',
        message: `Porovnání odstávek s katalogem prodejen se neposunulo ${Math.round(comparisonAgeMinutes)} minut.`,
        recoveryAction: 'matching',
      },
    }
  } else if (ageHours !== null && comparisonProgress.status === 'queued' && queuedMinutes !== null && queuedMinutes > 30) {
    comparisonIssue = {
      status: queuedMinutes > 90 ? 'error' : 'warning',
      attention: {
        code: 'STORE_MATCH_QUEUED_TOO_LONG',
        message: `Aktuální data ${state.source.toUpperCase()} čekají na porovnání s katalogem prodejen déle než ${Math.round(queuedMinutes)} minut.`,
        recoveryAction: 'matching',
      },
    }
  }
  if (comparisonIssue && (
    (sourceStatus !== 'warning' && sourceStatus !== 'error')
    || (sourceStatus === 'warning' && comparisonIssue.status === 'error')
  )) {
    status = comparisonIssue.status
    attention = comparisonIssue.attention
  } else if (!attention && status === 'live' && (comparisonProgress.status === 'processing' || comparisonProgress.status === 'queued')) {
    status = 'processing'
  }

  return {
    source: state.source,
    status,
    lastAttemptAt: state.last_attempt_at,
    lastSuccessAt: state.last_success_at,
    lastChangeAt: state.last_change_at,
    ageHours,
    consecutiveFailureCount,
    lastErrorCode: state.last_error_code ?? taskState?.last_error_code ?? null,
    lastErrorMessage: state.last_error_message ?? taskState?.last_error_message ?? null,
    activeOutageCount: state.active_outage_count,
    futureOutageCount: state.future_outage_count,
    dataVersion: state.data_version,
    storeCatalogPending,
    storeRevisionProcessed: state.store_revision_processed,
    catalogScanRevision: state.source === 'cez' ? finiteInteger(cezScan?.storeRevision) : null,
    catalogScanProcessedStoreCount: state.source === 'cez' ? finiteInteger(cezScan?.nextStoreIndex) : null,
    processedRecordCount: latestRun?.source_record_count ?? 0,
    changeCount: typeof changeValue === 'number' && Number.isFinite(changeValue)
      ? Math.max(0, Math.trunc(changeValue))
      : latestRun?.status === 'no_change'
        ? 0
        : null,
    municipalityCoverage: typeof coverageValue === 'number' && Number.isFinite(coverageValue)
      ? `${Math.max(0, Math.trunc(coverageValue))} obcí`
      : state.source === 'egd' || state.source === 'pre'
        ? 'Celá distribuční oblast'
        : 'Probíhá průběžná kontrola',
    comparisonProgress,
    cezCollectors: null,
    attention,
  }
}

export async function getPowerOutageHealth() {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení Supabase pro kontrolu odstávek.')

  const [
    { data: states, error: stateError },
    { data: catalog, error: catalogError },
    { data: matchRun, error: matchError },
    { data: taskStates, error: taskStateError },
    { data: latestCezRun, error: latestCezRunError },
    { data: latestEgdRun, error: latestEgdRunError },
    { data: latestPreRun, error: latestPreRunError },
    cezOverview,
  ] = await Promise.all([
    client
      .from('power_outage_source_state')
      .select('source,last_attempt_at,last_success_at,last_change_at,consecutive_failure_count,last_error_code,last_error_message,active_outage_count,future_outage_count,data_version,store_revision_processed,metadata')
      .order('source'),
    client
      .from('power_outage_store_catalog_state')
      .select('revision,last_changed_at')
      .eq('singleton', true)
      .single<{ revision: number; last_changed_at: string }>(),
    client
      .from('power_outage_match_runs')
      .select('status,started_at,finished_at,store_revision,address_count,metadata,error_code,error_message')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('power_outage_task_state')
      .select('task_key,lock_expires_at,last_started_at,last_finished_at,last_success_at,last_status,consecutive_failure_count,last_error_code,last_error_message')
      .order('task_key'),
    client
      .from('power_outage_sync_runs')
      .select('source,status,source_record_count,outage_upsert_count,metadata')
      .eq('source', 'cez')
      .in('status', ['succeeded', 'no_change'])
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('power_outage_sync_runs')
      .select('source,status,source_record_count,outage_upsert_count,metadata')
      .eq('source', 'egd')
      .in('status', ['succeeded', 'no_change'])
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from('power_outage_sync_runs')
      .select('source,status,source_record_count,outage_upsert_count,metadata')
      .eq('source', 'pre')
      .in('status', ['succeeded', 'no_change'])
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    getCezCollectorOverview(client, 'cez'),
  ])
  if (stateError) throw stateError
  if (catalogError) throw catalogError
  if (matchError) throw matchError
  if (taskStateError) throw taskStateError
  if (latestCezRunError) throw latestCezRunError
  if (latestEgdRunError) throw latestEgdRunError
  if (latestPreRunError) throw latestPreRunError
  if (cezOverview.error) throw cezOverview.error

  const now = new Date()
  const latestRuns = new Map<PowerOutageSource, LatestRun>()
  if (latestCezRun) latestRuns.set('cez', latestCezRun as LatestRun)
  if (latestEgdRun) latestRuns.set('egd', latestEgdRun as LatestRun)
  if (latestPreRun) latestRuns.set('pre', latestPreRun as LatestRun)
  const tasks = (taskStates ?? []) as TaskState[]
  const taskByKey = new Map(tasks.map((task) => [task.task_key, task]))
  const typedStates = (states ?? []) as SourceState[]
  const baseSources = typedStates.map((state) => (
    sourceHealth(
      state,
      catalog.revision,
      catalog.last_changed_at,
      now.getTime(),
      latestRuns.get(state.source),
      taskByKey.get(`sync_${state.source}`),
      matchRun as MatchRun | null,
    )
  ))
  const cezState = typedStates.find((state) => state.source === 'cez') ?? null
  const cezCollectors = buildCezCollectorOverview(cezOverview.versions, cezOverview.union, cezState)
  const sources = baseSources.map((source) => {
    if (source.source !== 'cez' || !cezCollectors) return source

    // Once the versioned CEZ collectors are available, their individual cadence
    // is authoritative. The legacy aggregate source state uses a generic 8-hour
    // warning threshold, which is incompatible with the 24-hour v1 cadence and
    // can otherwise report SOURCE_DATA_STALE while both v1 and v2 are current.
    let status: PowerOutageSourceStatus = 'live'
    let attention: typeof source.attention = null
    const promote = (candidateStatus: PowerOutageSourceStatus, candidateAttention: typeof source.attention) => {
      if (SOURCE_STATUS_PRIORITY[candidateStatus] <= SOURCE_STATUS_PRIORITY[status]) return
      status = candidateStatus
      attention = candidateAttention
    }

    for (const version of cezCollectors.versions.filter((item) => item.isEnabled)) {
      const versionStatus = collectorHealthToSourceStatus(version.healthStatus)
      if (!versionStatus) continue
      promote(versionStatus, versionStatus === 'error' || versionStatus === 'warning'
        ? {
            code: version.cycleErrorCode ?? version.lastErrorCode ?? `CEZ_MARKET_${version.version.toUpperCase()}_${versionStatus.toUpperCase()}`,
            message: version.cycleErrorMessage
              ?? version.lastErrorMessage
              ?? `${version.displayName} neproběhla v očekávaném intervalu.`,
            recoveryAction: version.version === 'v2' ? 'cez_v2' as const : 'cez_v1' as const,
          }
        : null)
    }

    if (source.comparisonProgress.status === 'error') {
      promote('error', source.attention ?? {
        code: 'STORE_MATCH_FAILED',
        message: 'Porovnání odstávek ČEZ s katalogem prodejen selhalo.',
        recoveryAction: 'matching' as const,
      })
    } else if (source.comparisonProgress.status === 'processing' || source.comparisonProgress.status === 'queued') {
      promote('processing', null)
    }

    // Keep genuine legacy v1 failures or stalled runs. Only the generic stale
    // warning is superseded by the cadence-aware version health above.
    if (source.attention && source.attention.code !== 'SOURCE_DATA_STALE') {
      promote(source.status, source.attention)
    }

    return { ...source, status, attention, cezCollectors }
  })
  const hasError = sources.some((source) => source.status === 'error')
  const hasPending = sources.some((source) => source.status === 'pending')
  const hasProcessing = sources.some((source) => source.status === 'processing')
  const hasWarning = sources.some((source) => source.status === 'warning')
    || matchRun?.status === 'failed'
    || tasks.some((task) => task.last_status === 'failed')

  return {
    status: hasError
      ? 'error' as const
      : hasWarning
        ? 'warning' as const
        : hasPending
          ? 'pending' as const
          : hasProcessing
            ? 'processing' as const
            : 'live' as const,
    checkedAt: now.toISOString(),
    storeCatalog: {
      revision: catalog.revision,
      lastChangedAt: catalog.last_changed_at,
    },
    sources,
    matching: matchRun ?? null,
    tasks,
  }
}

export async function getPowerOutageSourceDiagnostic(
  source: PowerOutageSource,
): Promise<PowerOutageSourceDiagnostic> {
  if (source !== 'cez' && source !== 'egd' && source !== 'pre') throw new Error('Neznámý zdroj odstávek.')
  const { supabase } = await getPowerOutageRuntimeContext()
  const taskKey = source === 'cez' ? 'sync_cez' : source === 'egd' ? 'sync_egd' : 'sync_pre'

  const [stateResult, taskResult, catalogResult, storeCountResult, runsResult, health, cezOverview] = await Promise.all([
    supabase
      .from('power_outage_source_state')
      .select('source,last_attempt_at,last_success_at,last_change_at,last_error_at,latest_source_ref,latest_payload_sha256,active_outage_count,future_outage_count,consecutive_failure_count,last_error_code,last_error_message,data_version,store_revision_processed,lock_expires_at,metadata')
      .eq('source', source)
      .single(),
    supabase
      .from('power_outage_task_state')
      .select('last_started_at,last_finished_at,last_success_at,last_status,consecutive_failure_count,last_error_code,last_error_message,lock_expires_at')
      .eq('task_key', taskKey)
      .maybeSingle(),
    supabase
      .from('power_outage_store_catalog_state')
      .select('revision')
      .eq('singleton', true)
      .single<{ revision: number }>(),
    supabase
      .from('stores')
      .select('id', { count: 'exact', head: true }),
    supabase
      .from('power_outage_sync_runs')
      .select('id,trigger_kind,status,started_at,finished_at,source_record_count,outage_upsert_count,address_upsert_count,store_match_count,store_review_count,store_revision,error_code,error_message,metadata')
      .eq('source', source)
      .order('started_at', { ascending: false })
      .limit(12),
    getPowerOutageHealth(),
    getCezCollectorOverview(supabase, source),
  ])

  const error = [stateResult.error, taskResult.error, catalogResult.error, storeCountResult.error, runsResult.error, cezOverview.error].find(Boolean)
  if (error) throw new Error(`Provozní detail ${source.toUpperCase()} se nepodařilo načíst: ${error.message}`)
  if (!stateResult.data || !catalogResult.data) throw new Error(`Provozní stav ${source.toUpperCase()} není dostupný.`)

  const state = stateResult.data
  const task = taskResult.data
  const summary = health.sources.find((item) => item.source === source)
  const status = summary?.status ?? 'pending'
  const catalogRevision = Number(catalogResult.data.revision)
  const totalStoreCount = Math.max(0, storeCountResult.count ?? 0)
  const stateMetadata = objectValue(state.metadata) ?? {}
  const scan = source === 'cez' ? objectValue(stateMetadata.cezScan) : null
  const scanRevision = finiteInteger(scan?.storeRevision)
  const scanIndex = finiteInteger(scan?.nextStoreIndex)
  const batchHashes = Array.isArray(scan?.batchHashes) ? scan.batchHashes : []
  const isStoreRevisionPending = Number(state.store_revision_processed) < catalogRevision
  const activeCezScan = source === 'cez'
    && isStoreRevisionPending
    && scanRevision === catalogRevision
  const diagnosticCezCollectors = source === 'cez'
    ? buildCezCollectorOverview(
        cezOverview.versions,
        cezOverview.union,
        state as SourceState,
      )
    : null
  const progress = status === 'processing'
    ? source === 'cez'
      ? {
          mode: 'determinate' as const,
          phase: activeCezScan ? 'loading' as const : 'queued' as const,
          storeRevision: catalogRevision,
          processedStoreCount: activeCezScan ? Math.min(totalStoreCount, scanIndex ?? 0) : 0,
          totalStoreCount,
          percent: totalStoreCount > 0
            ? Math.min(100, Math.max(0, ((activeCezScan ? scanIndex ?? 0 : 0) / totalStoreCount) * 100))
            : 0,
          completedBatchCount: activeCezScan ? batchHashes.length : 0,
          startedAt: activeCezScan && typeof scan?.startedAt === 'string' ? scan.startedAt : null,
          lastProgressAt: activeCezScan ? state.last_attempt_at : null,
        }
      : {
          mode: 'indeterminate' as const,
          phase: task?.last_status === 'running' ? 'loading' as const : 'queued' as const,
          storeRevision: catalogRevision,
          processedStoreCount: null,
          totalStoreCount,
          percent: null,
          completedBatchCount: null,
          startedAt: task?.last_status === 'running' ? task.last_started_at : null,
          lastProgressAt: state.last_attempt_at,
        }
    : null

  return {
    generatedAt: new Date().toISOString(),
    source,
    status,
    attention: summary?.attention ?? null,
    sourceState: {
      lastAttemptAt: state.last_attempt_at,
      lastSuccessAt: state.last_success_at,
      lastChangeAt: state.last_change_at,
      lastErrorAt: state.last_error_at,
      latestSourceRef: state.latest_source_ref,
      latestPayloadSha256: state.latest_payload_sha256,
      activeOutageCount: state.active_outage_count,
      futureOutageCount: state.future_outage_count,
      consecutiveFailureCount: state.consecutive_failure_count,
      lastErrorCode: state.last_error_code,
      lastErrorMessage: state.last_error_message,
      dataVersion: Number(state.data_version),
      storeRevisionProcessed: Number(state.store_revision_processed),
      lockExpiresAt: state.lock_expires_at,
    },
    task: task ? {
      lastStartedAt: task.last_started_at,
      lastFinishedAt: task.last_finished_at,
      lastSuccessAt: task.last_success_at,
      lastStatus: task.last_status,
      consecutiveFailureCount: task.consecutive_failure_count,
      lastErrorCode: task.last_error_code,
      lastErrorMessage: task.last_error_message,
      lockExpiresAt: task.lock_expires_at,
    } : null,
    catalogRevision,
    progress,
    cezCollectors: diagnosticCezCollectors,
    runs: (runsResult.data ?? []).map((run) => ({
      id: run.id,
      triggerKind: run.trigger_kind,
      status: run.status,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      sourceRecordCount: run.source_record_count,
      outageUpsertCount: run.outage_upsert_count,
      addressUpsertCount: run.address_upsert_count,
      storeMatchCount: run.store_match_count,
      storeReviewCount: run.store_review_count,
      storeRevision: Number(run.store_revision),
      errorCode: run.error_code,
      errorMessage: run.error_message,
    })),
  }
}
