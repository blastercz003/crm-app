import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'

type SourceState = {
  source: 'cez' | 'egd'
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

function sourceHealth(
  state: SourceState,
  storeRevision: number,
  nowMs: number,
) {
  const successMs = state.last_success_at
    ? new Date(state.last_success_at).getTime()
    : Number.NaN
  const ageHours = Number.isFinite(successMs)
    ? Math.max(0, (nowMs - successMs) / 3_600_000)
    : null
  const storeCatalogPending = state.store_revision_processed < storeRevision

  let status: 'pending' | 'live' | 'warning' | 'error'
  if (ageHours === null) status = 'pending'
  else if (state.consecutive_failure_count >= 2 || ageHours > 36) status = 'error'
  else if (state.consecutive_failure_count > 0 || ageHours > 30 || storeCatalogPending) status = 'warning'
  else status = 'live'

  return {
    source: state.source,
    status,
    lastAttemptAt: state.last_attempt_at,
    lastSuccessAt: state.last_success_at,
    lastChangeAt: state.last_change_at,
    ageHours,
    consecutiveFailureCount: state.consecutive_failure_count,
    lastErrorCode: state.last_error_code,
    lastErrorMessage: state.last_error_message,
    activeOutageCount: state.active_outage_count,
    futureOutageCount: state.future_outage_count,
    dataVersion: state.data_version,
    storeCatalogPending,
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
  ] = await Promise.all([
    client
      .from('power_outage_source_state')
      .select('source,last_attempt_at,last_success_at,last_change_at,consecutive_failure_count,last_error_code,last_error_message,active_outage_count,future_outage_count,data_version,store_revision_processed')
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
  ])
  if (stateError) throw stateError
  if (catalogError) throw catalogError
  if (matchError) throw matchError
  if (taskStateError) throw taskStateError

  const now = new Date()
  const sources = ((states ?? []) as SourceState[]).map((state) => (
    sourceHealth(state, catalog.revision, now.getTime())
  ))
  const hasError = sources.some((source) => source.status === 'error')
  const hasPending = sources.some((source) => source.status === 'pending')
  const hasWarning = sources.some((source) => source.status === 'warning')
    || matchRun?.status === 'failed'
    || ((taskStates ?? []) as TaskState[]).some((task) => task.last_status === 'failed')

  return {
    status: hasError
      ? 'error' as const
      : hasWarning
        ? 'warning' as const
        : hasPending
          ? 'pending' as const
          : 'live' as const,
    checkedAt: now.toISOString(),
    storeCatalog: {
      revision: catalog.revision,
      lastChangedAt: catalog.last_changed_at,
    },
    sources,
    matching: matchRun ?? null,
    tasks: (taskStates ?? []) as TaskState[],
  }
}
