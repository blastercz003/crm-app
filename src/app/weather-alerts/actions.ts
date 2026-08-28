'use server'

import { revalidatePath } from 'next/cache'
import {
  getWeatherNotificationPreferences,
  updateWeatherNotificationPreferences,
} from '@/lib/weather-alerts/preferences'
import type { WeatherNotificationPreferences } from '@/lib/weather-alerts/types'

type WeatherPreferencesActionResult =
  | { success: true; preferences: WeatherNotificationPreferences; error: null }
  | { success: false; preferences: null; error: string }

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Nastavení výstrah se nepodařilo zpracovat.'
}

export async function getWeatherNotificationPreferencesAction(): Promise<WeatherPreferencesActionResult> {
  try {
    return {
      success: true,
      preferences: await getWeatherNotificationPreferences(),
      error: null,
    }
  } catch (error) {
    return { success: false, preferences: null, error: errorMessage(error) }
  }
}

export async function updateWeatherNotificationPreferencesAction(input: {
  notificationsEnabled: boolean
  includeYellowWarnings: boolean
}): Promise<WeatherPreferencesActionResult> {
  try {
    const preferences = await updateWeatherNotificationPreferences(input)
    revalidatePath('/weather-alerts')
    return { success: true, preferences, error: null }
  } catch (error) {
    return { success: false, preferences: null, error: errorMessage(error) }
  }
}
