'use server'

import { revalidatePath } from 'next/cache'
import {
  getPowerOutageNotificationPreferences,
  updatePowerOutageNotificationPreferences,
} from '@/lib/power-outages/preferences'
import { getPowerOutageDetail } from '@/lib/power-outages/service'
import { getPowerOutageSourceDiagnostic } from '@/lib/power-outages/health'
import { getPowerOutageRuntimeContext } from '@/lib/power-outages/access'
import { getMarketClientEmailAdminWorkspace } from '@/lib/power-outages/client-email-admin'
import { planMarketClientEmailCandidates } from '@/lib/power-outages/client-email-candidates'
import { getResendConfigurationStatus } from '@/lib/power-outages/client-email-resend-config'
import { dispatchMarketClientEmails } from '@/lib/power-outages/client-email-worker'
import { getServiceRoleClient } from '@/lib/supabase/service'
import { getCompletePowerOutageAddressCoverageDiagnostic, getCompletePowerOutageCommunicationNotes, getCompletePowerOutageCount, getCompletePowerOutageDetail, getCompletePowerOutageOwners, getCompletePowerOutagePage, getCompletePowerOutageProviderDiagnostic, getCompletePowerOutageSidebarWorkspace, getCompletePowerOutageSourceDiagnostic, getCompletePowerOutageStatistics } from '@/lib/power-outages/complete-service'
import type {
  CompleteCommunicationStatus,
  CompleteAddressCoverageDiagnostic,
  CompletePowerOutageAssignment,
  CompletePowerOutageCommunicationNote,
  CompletePowerOutageDetail,
  CompletePowerOutagePage,
  CompletePowerOutagePageCursor,
  CompletePowerOutagePageFilters,
  CompletePowerOutageSidebarWorkspace,
  CompletePowerOutageStatistics,
  CompleteProviderDiagnostic,
  CompleteProviderState,
  CompleteSourceDiagnostic,
} from '@/lib/power-outages/complete-types'
import type { MarketClientEmailAdminWorkspace, MarketClientEmailMode, MarketClientEmailRecipientKind, PowerOutageDetail, PowerOutageNotificationPreferences, PowerOutageSource, PowerOutageSourceDiagnostic } from '@/lib/power-outages/types'

type PreferencesActionResult =
  | { success: true; preferences: PowerOutageNotificationPreferences; error: null }
  | { success: false; preferences: null; error: string }

type DetailActionResult =
  | { success: true; detail: PowerOutageDetail; error: null }
  | { success: false; detail: null; error: string }

type CompleteDetailActionResult =
  | { success: true; detail: CompletePowerOutageDetail; error: null }
  | { success: false; detail: null; error: string }

type CompletePageActionResult =
  | { success: true; page: CompletePowerOutagePage; error: null }
  | { success: false; page: null; error: string }

type CompleteCountActionResult =
  | { success: true; count: number; error: null }
  | { success: false; count: null; error: string }

type CompleteOwnersActionResult =
  | { success: true; owners: Array<{ id: string; name: string }>; error: null }
  | { success: false; owners: []; error: string }

type CompleteStatisticsActionResult =
  | { success: true; statistics: CompletePowerOutageStatistics; error: null }
  | { success: false; statistics: null; error: string }

type CompleteSidebarActionResult =
  | { success: true; workspace: CompletePowerOutageSidebarWorkspace; error: null }
  | { success: false; workspace: null; error: string }

type CompleteAssignmentActionResult =
  | { success: true; assignment: CompletePowerOutageAssignment | null; error: null }
  | { success: false; assignment: null; error: string }

type CompleteCommunicationNotesActionResult =
  | { success: true; notes: CompletePowerOutageCommunicationNote[]; error: null }
  | { success: false; notes: []; error: string }

type SourceDiagnosticActionResult =
  | { success: true; diagnostic: PowerOutageSourceDiagnostic; error: null }
  | { success: false; diagnostic: null; error: string }

type CompleteSourceDiagnosticActionResult =
  | { success: true; diagnostic: CompleteSourceDiagnostic; error: null }
  | { success: false; diagnostic: null; error: string }

type CompleteProviderDiagnosticActionResult =
  | { success: true; diagnostic: CompleteProviderDiagnostic; error: null }
  | { success: false; diagnostic: null; error: string }

type CompleteAddressCoverageDiagnosticActionResult =
  | { success: true; diagnostic: CompleteAddressCoverageDiagnostic; error: null }
  | { success: false; diagnostic: null; error: string }

type AcknowledgeMatchesActionResult =
  | { success: true; error: null }
  | { success: false; error: string }

type MarketClientEmailWorkspaceActionResult =
  | { success: true; workspace: MarketClientEmailAdminWorkspace; error: null }
  | { success: false; workspace: null; error: string }

type MarketClientEmailMutationActionResult =
  | { success: true; workspace: MarketClientEmailAdminWorkspace; error: null }
  | { success: false; workspace: null; error: string }

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

export async function getCompletePowerOutagePageAction(input: {
  filters: CompletePowerOutagePageFilters
  cursor: CompletePowerOutagePageCursor | null
}): Promise<CompletePageActionResult> {
  try {
    const { filters, cursor } = input
    if (!['current', 'archive'].includes(filters.mode)) throw new Error('Neplatný režim výpisu.')
    if (!['all', 'cez', 'egd', 'pre'].includes(filters.source)) throw new Error('Neplatný distributor.')
    if (!['all', 'registered_office', 'establishment', 'mixed'].includes(filters.entityKind)) throw new Error('Neplatný typ firmy.')
    if (!['visible', 'confirmed', 'needs_review', 'dismissed'].includes(filters.candidateStatus)) throw new Error('Neplatný stav výsledku.')
    if (filters.query.length > 200) throw new Error('Hledaný text je příliš dlouhý.')
    if (cursor && (!validUuid(cursor.id) || Number.isNaN(new Date(cursor.at).getTime()))) throw new Error('Neplatný kurzor stránky.')
    return { success: true, page: await getCompletePowerOutagePage(filters, cursor, 60), error: null }
  } catch (error) {
    return { success: false, page: null, error: errorMessage(error) }
  }
}

export async function getCompletePowerOutageCountAction(
  filters: CompletePowerOutagePageFilters,
): Promise<CompleteCountActionResult> {
  try {
    return { success: true, count: await getCompletePowerOutageCount(filters), error: null }
  } catch (error) {
    return { success: false, count: null, error: errorMessage(error) }
  }
}

export async function getCompletePowerOutageOwnersAction(): Promise<CompleteOwnersActionResult> {
  try {
    return { success: true, owners: await getCompletePowerOutageOwners(), error: null }
  } catch (error) {
    return { success: false, owners: [], error: errorMessage(error) }
  }
}

export async function getCompletePowerOutageStatisticsAction(): Promise<CompleteStatisticsActionResult> {
  try {
    return { success: true, statistics: await getCompletePowerOutageStatistics(), error: null }
  } catch (error) {
    return { success: false, statistics: null, error: errorMessage(error) }
  }
}

export async function getCompletePowerOutageSidebarAction(): Promise<CompleteSidebarActionResult> {
  try {
    return { success: true, workspace: await getCompletePowerOutageSidebarWorkspace(), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function getCompletePowerOutageCommunicationNotesAction(
  candidateId: string,
): Promise<CompleteCommunicationNotesActionResult> {
  try {
    return { success: true, notes: await getCompletePowerOutageCommunicationNotes(candidateId), error: null }
  } catch (error) {
    return { success: false, notes: [], error: errorMessage(error) }
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

export async function getCompletePowerOutageSourceDiagnosticAction(
  source: PowerOutageSource,
): Promise<CompleteSourceDiagnosticActionResult> {
  try {
    return { success: true, diagnostic: await getCompletePowerOutageSourceDiagnostic(source), error: null }
  } catch (error) {
    return { success: false, diagnostic: null, error: errorMessage(error) }
  }
}

export async function getCompletePowerOutageProviderDiagnosticAction(
  provider: 'ares' | 'mapy' | 'google',
  currentState?: CompleteProviderState,
): Promise<CompleteProviderDiagnosticActionResult> {
  try {
    return { success: true, diagnostic: await getCompletePowerOutageProviderDiagnostic(provider, currentState), error: null }
  } catch (error) {
    return { success: false, diagnostic: null, error: errorMessage(error) }
  }
}

export async function getCompletePowerOutageAddressCoverageDiagnosticAction(): Promise<CompleteAddressCoverageDiagnosticActionResult> {
  try {
    return { success: true, diagnostic: await getCompletePowerOutageAddressCoverageDiagnostic(), error: null }
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

export async function getMarketClientEmailAdminWorkspaceAction(): Promise<MarketClientEmailWorkspaceActionResult> {
  try {
    return {
      success: true,
      workspace: await getMarketClientEmailAdminWorkspace(),
      error: null,
    }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function saveMarketClientEmailConfigurationAction(input: {
  clientId: string
  mode: MarketClientEmailMode
  fromName: string
  fromEmail: string
  replyToEmail: string
  recipients: Array<{
    kind: MarketClientEmailRecipientKind
    name: string
    email: string
    isActive: boolean
  }>
}): Promise<MarketClientEmailMutationActionResult> {
  try {
    if (!validUuid(input.clientId)) throw new Error('Neplatné technické ID klienta.')
    if (!['disabled', 'shadow'].includes(input.mode)) {
      throw new Error('Režimy TEST a AKTIVNÍ budou dostupné až po zapojení e-mailového poskytovatele.')
    }
    if (input.fromName.length > 160 || input.fromEmail.length > 320 || input.replyToEmail.length > 320) {
      throw new Error('Údaj odesílatele je příliš dlouhý.')
    }
    if (input.recipients.length > 25) throw new Error('Lze uložit nejvýše 25 příjemců.')
    for (const recipient of input.recipients) {
      if (!['to', 'cc'].includes(recipient.kind)) throw new Error('Neplatný typ příjemce.')
      if (recipient.name.length > 160 || recipient.email.length > 320) {
        throw new Error('Údaj příjemce je příliš dlouhý.')
      }
    }

    const { supabase, profile } = await getPowerOutageRuntimeContext()
    if (profile.role !== 'admin') {
      throw new Error('Administrace klientských e-mailů je dostupná pouze administrátorům.')
    }
    const { error } = await supabase.rpc('save_power_outage_client_email_admin_configuration', {
      p_client_id: input.clientId,
      p_mode: input.mode,
      p_from_name: input.fromName,
      p_from_email: input.fromEmail,
      p_reply_to_email: input.replyToEmail,
      p_recipients: input.recipients,
    })
    if (error) throw new Error(`Konfiguraci se nepodařilo uložit: ${error.message}`)
    revalidatePath('/power-outages')
    return { success: true, workspace: await getMarketClientEmailAdminWorkspace(), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function setMarketClientEmailTestModeAction(input: {
  clientId: string
  enabled: boolean
}): Promise<MarketClientEmailMutationActionResult> {
  try {
    if (!validUuid(input.clientId)) throw new Error('Neplatné technické ID klienta.')
    const { profile } = await getPowerOutageRuntimeContext()
    if (profile.role !== 'admin') throw new Error('Tuto operaci může provést pouze administrátor.')

    if (input.enabled) {
      const configuration = getResendConfigurationStatus()
      if (!configuration.testReady) {
        throw new Error(`TEST nelze spustit: ${configuration.issues.join(' ')}`)
      }
    }

    const service = getServiceRoleClient()
    if (!service) throw new Error('Chybí zabezpečené serverové připojení pro TEST režim.')
    const { error } = await service.rpc('set_power_outage_client_email_test_mode', {
      p_client_id: input.clientId,
      p_enabled: input.enabled,
    })
    if (error) throw new Error(`TEST režim se nepodařilo změnit: ${error.message}`)

    if (input.enabled) {
      try {
        await planMarketClientEmailCandidates(200)
      } catch (planningError) {
        await service.rpc('set_power_outage_client_email_test_mode', {
          p_client_id: input.clientId,
          p_enabled: false,
        })
        throw planningError
      }
    }

    revalidatePath('/power-outages')
    return { success: true, workspace: await getMarketClientEmailAdminWorkspace(), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function sendMarketClientEmailTestAction(
  clientId: string,
): Promise<MarketClientEmailMutationActionResult> {
  try {
    if (!validUuid(clientId)) throw new Error('Neplatné technické ID klienta.')
    const { profile } = await getPowerOutageRuntimeContext()
    if (profile.role !== 'admin') throw new Error('Tuto operaci může provést pouze administrátor.')

    const configuration = getResendConfigurationStatus()
    if (!configuration.testReady) {
      throw new Error(`Kontrolní e-mail nelze odeslat: ${configuration.issues.join(' ')}`)
    }

    const service = getServiceRoleClient()
    if (!service) throw new Error('Chybí zabezpečené serverové připojení pro kontrolní e-mail.')
    const { error } = await service.rpc('queue_power_outage_client_email_manual_test', {
      p_client_id: clientId,
    })
    if (error) throw new Error(`Kontrolní e-mail se nepodařilo zařadit: ${error.message}`)

    await dispatchMarketClientEmails(10)
    revalidatePath('/power-outages')
    return { success: true, workspace: await getMarketClientEmailAdminWorkspace(), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function setMarketClientEmailLivePilotAction(input: {
  clientId: string
  enabled: boolean
  confirmation?: string
}): Promise<MarketClientEmailMutationActionResult> {
  try {
    if (!validUuid(input.clientId)) throw new Error('Neplatné technické ID klienta.')
    const { profile } = await getPowerOutageRuntimeContext()
    if (profile.role !== 'admin') throw new Error('Tuto operaci může provést pouze administrátor.')

    if (input.enabled) {
      if (input.confirmation !== 'SEND_TO_REAL_RECIPIENTS') {
        throw new Error('Chybí výslovné potvrzení ostrého odesílání skutečným příjemcům.')
      }
      const configuration = getResendConfigurationStatus()
      if (!configuration.liveReady) {
        throw new Error(`Ostrý pilot nelze spustit: ${configuration.issues.join(' ')}`)
      }
    }

    const service = getServiceRoleClient()
    if (!service) throw new Error('Chybí zabezpečené serverové připojení pro ostrý pilot.')
    const { error } = await service.rpc('set_power_outage_client_email_live_pilot', {
      p_client_id: input.clientId,
      p_enabled: input.enabled,
    })
    if (error) throw new Error(`Ostrý pilot se nepodařilo změnit: ${error.message}`)

    if (input.enabled) {
      try {
        await planMarketClientEmailCandidates(200)
      } catch (planningError) {
        await service.rpc('set_power_outage_client_email_live_pilot', {
          p_client_id: input.clientId,
          p_enabled: false,
        })
        throw planningError
      }
    }

    revalidatePath('/power-outages')
    return { success: true, workspace: await getMarketClientEmailAdminWorkspace(), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function retryMarketClientEmailDeliveryAction(
  deliveryId: string,
): Promise<MarketClientEmailMutationActionResult> {
  try {
    if (!validUuid(deliveryId)) throw new Error('Neplatné technické ID zprávy.')
    const { supabase, profile } = await getPowerOutageRuntimeContext()
    if (profile.role !== 'admin') throw new Error('Tuto operaci může provést pouze administrátor.')
    const { error } = await supabase.rpc('retry_power_outage_client_email_delivery', {
      p_delivery_id: deliveryId,
    })
    if (error) throw new Error(`Opakování zprávy se nepodařilo připravit: ${error.message}`)
    return { success: true, workspace: await getMarketClientEmailAdminWorkspace(), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function skipMarketClientEmailDeliveryAction(
  deliveryId: string,
): Promise<MarketClientEmailMutationActionResult> {
  try {
    if (!validUuid(deliveryId)) throw new Error('Neplatné technické ID zprávy.')
    const { supabase, profile } = await getPowerOutageRuntimeContext()
    if (profile.role !== 'admin') throw new Error('Tuto operaci může provést pouze administrátor.')
    const { error } = await supabase.rpc('skip_power_outage_client_email_delivery', {
      p_delivery_id: deliveryId,
    })
    if (error) throw new Error(`Přeskočení zprávy se nepodařilo uložit: ${error.message}`)
    return { success: true, workspace: await getMarketClientEmailAdminWorkspace(), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function setMarketClientEmailShadowRuleAction(input: {
  clientId: string
  eventKind: 'new_outage' | 'schedule_changed' | 'cancelled'
  enabled: boolean
}): Promise<MarketClientEmailMutationActionResult> {
  try {
    if (!validUuid(input.clientId)) throw new Error('Neplatné technické ID klienta.')
    if (!['new_outage', 'schedule_changed', 'cancelled'].includes(input.eventKind)) {
      throw new Error('Tento typ události zatím nelze aktivovat.')
    }
    const { supabase, profile } = await getPowerOutageRuntimeContext()
    if (profile.role !== 'admin') throw new Error('Tuto operaci může provést pouze administrátor.')
    const { error } = await supabase.rpc('set_power_outage_client_email_shadow_rule', {
      p_client_id: input.clientId,
      p_event_kind: input.eventKind,
      p_enabled: input.enabled,
    })
    if (error) throw new Error(`Stínové pravidlo se nepodařilo změnit: ${error.message}`)
    if (input.enabled) await planMarketClientEmailCandidates(200)
    revalidatePath('/power-outages')
    return { success: true, workspace: await getMarketClientEmailAdminWorkspace(), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function refreshMarketClientEmailShadowAction(): Promise<MarketClientEmailMutationActionResult> {
  try {
    const { profile } = await getPowerOutageRuntimeContext()
    if (profile.role !== 'admin') throw new Error('Tuto operaci může provést pouze administrátor.')
    await planMarketClientEmailCandidates(200)
    return { success: true, workspace: await getMarketClientEmailAdminWorkspace(), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}
