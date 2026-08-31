import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'

export type PowerOutageTaskKey =
  | 'sync_cez'
  | 'sync_egd'
  | 'store_queue'
  | 'watchdog'
  | 'archive'
  | 'store_audit'
  | 'notification_plan'

export async function claimPowerOutageTask(
  taskKey: PowerOutageTaskKey,
  leaseSeconds: number,
) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro zámek úlohy odstávek.')

  const { data, error } = await client.rpc('claim_power_outage_task', {
    requested_task_key: taskKey,
    requested_lease_seconds: Math.max(60, Math.trunc(leaseSeconds)),
  })
  if (error) throw error
  return typeof data === 'string' && data.length > 0 ? data : null
}

export async function finishPowerOutageTask(input: {
  taskKey: PowerOutageTaskKey
  lockToken: string
  succeeded: boolean
  errorCode?: string | null
  errorMessage?: string | null
  metadata?: Record<string, unknown>
}) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro dokončení úlohy odstávek.')

  const { error } = await client.rpc('finish_power_outage_task', {
    requested_task_key: input.taskKey,
    requested_lock_token: input.lockToken,
    succeeded: input.succeeded,
    error_code: input.errorCode ?? null,
    error_message: input.errorMessage?.slice(0, 2_000) ?? null,
    result_metadata: input.metadata ?? {},
  })
  if (error) throw error
}
