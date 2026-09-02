import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'

export type CompletePowerOutageTaskKey =
  | 'sync_cez'
  | 'sync_egd'
  | 'sync_pre'
  | 'normalize_addresses'
  | 'discover_ares'
  | 'discover_res'
  | 'discover_mapy'
  | 'discover_google'
  | 'reconcile_companies'
  | 'archive'
  | 'watchdog'

export async function claimCompletePowerOutageTask(
  taskKey: CompletePowerOutageTaskKey,
  leaseSeconds: number,
) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro zámek kompletních odstávek.')

  const { data, error } = await client.rpc('claim_complete_power_outage_task', {
    requested_task_key: taskKey,
    requested_lease_seconds: Math.max(60, Math.trunc(leaseSeconds)),
  })
  if (error) throw error
  return typeof data === 'string' && data.length > 0 ? data : null
}

export async function finishCompletePowerOutageTask(input: {
  taskKey: CompletePowerOutageTaskKey
  lockToken: string
  status: 'succeeded' | 'partial' | 'failed' | 'skipped'
  processedCount?: number
  errorCode?: string | null
  errorMessage?: string | null
  cursor?: Record<string, unknown>
}) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro dokončení úlohy kompletních odstávek.')

  const { data, error } = await client.rpc('finish_complete_power_outage_task', {
    requested_task_key: input.taskKey,
    requested_lock_token: input.lockToken,
    requested_status: input.status,
    requested_processed_count: Math.max(0, Math.trunc(input.processedCount ?? 0)),
    requested_error_code: input.errorCode ?? null,
    requested_error_message: input.errorMessage?.slice(0, 2_000) ?? null,
    requested_cursor: input.cursor ?? {},
  })
  if (error) throw error
  return data === true
}
