import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { getPowerOutageRuntimeContext } from './access'
import type { PowerOutageSource, PowerOutageSourceDiagnostic } from './types'

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
    storeCatalogPending
    && cezScan
    && finiteInteger(cezScan.storeRevision) === storeRevision,
  )
  const processing = taskState?.last_status === 'running' || (
    storeCatalogPending
    && (activeCezScan || consecutiveFailureCount === 0)
  )
  const lastProgressMs = state.last_attempt_at ? Date.parse(state.last_attempt_at) : Number.NaN
  const taskStartedMs = taskState?.last_started_at ? Date.parse(taskState.last_started_at) : Number.NaN
  const catalogChangedMs = Date.parse(storeRevisionChangedAt)
  const processingStalled = processing && (
    activeCezScan
      ? !Number.isFinite(lastProgressMs) || nowMs - lastProgressMs > 45 * 60 * 1_000
      : taskState?.last_status === 'running'
        ? !Number.isFinite(taskStartedMs) || nowMs - taskStartedMs > 90 * 60 * 1_000
        : Number.isFinite(catalogChangedMs) && nowMs - catalogChangedMs > (
            state.source === 'cez' ? 45 * 60 * 1_000 : state.source === 'pre' ? 4 * 60 * 60 * 1_000 : 7 * 60 * 60 * 1_000
          )
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
      .select('status,started_at,finished_at,store_revision,error_code,error_message')
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
  ])
  if (stateError) throw stateError
  if (catalogError) throw catalogError
  if (matchError) throw matchError
  if (taskStateError) throw taskStateError
  if (latestCezRunError) throw latestCezRunError
  if (latestEgdRunError) throw latestEgdRunError
  if (latestPreRunError) throw latestPreRunError

  const now = new Date()
  const latestRuns = new Map<PowerOutageSource, LatestRun>()
  if (latestCezRun) latestRuns.set('cez', latestCezRun as LatestRun)
  if (latestEgdRun) latestRuns.set('egd', latestEgdRun as LatestRun)
  if (latestPreRun) latestRuns.set('pre', latestPreRun as LatestRun)
  const tasks = (taskStates ?? []) as TaskState[]
  const taskByKey = new Map(tasks.map((task) => [task.task_key, task]))
  const sources = ((states ?? []) as SourceState[]).map((state) => (
    sourceHealth(
      state,
      catalog.revision,
      catalog.last_changed_at,
      now.getTime(),
      latestRuns.get(state.source),
      taskByKey.get(`sync_${state.source}`),
    )
  ))
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

  const [stateResult, taskResult, catalogResult, storeCountResult, runsResult, health] = await Promise.all([
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
  ])

  const error = [stateResult.error, taskResult.error, catalogResult.error, storeCountResult.error, runsResult.error].find(Boolean)
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
