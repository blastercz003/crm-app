import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'

export async function archiveExpiredPowerOutages() {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro archivaci odstávek.')
  const { data, error } = await client.rpc('archive_expired_power_outages')
  if (error) throw error
  return data as {
    completedCount: number
    archivedCount: number
    processedAt: string
  }
}

export async function runPowerOutageWatchdog() {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro watchdog odstávek.')
  const { data, error } = await client.rpc('run_power_outage_watchdog')
  if (error) throw error
  return data as {
    expiredTaskLocks: number
    staleSourceRuns: number
    staleMatchRuns: number
    staleStoreAudits: number
    staleSources: number
    checkedAt: string
  }
}
