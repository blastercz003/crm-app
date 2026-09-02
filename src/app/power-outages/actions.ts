'use server'

import { revalidatePath } from 'next/cache'
import {
  getPowerOutageNotificationPreferences,
  updatePowerOutageNotificationPreferences,
} from '@/lib/power-outages/preferences'
import { getPowerOutageDetail } from '@/lib/power-outages/service'
import { getPowerOutageSourceDiagnostic } from '@/lib/power-outages/health'
import { getPowerOutageRuntimeContext } from '@/lib/power-outages/access'
import { getCompletePowerOutageDetail } from '@/lib/power-outages/complete-service'
import type {
  CompleteCommunicationStatus,
  CompletePowerOutageAssignment,
  CompletePowerOutageDetail,
} from '@/lib/power-outages/complete-types'
import type { PowerOutageDetail, PowerOutageNotificationPreferences, PowerOutageSource, PowerOutageSourceDiagnostic } from '@/lib/power-outages/types'

type PreferencesActionResult =
  | { success: true; preferences: PowerOutageNotificationPreferences; error: null }
  | { success: false; preferences: null; error: string }

type DetailActionResult =
  | { success: true; detail: PowerOutageDetail; error: null }
  | { success: false; detail: null; error: string }

type CompleteDetailActionResult =
  | { success: true; detail: CompletePowerOutageDetail; error: null }
  | { success: false; detail: null; error: string }

type CompleteAssignmentActionResult =
  | { success: true; assignment: CompletePowerOutageAssignment | null; error: null }
  | { success: false; assignment: null; error: string }

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

export async function getCompletePowerOutageDetailAction(candidateId: string): Promise<CompleteDetailActionResult> {
  try {
    return { success: true, detail: await getCompletePowerOutageDetail(candidateId), error: null }
  } catch (error) {
    return { success: false, detail: null, error: errorMessage(error) }
  }
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

export async function saveCompletePowerOutageAssignmentAction(input: {
  candidateId: string
  communicationStatus: CompleteCommunicationStatus
  notes: string
}): Promise<CompleteAssignmentActionResult> {
  try {
    if (!validUuid(input.candidateId)) throw new Error('Neplatné technické ID firmy.')
    if (!['not_contacted', 'contacted', 'follow_up', 'closed'].includes(input.communicationStatus)) {
      throw new Error('Vyberte platný stav komunikace.')
    }
    if (input.notes.length > 10_000) throw new Error('Poznámka může mít nejvýše 10 000 znaků.')
    const { supabase } = await getPowerOutageRuntimeContext()
    const { data, error } = await supabase.rpc('save_complete_power_outage_company_assignment', {
      p_candidate_id: input.candidateId,
      p_communication_status: input.communicationStatus,
      p_notes: input.notes,
    })
    if (error) throw new Error(`Záznam se nepodařilo uložit: ${error.message}`)
    const row = Array.isArray(data) ? data[0] : data
    if (!row) throw new Error('Uložené přiřazení nebylo vráceno.')
    revalidatePath('/power-outages')
    return {
      success: true,
      assignment: {
        ownerId: String(row.owner_id),
        ownerName: String(row.owner_name),
        communicationStatus: row.communication_status as CompleteCommunicationStatus,
        notes: String(row.notes ?? ''),
        claimedAt: String(row.claimed_at),
        updatedAt: String(row.updated_at),
      },
      error: null,
    }
  } catch (error) {
    return { success: false, assignment: null, error: errorMessage(error) }
  }
}

export async function releaseCompletePowerOutageAssignmentAction(
  candidateId: string,
): Promise<CompleteAssignmentActionResult> {
  try {
    if (!validUuid(candidateId)) throw new Error('Neplatné technické ID firmy.')
    const { supabase } = await getPowerOutageRuntimeContext()
    const { error } = await supabase.rpc('release_complete_power_outage_company_assignment', {
      p_candidate_id: candidateId,
    })
    if (error) throw new Error(`Přiřazení se nepodařilo zrušit: ${error.message}`)
    revalidatePath('/power-outages')
    return { success: true, assignment: null, error: null }
  } catch (error) {
    return { success: false, assignment: null, error: errorMessage(error) }
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
