'use server'

import { revalidatePath } from 'next/cache'
import {
  getPowerOutageNotificationPreferences,
  updatePowerOutageNotificationPreferences,
} from '@/lib/power-outages/preferences'
import { getPowerOutageDetail } from '@/lib/power-outages/service'
import { getPowerOutageSourceDiagnostic } from '@/lib/power-outages/health'
import { getPowerOutageRuntimeContext } from '@/lib/power-outages/access'
import type { PowerOutageDetail, PowerOutageNotificationPreferences, PowerOutageSource, PowerOutageSourceDiagnostic } from '@/lib/power-outages/types'

type PreferencesActionResult =
  | { success: true; preferences: PowerOutageNotificationPreferences; error: null }
  | { success: false; preferences: null; error: string }

type DetailActionResult =
  | { success: true; detail: PowerOutageDetail; error: null }
  | { success: false; detail: null; error: string }

type SourceDiagnosticActionResult =
  | { success: true; diagnostic: PowerOutageSourceDiagnostic; error: null }
  | { success: false; diagnostic: null; error: string }

type AcknowledgeMatchesActionResult =
  | { success: true; error: null }
  | { success: false; error: string }

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Nastavení upozornění na odstávky se nepodařilo zpracovat.'
}

export async function getPowerOutageNotificationPreferencesAction(): Promise<PreferencesActionResult> {
  try {
    return {
      success: true,
      preferences: await getPowerOutageNotificationPreferences(),
      error: null,
    }
  } catch (error) {
    return { success: false, preferences: null, error: errorMessage(error) }
  }
}

export async function updatePowerOutageNotificationPreferencesAction(input: {
  notificationsEnabled: boolean
  reminder24hEnabled: boolean
}): Promise<PreferencesActionResult> {
  try {
    const preferences = await updatePowerOutageNotificationPreferences(input)
    revalidatePath('/power-outages')
    return { success: true, preferences, error: null }
  } catch (error) {
    return { success: false, preferences: null, error: errorMessage(error) }
  }
}

export async function getPowerOutageDetailAction(matchId: string): Promise<DetailActionResult> {
  try {
    return { success: true, detail: await getPowerOutageDetail(matchId), error: null }
  } catch (error) {
    return { success: false, detail: null, error: errorMessage(error) }
  }
}

export async function getPowerOutageSourceDiagnosticAction(source: PowerOutageSource): Promise<SourceDiagnosticActionResult> {
  try {
    return { success: true, diagnostic: await getPowerOutageSourceDiagnostic(source), error: null }
  } catch (error) {
    return { success: false, diagnostic: null, error: errorMessage(error) }
  }
}

export async function acknowledgePowerOutageMatchesAction(
  matchIds: string[],
): Promise<AcknowledgeMatchesActionResult> {
  try {
    const uniqueMatchIds = [...new Set(matchIds)]
      .filter((matchId) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(matchId))
      .slice(0, 500)

    if (uniqueMatchIds.length === 0) return { success: true, error: null }

    const { supabase, user } = await getPowerOutageRuntimeContext()
    const { error } = await supabase
      .from('power_outage_match_views')
      .upsert(
        uniqueMatchIds.map((matchId) => ({
          user_id: user.id,
          match_id: matchId,
        })),
        {
          onConflict: 'user_id,match_id',
          ignoreDuplicates: true,
        },
      )

    if (error) {
      throw new Error(`Zobrazení nových odstávek se nepodařilo uložit: ${error.message}`)
    }

    return { success: true, error: null }
  } catch (error) {
    return { success: false, error: errorMessage(error) }
  }
}
