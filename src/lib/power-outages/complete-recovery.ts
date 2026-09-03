import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'
import { normalizeCompletePowerOutageAddresses } from './complete-address-normalization'
import { syncCompletePowerOutageCatalogSource } from './complete-catalog-sync'
import { discoverCompletePowerOutageCompanies } from './complete-company-discovery'
import { reconcileCompletePowerOutageCompanies } from './complete-company-reconciliation'
import type { CompleteDiscoveryProvider } from './complete-company-providers'
import type { PowerOutageSource } from './types'

export type CompleteRecoveryRequest =
  | { target: 'source_projection'; source: PowerOutageSource }
  | { target: 'address_normalization' }
  | { target: 'provider_discovery'; provider: CompleteDiscoveryProvider }
  | { target: 'company_reconciliation' }

export type CompleteRecoveryResult = {
  status: 'started' | 'already_running' | 'not_needed' | 'manual_required'
  message: string
  result?: unknown
}

type TaskState = {
  task_key: string
  last_status: 'idle' | 'running' | 'succeeded' | 'partial' | 'failed' | 'skipped'
  last_error_code: string | null
  last_error_message: string | null
  lock_token: string | null
  lock_expires_at: string | null
}

function taskKey(input: CompleteRecoveryRequest) {
  if (input.target === 'source_projection') return `sync_${input.source}` as const
  if (input.target === 'provider_discovery') return `discover_${input.provider}` as const
  if (input.target === 'address_normalization') return 'normalize_addresses' as const
  return 'reconcile_companies' as const
}

function activeLock(task: TaskState) {
  if (!task.lock_token || !task.lock_expires_at) return false
  const expiresAt = new Date(task.lock_expires_at).getTime()
  return Number.isFinite(expiresAt) && expiresAt > Date.now()
}

function requiresManualRepair(task: TaskState) {
  const value = `${task.last_error_code ?? ''} ${task.last_error_message ?? ''}`
  if (/cpo_runs_one_running_uidx/i.test(value)) return false
  return /(?:API_KEY|provider_not_configured|schema cache|could not find (?:the )?(?:table|column|function)|does not exist|permission denied|unauthorized|violates (?:check|foreign key) constraint)/i.test(value)
}

async function closeOrphanRuns(
  client: NonNullable<ReturnType<typeof getServiceRoleClient>>,
  input: CompleteRecoveryRequest,
) {
  const staleBefore = new Date(Date.now() - 30 * 60_000).toISOString()
  let query = client
    .from('complete_power_outage_runs')
    .update({
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_count: 1,
      error_code: 'COMPLETE_ADMIN_RECOVERY',
      error_message: 'Osiřelý běh byl bezpečně ukončen administrátorskou obnovou.',
    })
    .eq('status', 'running')
    .lt('started_at', staleBefore)

  if (input.target === 'source_projection') {
    query = query.eq('run_kind', 'source_sync').eq('source', input.source)
  } else if (input.target === 'provider_discovery') {
    query = query.eq('run_kind', 'company_discovery').eq('provider', input.provider)
  } else if (input.target === 'address_normalization') {
    query = query.eq('run_kind', 'address_normalization')
  } else {
    query = query.eq('run_kind', 'company_reconciliation')
  }

  const { error } = await query
  if (error) throw error
}

export async function recoverCompletePowerOutageTask(
  input: CompleteRecoveryRequest,
): Promise<CompleteRecoveryResult> {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro obnovu zpracování.')

  const requestedTaskKey = taskKey(input)
  const { data, error } = await client
    .from('complete_power_outage_task_state')
    .select('task_key,last_status,last_error_code,last_error_message,lock_token,lock_expires_at')
    .eq('task_key', requestedTaskKey)
    .maybeSingle<TaskState>()
  if (error) throw error
  if (!data) throw new Error(`Stav úlohy ${requestedTaskKey} není dostupný.`)

  if (activeLock(data)) {
    return {
      status: 'already_running',
      message: 'Úloha už skutečně běží. Nebyla spuštěna její druhá kopie.',
    }
  }
  if (!['failed', 'partial'].includes(data.last_status)) {
    return {
      status: 'not_needed',
      message: 'Úloha už není v chybovém stavu. Obnova nebyla potřeba.',
    }
  }
  if (requiresManualRepair(data)) {
    return {
      status: 'manual_required',
      message: 'Tuto chybu nelze bezpečně opravit automatickým opakováním. Vyžaduje kontrolu konfigurace, databázového schématu nebo aplikace.',
    }
  }

  // Úloha nemá platný zámek a její poslední stav je chybný. Je proto bezpečné
  // uzavřít pouze její osiřelý technický běh; zdravé běhy jiných kroků zůstanou nedotčené.
  await closeOrphanRuns(client, input)

  if (input.target === 'provider_discovery') {
    const now = new Date().toISOString()
    const [{ error: lookupError }, { error: cacheError }] = await Promise.all([
      client
        .from('complete_power_outage_target_lookups')
        .update({ next_attempt_at: now })
        .eq('provider', input.provider)
        .eq('lookup_status', 'error'),
      client
        .from('complete_power_outage_lookup_cache')
        .update({ next_attempt_at: now })
        .eq('provider', input.provider)
        .eq('lookup_status', 'error'),
    ])
    if (lookupError) throw lookupError
    if (cacheError) throw cacheError
  }

  let result: unknown
  if (input.target === 'source_projection') {
    result = await syncCompletePowerOutageCatalogSource(input.source)
  } else if (input.target === 'provider_discovery') {
    const safeLimit = input.provider === 'ares' ? 100 : input.provider === 'mapy' ? 5 : 2
    result = await discoverCompletePowerOutageCompanies(input.provider, safeLimit)
  } else if (input.target === 'address_normalization') {
    result = await normalizeCompletePowerOutageAddresses(300)
  } else {
    result = await reconcileCompletePowerOutageCompanies(250)
  }

  const resultStatus = result && typeof result === 'object'
    ? String((result as Record<string, unknown>).status ?? '')
    : ''
  if (resultStatus === 'skipped') {
    return {
      status: 'already_running',
      message: 'Úlohu mezitím spustil automatický plán. Druhá kopie nebyla založena.',
      result,
    }
  }

  return {
    status: 'started',
    message: 'Obnova proběhla a bezpečná dávka zpracování byla dokončena.',
    result,
  }
}
