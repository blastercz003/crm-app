'use server'

import { revalidatePath } from 'next/cache'
import {
  getWeatherNotificationPreferences,
  updateWeatherNotificationPreferences,
} from '@/lib/weather-alerts/preferences'
import { getWeatherEventDetail, getWeatherSourceStatus } from '@/lib/weather-alerts/service'
import type { WeatherEventDetail, WeatherNotificationPreferences, WeatherSourceStatus } from '@/lib/weather-alerts/types'

type WeatherPreferencesActionResult =
  | { success: true; preferences: WeatherNotificationPreferences; error: null }
  | { success: false; preferences: null; error: string }

type WeatherEventDetailActionResult =
  | { success: true; detail: WeatherEventDetail; error: null }
  | { success: false; detail: null; error: string }

type WeatherSourceStatusActionResult =
  | { success: true; status: WeatherSourceStatus; error: null }
  | { success: false; status: null; error: string }

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
  extendedNotificationsEnabled: boolean
}): Promise<WeatherPreferencesActionResult> {
  try {
    const preferences = await updateWeatherNotificationPreferences(input)
    revalidatePath('/weather-alerts')
    return { success: true, preferences, error: null }
  } catch (error) {
    return { success: false, preferences: null, error: errorMessage(error) }
  }
}

export async function getWeatherEventDetailAction(eventId: string): Promise<WeatherEventDetailActionResult> {
  try {
    return { success: true, detail: await getWeatherEventDetail(eventId), error: null }
  } catch (error) {
    return { success: false, detail: null, error: errorMessage(error) }
  }
}

export async function getWeatherSourceStatusAction(): Promise<WeatherSourceStatusActionResult> {
  try {
    return { success: true, status: await getWeatherSourceStatus(), error: null }
  } catch (error) {
    return { success: false, status: null, error: errorMessage(error) }
  }
}
