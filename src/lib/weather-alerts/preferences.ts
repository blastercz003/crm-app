import 'server-only'

import { getWeatherAlertsRuntimeContext } from './access'
import type { WeatherNotificationPreferences } from './types'

type PreferenceRow = {
  notifications_enabled: boolean
  include_yellow_warnings: boolean
  updated_at: string
}

export async function getWeatherNotificationPreferences(): Promise<WeatherNotificationPreferences> {
  const { supabase, user } = await getWeatherAlertsRuntimeContext()
  const { data, error } = await supabase
    .from('weather_notification_preferences')
    .select('notifications_enabled,include_yellow_warnings,updated_at')
    .eq('user_id', user.id)
    .maybeSingle<PreferenceRow>()

  if (error) {
    throw new Error(`Nastavení výstrah se nepodařilo načíst: ${error.message}`)
  }

  return {
    notificationsEnabled: data?.notifications_enabled ?? false,
    includeYellowWarnings: data?.include_yellow_warnings ?? false,
    updatedAt: data?.updated_at ?? null,
  }
}

export async function updateWeatherNotificationPreferences(input: {
  notificationsEnabled: boolean
  includeYellowWarnings: boolean
}): Promise<WeatherNotificationPreferences> {
  const { supabase, user } = await getWeatherAlertsRuntimeContext()
  const now = new Date().toISOString()
  const { data: current, error: currentError } = await supabase
    .from('weather_notification_preferences')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle<{ user_id: string }>()

  if (currentError) {
    throw new Error(`Nastavení výstrah se nepodařilo ověřit: ${currentError.message}`)
  }

  const values = {
    notifications_enabled: Boolean(input.notificationsEnabled),
    include_yellow_warnings:
      Boolean(input.notificationsEnabled) && Boolean(input.includeYellowWarnings),
    updated_at: now,
  }
  const query = current
    ? supabase
        .from('weather_notification_preferences')
        .update(values)
        .eq('user_id', user.id)
    : supabase.from('weather_notification_preferences').insert({
        user_id: user.id,
        ...values,
        created_at: now,
      })
  const { error } = await query

  if (error) {
    throw new Error(`Nastavení výstrah se nepodařilo uložit: ${error.message}`)
  }

  return {
    notificationsEnabled: values.notifications_enabled,
    includeYellowWarnings: values.include_yellow_warnings,
    updatedAt: now,
  }
}
