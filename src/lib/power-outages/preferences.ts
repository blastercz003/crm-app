import 'server-only'

import { getPowerOutageRuntimeContext } from './access'
import { getPowerOutageNotificationScope } from './notification-access'
import type { PowerOutageNotificationPreferences } from './types'

type PreferenceRow = {
  notifications_enabled: boolean
  reminder_24h_enabled: boolean
  updated_at: string
}

export async function getPowerOutageNotificationPreferences(): Promise<PowerOutageNotificationPreferences> {
  const { supabase, user } = await getPowerOutageRuntimeContext()
  const { data, error } = await supabase
    .from('power_outage_notification_preferences')
    .select('notifications_enabled,reminder_24h_enabled,updated_at')
    .eq('user_id', user.id)
    .maybeSingle<PreferenceRow>()

  if (error) {
    throw new Error(`Nastavení upozornění na odstávky se nepodařilo načíst: ${error.message}`)
  }

  return {
    notificationsEnabled: data?.notifications_enabled ?? false,
    reminder24hEnabled: false,
    updatedAt: data?.updated_at ?? null,
  }
}

export async function updatePowerOutageNotificationPreferences(input: {
  notificationsEnabled: boolean
  reminder24hEnabled: boolean
}): Promise<PowerOutageNotificationPreferences> {
  const { supabase, user, profile } = await getPowerOutageRuntimeContext()
  const notificationScope = await getPowerOutageNotificationScope(supabase, profile)
  if (input.notificationsEnabled && !notificationScope) {
    throw new Error('Upozornění na odstávky může zapnout pouze administrátor nebo pověřený uživatel.')
  }
  const now = new Date().toISOString()
  const values = {
    notifications_enabled: Boolean(input.notificationsEnabled),
    reminder_24h_enabled: false,
    updated_at: now,
  }
  const { data: existing, error: existingError } = await supabase
    .from('power_outage_notification_preferences')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle<{ user_id: string }>()
  if (existingError) {
    throw new Error(`Nastavení upozornění na odstávky se nepodařilo ověřit: ${existingError.message}`)
  }

  const query = existing
    ? supabase
        .from('power_outage_notification_preferences')
        .update(values)
        .eq('user_id', user.id)
    : supabase.from('power_outage_notification_preferences').insert({
        user_id: user.id,
        ...values,
        created_at: now,
      })
  const { error } = await query
  if (error) {
    throw new Error(`Nastavení upozornění na odstávky se nepodařilo uložit: ${error.message}`)
  }

  return {
    notificationsEnabled: values.notifications_enabled,
    reminder24hEnabled: values.reminder_24h_enabled,
    updatedAt: now,
  }
}
