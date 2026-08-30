import 'server-only'

import { createNotification } from '@/lib/notifications/createNotification'
import { getServiceRoleClient } from '@/lib/supabase/service'
import type { WeatherNotificationDispatchResult } from './types'

type ServiceClient = NonNullable<ReturnType<typeof getServiceRoleClient>>
type NotificationReason =
  | 'new_event'
  | 'severity_increased'
  | 'area_expanded'
  | 'onset_advanced'
type DeliveryStatus = 'created' | 'deduplicated' | 'failed'

type NotifiableVersion = {
  id: string
  event_id: string
  created_at: string
  change_reasons: string[] | null
  severity: string
  severity_level: number
  event_name: string
  headline: string | null
  onset_at: string | null
  valid_to: string | null
  status: string
}

type PreferenceRow = {
  user_id: string
  include_yellow_warnings: boolean
  updated_at: string
}

type DeliveryRow = {
  dedupe_key: string
  delivery_status: DeliveryStatus
}

const REASON_PRIORITY: NotificationReason[] = [
  'severity_increased',
  'area_expanded',
  'onset_advanced',
  'new_event',
]

const REASON_TITLES: Record<NotificationReason, string> = {
  new_event: 'NOVÁ VÝSTRAHA ČHMÚ',
  severity_increased: 'ZVÝŠENÍ STUPNĚ VÝSTRAHY',
  area_expanded: 'ROZŠÍŘENÍ VÝSTRAHY ČHMÚ',
  onset_advanced: 'VÝSTRAHA ČHMÚ ZAČNE DŘÍVE',
}

const SEVERITY_LABELS: Record<string, string> = {
  Moderate: 'žlutý stupeň',
  Severe: 'oranžový stupeň',
  Extreme: 'červený stupeň',
}

function selectReason(reasons: string[] | null): NotificationReason | null {
  const values = new Set(reasons ?? [])
  return REASON_PRIORITY.find((reason) => values.has(reason)) ?? null
}

function formatDateTime(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function notificationMessage(version: NotifiableVersion) {
  const name = version.headline?.trim() || version.event_name
  const severity = SEVERITY_LABELS[version.severity] ?? version.severity
  const onset = formatDateTime(version.onset_at)
  const validTo = formatDateTime(version.valid_to)
  const validity = onset && validTo
    ? ` Platnost ${onset}–${validTo}.`
    : onset
      ? ` Začátek ${onset}.`
      : validTo
        ? ` Platnost do ${validTo}.`
        : ''
  return `${name} · ${severity}.${validity}`
}

async function storeDelivery(
  client: ServiceClient,
  input: {
    userId: string
    version: NotifiableVersion
    reason: NotificationReason
    dedupeKey: string
    status: DeliveryStatus
    notificationId: string | null
    pushDelivery: Record<string, unknown>
    errorMessage: string | null
  },
) {
  const { error } = await client
    .from('weather_notification_deliveries')
    .upsert(
      {
        user_id: input.userId,
        event_id: input.version.event_id,
        event_version_id: input.version.id,
        notification_reason: input.reason,
        severity: input.version.severity,
        dedupe_key: input.dedupeKey,
        delivery_status: input.status,
        notification_id: input.notificationId,
        push_delivery: input.pushDelivery,
        error_message: input.errorMessage,
      },
      { onConflict: 'dedupe_key' },
    )
  if (error) throw error
}

export async function dispatchWeatherNotifications(input: {
  sourceMessageId: string
}): Promise<WeatherNotificationDispatchResult> {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro odeslání výstrah.')

  const { data: versionData, error: versionError } = await client
    .from('weather_event_versions')
    .select(
      'id,event_id,created_at,change_reasons,severity,severity_level,event_name,headline,onset_at,valid_to,status',
    )
    .eq('source_message_id', input.sourceMessageId)
    .eq('is_notifiable_change', true)
    .in('status', ['upcoming', 'active'])
  if (versionError) throw versionError

  const versions = (versionData ?? []) as NotifiableVersion[]
  if (versions.length === 0) {
    return { createdCount: 0, deduplicatedCount: 0, failedCount: 0, skippedCount: 0 }
  }

  const { data: preferenceData, error: preferenceError } = await client
    .from('weather_notification_preferences')
    .select('user_id,include_yellow_warnings,updated_at')
    .eq('notifications_enabled', true)
  if (preferenceError) throw preferenceError

  const preferences = (preferenceData ?? []) as PreferenceRow[]
  if (preferences.length === 0) {
    return {
      createdCount: 0,
      deduplicatedCount: 0,
      failedCount: 0,
      skippedCount: versions.length,
    }
  }

  const userIds = preferences.map((preference) => preference.user_id)
  const { data: profileData, error: profileError } = await client
    .from('profiles')
    .select('id')
    .in('id', userIds)
    .eq('can_view_weather_alerts', true)
  if (profileError) throw profileError
  const allowedUsers = new Set((profileData ?? []).map((profile) => profile.id as string))

  const possibleDedupeKeys: string[] = []
  for (const preference of preferences) {
    if (!allowedUsers.has(preference.user_id)) continue
    for (const version of versions) {
      const reason = selectReason(version.change_reasons)
      if (reason) {
        possibleDedupeKeys.push(
          `weather:${preference.user_id}:${version.id}:${reason}`,
        )
      }
    }
  }

  const existingDeliveries = new Map<string, DeliveryStatus>()
  if (possibleDedupeKeys.length > 0) {
    const { data, error } = await client
      .from('weather_notification_deliveries')
      .select('dedupe_key,delivery_status')
      .in('dedupe_key', possibleDedupeKeys)
    if (error) throw error
    for (const delivery of (data ?? []) as DeliveryRow[]) {
      existingDeliveries.set(delivery.dedupe_key, delivery.delivery_status)
    }
  }

  const result: WeatherNotificationDispatchResult = {
    createdCount: 0,
    deduplicatedCount: 0,
    failedCount: 0,
    skippedCount: 0,
  }

  for (const preference of preferences) {
    if (!allowedUsers.has(preference.user_id)) {
      result.skippedCount += versions.length
      continue
    }

    for (const version of versions) {
      const reason = selectReason(version.change_reasons)
      if (!reason) {
        result.skippedCount += 1
        continue
      }

      const dedupeKey = `weather:${preference.user_id}:${version.id}:${reason}`
      const previousStatus = existingDeliveries.get(dedupeKey)
      if (previousStatus && previousStatus !== 'failed') {
        result.skippedCount += 1
        continue
      }
      if (version.severity_level <= 1 && !preference.include_yellow_warnings) {
        result.skippedCount += 1
        continue
      }
      if (!previousStatus && version.created_at < preference.updated_at) {
        result.skippedCount += 1
        continue
      }

      try {
        const notification = await createNotification({
          supabase: client,
          recipientUserId: preference.user_id,
          actorUserId: null,
          category: 'weather',
          type: `weather_${reason}`,
          title: REASON_TITLES[reason],
          message: notificationMessage(version),
          entityType: 'weather_alert',
          entityId: version.event_id,
          href: `/weather-alerts?event=${version.event_id}`,
          priority: version.severity_level >= 2 ? 'high' : 'normal',
          dedupeKey,
          skipSelfNotification: false,
          returnExistingOnDuplicate: true,
        })
        if (!notification) throw new Error('Notifikaci se nepodařilo vytvořit.')

        const status: DeliveryStatus = notification.deduplicated
          ? 'deduplicated'
          : 'created'
        await storeDelivery(client, {
          userId: preference.user_id,
          version,
          reason,
          dedupeKey,
          status,
          notificationId: notification.id,
          pushDelivery: notification.deduplicated
            ? { attempted: false, reason: 'deduplicated' }
            : notification.pushDelivery
              ? { ...notification.pushDelivery }
              : { attempted: false, reason: 'push-result-unavailable' },
          errorMessage: null,
        })
        existingDeliveries.set(dedupeKey, status)
        if (notification.deduplicated) result.deduplicatedCount += 1
        else result.createdCount += 1
      } catch (error) {
        const text = error instanceof Error ? error.message : 'Neznámá chyba doručení.'
        try {
          await storeDelivery(client, {
            userId: preference.user_id,
            version,
            reason,
            dedupeKey,
            status: 'failed',
            notificationId: null,
            pushDelivery: { attempted: false, reason: 'notification-create-failed' },
            errorMessage: text.slice(0, 2_000),
          })
          existingDeliveries.set(dedupeKey, 'failed')
        } catch (deliveryError) {
          console.error('Nepodařilo se uložit chybu doručení výstrahy.', deliveryError)
        }
        result.failedCount += 1
      }
    }
  }

  return result
}
