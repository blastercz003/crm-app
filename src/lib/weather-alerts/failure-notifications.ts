import 'server-only'

import { createNotificationsForAdmins } from '@/lib/notifications/createNotification'
import { getServiceRoleClient } from '@/lib/supabase/service'
import { CHMI_SOURCE } from './types'

type WeatherSourceFailureState = {
  last_success_at: string | null
  last_error_at: string | null
  consecutive_failure_count: number | null
}

export const WEATHER_FAILURE_NOTIFICATION_THRESHOLD = 3

function formatDateTime(value: string | null) {
  if (!value) return 'zatím neproběhlo'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'neuvedeno'
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export async function notifyAdminsAfterWeatherSyncFailure() {
  const client = getServiceRoleClient()
  if (!client) return { notified: false, reason: 'missing_service_client' as const }

  const { data, error } = await client
    .from('weather_source_state')
    .select('last_success_at,last_error_at,consecutive_failure_count')
    .eq('source', CHMI_SOURCE)
    .maybeSingle<WeatherSourceFailureState>()
  if (error) throw error

  const failureCount = data?.consecutive_failure_count ?? 0
  if (failureCount < WEATHER_FAILURE_NOTIFICATION_THRESHOLD) {
    return { notified: false, reason: 'below_threshold' as const, failureCount }
  }

  const incidentKey = data?.last_success_at ?? 'before-first-success'
  await createNotificationsForAdmins({
    supabase: client,
    actorUserId: null,
    category: 'weather',
    type: 'weather_sync_unavailable',
    title: 'VÝSTRAHY ČHMÚ – VÝPADEK SYNCHRONIZACE',
    message: `Automatické načítání dat ČHMÚ selhalo ${failureCount}× za sebou. Poslední úspěšná aktualizace: ${formatDateTime(data?.last_success_at ?? null)}.`,
    entityType: 'weather_sync',
    entityId: CHMI_SOURCE,
    href: '/weather-alerts',
    priority: 'high',
    dedupeKey: `weather-sync-outage:${incidentKey}`,
    skipSelfNotification: false,
    returnExistingOnDuplicate: true,
  })

  return {
    notified: true,
    failureCount,
    lastErrorAt: data?.last_error_at ?? null,
  }
}
