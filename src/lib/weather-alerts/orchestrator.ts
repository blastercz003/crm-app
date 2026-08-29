import { getServiceRoleClient } from '@/lib/supabase/service'
import { dispatchWeatherNotifications } from './notifications'
import { reconcileWeatherEvents } from './reconcile'
import { importLatestChmiCap } from './sync'
import { CHMI_SOURCE } from './types'

function message(error: unknown) {
  if (error instanceof Error) return error.message
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  return 'Neznámá chyba zpracování výstrah.'
}

export async function syncWeatherAlerts() {
  const imported = await importLatestChmiCap()
  if (!imported.sourceMessageId) {
    throw new Error('Synchronizace ČHMÚ nemá zdrojovou zprávu ke zpracování.')
  }

  try {
    const reconciliation = await reconcileWeatherEvents({
      sourceMessageId: imported.sourceMessageId,
      syncRunId: imported.syncRunId,
      importStatus: imported.status,
    })
    const notifications = await dispatchWeatherNotifications({
      sourceMessageId: imported.sourceMessageId,
    })
    const client = getServiceRoleClient()
    if (!client) throw new Error('Chybí serverové připojení pro dokončení synchronizace.')
    const { error: runError } = await client
      .from('weather_sync_runs')
      .update({ notification_created_count: notifications.createdCount })
      .eq('id', imported.syncRunId)
    if (runError) throw runError

    return { ...imported, reconciliation, notifications }
  } catch (error) {
    const client = getServiceRoleClient()
    const now = new Date().toISOString()
    if (client) {
      const { data: failureState } = await client
        .from('weather_source_state')
        .select('consecutive_failure_count')
        .eq('source', CHMI_SOURCE)
        .maybeSingle<{ consecutive_failure_count: number | null }>()
      await Promise.allSettled([
        client
          .from('weather_sync_runs')
          .update({
            status: 'failed',
            finished_at: now,
            error_code: 'WEATHER_PROCESSING_FAILED',
            error_message: message(error).slice(0, 2_000),
          })
          .eq('id', imported.syncRunId),
        client
          .from('weather_source_state')
          .upsert({
            source: CHMI_SOURCE,
            last_error_at: now,
            last_error_code: 'WEATHER_PROCESSING_FAILED',
            last_error_message: message(error).slice(0, 2_000),
            consecutive_failure_count:
              (failureState?.consecutive_failure_count ?? 0) + 1,
            updated_at: now,
          }, { onConflict: 'source' }),
      ])
    }
    throw error
  }
}
