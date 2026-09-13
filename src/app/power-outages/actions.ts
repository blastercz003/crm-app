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
import { getCompleteNotificationResendConfiguration } from '@/lib/power-outages/complete-notification-email-resend-config'
import { acknowledgeCompleteNotificationEmailPilotPause, acknowledgeCompleteNotificationEmailProductionPause, activateCompleteNotificationEmailLivePilot, activateCompleteNotificationEmailProduction, decideCompleteNotificationEmailPilotReview, decideCompletePowerOutageContactReview, decideCompletePowerOutageDomainReview, getCompleteNotificationEmailDeliveryHistory, getCompleteNotificationEmailManagementWorkspace, getCompletePowerOutageAddressCoverageDiagnostic, getCompletePowerOutageCommercialSelectionCounts, getCompletePowerOutageCommunicationNotes, getCompletePowerOutageContactManagementWorkspace, getCompletePowerOutageCount, getCompletePowerOutageDetail, getCompletePowerOutageOwners, getCompletePowerOutagePage, getCompletePowerOutageProviderDiagnostic, getCompletePowerOutageSidebarWorkspace, getCompletePowerOutageSourceDiagnostic, getCompletePowerOutageStatistics, pauseCompleteNotificationEmailLivePilot, pauseCompleteNotificationEmailProduction, prepareCompleteNotificationEmailProductionActivation, prepareCompletePowerOutageContactSelector, setCompleteNotificationEmailPilotAllowlist, setCompleteNotificationEmailProductionConfig, setCompletePowerOutageContactRuntime } from '@/lib/power-outages/complete-service'
import type {
  CompleteCommunicationStatus,
  CompleteContactManagementWorkspace,
  CompleteNotificationEmailDeliveryHistory,
  CompleteNotificationEmailActivationConfirmation,
  CompleteNotificationEmailManagementWorkspace,
  CompleteCommercialSelectionCounts,
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
import type { MarketClientEmailAdminWorkspace, MarketClientEmailEventKind, MarketClientEmailMode, MarketClientEmailRecipientKind, PowerOutageDetail, PowerOutageNotificationPreferences, PowerOutageSource, PowerOutageSourceDiagnostic } from '@/lib/power-outages/types'

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

type CompleteCommercialSelectionCountsActionResult =
  | { success: true; counts: CompleteCommercialSelectionCounts; error: null }
  | { success: false; counts: null; error: string }

type CompleteOwnersActionResult =
  | { success: true; owners: Array<{ id: string; name: string }>; error: null }
  | { success: false; owners: []; error: string }

type CompleteStatisticsActionResult =
  | { success: true; statistics: CompletePowerOutageStatistics; error: null }
  | { success: false; statistics: null; error: string }

type CompleteSidebarActionResult =
  | { success: true; workspace: CompletePowerOutageSidebarWorkspace; error: null }
  | { success: false; workspace: null; error: string }

type CompleteContactManagementActionResult =
  | { success: true; workspace: CompleteContactManagementWorkspace; error: null }
  | { success: false; workspace: null; error: string }

type CompleteNotificationEmailManagementActionResult =
  | { success: true; workspace: CompleteNotificationEmailManagementWorkspace; error: null }
  | { success: false; workspace: null; error: string }

type CompleteNotificationEmailActivationPreparationActionResult =
  | { success: true; confirmation: CompleteNotificationEmailActivationConfirmation; error: null }
  | { success: false; confirmation: null; error: string }

type CompleteNotificationEmailDeliveryHistoryActionResult =
  | { success: true; history: CompleteNotificationEmailDeliveryHistory; error: null }
  | { success: false; history: null; error: string }

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
    if (typeof filters.clientsOnly !== 'boolean') throw new Error('Neplatný filtr klientských odstávek.')
    if (!['all', 'top', 'large_companies', 'grade_a', 'grade_b'].includes(filters.commercialSelection)) throw new Error('Neplatný obchodní výběr.')
    if (!['date', 'score'].includes(filters.commercialSort)) throw new Error('Neplatné řazení obchodního výběru.')
    if (filters.query.length > 200) throw new Error('Hledaný text je příliš dlouhý.')
    if (cursor && (!validUuid(cursor.id) || Number.isNaN(new Date(cursor.at).getTime()))) throw new Error('Neplatný kurzor stránky.')
    if (cursor?.clientPriority != null && typeof cursor.clientPriority !== 'boolean') throw new Error('Neplatná priorita kurzoru stránky.')
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

export async function getCompletePowerOutageCommercialSelectionCountsAction(
  filters: CompletePowerOutagePageFilters,
): Promise<CompleteCommercialSelectionCountsActionResult> {
  try {
    return { success: true, counts: await getCompletePowerOutageCommercialSelectionCounts(filters), error: null }
  } catch (error) {
    return { success: false, counts: null, error: errorMessage(error) }
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

export async function getCompletePowerOutageContactManagementAction(): Promise<CompleteContactManagementActionResult> {
  try {
    return { success: true, workspace: await getCompletePowerOutageContactManagementWorkspace(), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function decideCompletePowerOutageContactReviewAction(input: {
  contactId: string
  decision: 'approved' | 'rejected'
}): Promise<CompleteContactManagementActionResult> {
  try {
    if (!validUuid(input.contactId)) throw new Error('Neplatné technické ID kontaktu.')
    if (!['approved', 'rejected'].includes(input.decision)) throw new Error('Neplatné rozhodnutí o kontaktu.')
    return { success: true, workspace: await decideCompletePowerOutageContactReview(input.contactId, input.decision), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function decideCompletePowerOutageDomainReviewAction(input: {
  ico: string
  domain: string
  decision: 'approved' | 'rejected'
}): Promise<CompleteContactManagementActionResult> {
  try {
    if (!/^\d{8}$/.test(input.ico)) throw new Error('Neplatné IČO firmy.')
    if (!/^[a-z0-9.-]+$/.test(input.domain) || input.domain.length > 253) throw new Error('Neplatná doména firmy.')
    if (!['approved', 'rejected'].includes(input.decision)) throw new Error('Neplatné rozhodnutí o doméně.')
    return { success: true, workspace: await decideCompletePowerOutageDomainReview(input.ico, input.domain, input.decision), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function prepareCompletePowerOutageContactSelectorAction(
  selectorKey: string,
): Promise<CompleteContactManagementActionResult> {
  try {
    if (!/^[a-z0-9_]{2,64}$/.test(selectorKey)) throw new Error('Neplatný klíč výběru.')
    return { success: true, workspace: await prepareCompletePowerOutageContactSelector(selectorKey), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function setCompletePowerOutageContactRuntimeAction(input: {
  enabled: boolean
  braveFallbackEnabled: boolean
}): Promise<CompleteContactManagementActionResult> {
  try {
    if (typeof input.enabled !== 'boolean' || typeof input.braveFallbackEnabled !== 'boolean') {
      throw new Error('Neplatné nastavení dohledávání kontaktů.')
    }
    if (!input.enabled && input.braveFallbackEnabled) throw new Error('Brave fallback vyžaduje zapnuté dohledávání.')
    return {
      success: true,
      workspace: await setCompletePowerOutageContactRuntime(input.enabled, input.braveFallbackEnabled),
      error: null,
    }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function getCompleteNotificationEmailManagementAction(): Promise<CompleteNotificationEmailManagementActionResult> {
  try {
    return { success: true, workspace: await getCompleteNotificationEmailManagementWorkspace(), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function setCompleteNotificationEmailProductionConfigAction(input: {
  dailySendLimit: number
  monthlySendLimit: number
  minimumIntervalSeconds: number
  sendWindowStart: string
  sendWindowEnd: string
  sendWeekdays: number[]
  maximumOutageHorizonDays: number
  minimumOutageLeadMinutes: number
  reason: string
}): Promise<CompleteNotificationEmailManagementActionResult> {
  try {
    const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/
    const normalizedReason = input.reason.trim()
    if (!Number.isInteger(input.dailySendLimit) || input.dailySendLimit < 1 || input.dailySendLimit > 100) throw new Error('Denní limit musí být mezi 1 a 100.')
    if (!Number.isInteger(input.monthlySendLimit) || input.monthlySendLimit < input.dailySendLimit || input.monthlySendLimit > 2500) throw new Error('Měsíční limit musí být nejméně denní limit a nejvýše 2500.')
    if (!Number.isInteger(input.minimumIntervalSeconds) || input.minimumIntervalSeconds < 60 || input.minimumIntervalSeconds > 3600) throw new Error('Rozestup musí být mezi 1 a 60 minutami.')
    if (!timePattern.test(input.sendWindowStart) || !timePattern.test(input.sendWindowEnd) || input.sendWindowStart >= input.sendWindowEnd) throw new Error('Odesílací okno nemá platný začátek a konec.')
    const uniqueWeekdays = [...new Set(input.sendWeekdays)]
    if (uniqueWeekdays.length < 1 || uniqueWeekdays.length > 7 || uniqueWeekdays.some((day) => !Number.isInteger(day) || day < 1 || day > 7)) throw new Error('Vyberte alespoň jeden platný den v týdnu.')
    if (!Number.isInteger(input.maximumOutageHorizonDays) || input.maximumOutageHorizonDays < 1 || input.maximumOutageHorizonDays > 30) throw new Error('Časový horizont musí být mezi 1 a 30 dny.')
    if (!Number.isInteger(input.minimumOutageLeadMinutes) || input.minimumOutageLeadMinutes < 0 || input.minimumOutageLeadMinutes > 4320) throw new Error('Minimální předstih musí být mezi 0 a 72 hodinami.')
    if (normalizedReason.length < 3 || normalizedReason.length > 500) throw new Error('Důvod změny musí mít 3 až 500 znaků.')
    return {
      success: true,
      workspace: await setCompleteNotificationEmailProductionConfig({
        ...input,
        sendWeekdays: uniqueWeekdays.sort((left, right) => left - right),
        reason: normalizedReason,
      }),
      error: null,
    }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function prepareCompleteNotificationEmailProductionActivationAction(): Promise<CompleteNotificationEmailActivationPreparationActionResult> {
  try {
    const configuration = getCompleteNotificationResendConfiguration()
    if (!configuration.liveReady) throw new Error(`Resend LIVE není připraven: ${configuration.issues.join(' ')}`)
    return {
      success: true,
      confirmation: await prepareCompleteNotificationEmailProductionActivation(),
      error: null,
    }
  } catch (error) {
    return { success: false, confirmation: null, error: errorMessage(error) }
  }
}

export async function activateCompleteNotificationEmailProductionAction(
  confirmationToken: string,
): Promise<CompleteNotificationEmailManagementActionResult> {
  try {
    if (!validUuid(confirmationToken)) throw new Error('Druhé potvrzení aktivace není platné.')
    const configuration = getCompleteNotificationResendConfiguration()
    if (!configuration.liveReady) throw new Error(`Resend LIVE není připraven: ${configuration.issues.join(' ')}`)
    return { success: true, workspace: await activateCompleteNotificationEmailProduction(confirmationToken), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function pauseCompleteNotificationEmailProductionAction(
  reason: string,
): Promise<CompleteNotificationEmailManagementActionResult> {
  try {
    const normalizedReason = reason.trim()
    if (normalizedReason.length < 3 || normalizedReason.length > 500) throw new Error('Důvod musí mít 3 až 500 znaků.')
    return { success: true, workspace: await pauseCompleteNotificationEmailProduction(normalizedReason), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function acknowledgeCompleteNotificationEmailProductionPauseAction(
  note: string,
): Promise<CompleteNotificationEmailManagementActionResult> {
  try {
    const normalizedNote = note.trim()
    if (normalizedNote.length < 3 || normalizedNote.length > 500) throw new Error('Poznámka musí mít 3 až 500 znaků.')
    return { success: true, workspace: await acknowledgeCompleteNotificationEmailProductionPause(normalizedNote), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function getCompleteNotificationEmailDeliveryHistoryAction(input: {
  offset: number
  status: 'all' | 'sent' | 'delivered' | 'bounced' | 'complaint' | 'error'
  search: string
  dateFrom: string | null
  dateTo: string | null
}): Promise<CompleteNotificationEmailDeliveryHistoryActionResult> {
  try {
    if (!Number.isInteger(input.offset) || input.offset < 0 || input.offset > 1_000_000) throw new Error('Neplatná stránka historie.')
    if (!['all', 'sent', 'delivered', 'bounced', 'complaint', 'error'].includes(input.status)) throw new Error('Neplatný filtr historie.')
    if (input.search.length > 120) throw new Error('Vyhledávaný text je příliš dlouhý.')
    const isoDate = /^\d{4}-\d{2}-\d{2}$/
    if (input.dateFrom && !isoDate.test(input.dateFrom)) throw new Error('Neplatné počáteční datum.')
    if (input.dateTo && !isoDate.test(input.dateTo)) throw new Error('Neplatné koncové datum.')
    return { success: true, history: await getCompleteNotificationEmailDeliveryHistory(input), error: null }
  } catch (error) {
    return { success: false, history: null, error: errorMessage(error) }
  }
}

export async function decideCompleteNotificationEmailPilotReviewAction(input: {
  planId: string
  decision: 'approved' | 'rejected' | 'revoked'
}): Promise<CompleteNotificationEmailManagementActionResult> {
  try {
    if (!validUuid(input.planId)) throw new Error('Neplatné ID připraveného oznámení.')
    if (!['approved', 'rejected', 'revoked'].includes(input.decision)) throw new Error('Neplatné rozhodnutí o oznámení.')
    return { success: true, workspace: await decideCompleteNotificationEmailPilotReview(input.planId, input.decision), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function setCompleteNotificationEmailPilotAllowlistAction(input: {
  planId: string
  included: boolean
}): Promise<CompleteNotificationEmailManagementActionResult> {
  try {
    if (!validUuid(input.planId)) throw new Error('Neplatné ID připraveného oznámení.')
    return { success: true, workspace: await setCompleteNotificationEmailPilotAllowlist(input.planId, input.included), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function acknowledgeCompleteNotificationEmailPilotPauseAction(
  note: string,
): Promise<CompleteNotificationEmailManagementActionResult> {
  try {
    const normalizedNote = note.trim()
    if (normalizedNote.length < 3 || normalizedNote.length > 500) throw new Error('Poznámka musí mít 3 až 500 znaků.')
    return { success: true, workspace: await acknowledgeCompleteNotificationEmailPilotPause(normalizedNote), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function activateCompleteNotificationEmailLivePilotAction(
  confirmation: string,
): Promise<CompleteNotificationEmailManagementActionResult> {
  try {
    if (confirmation !== 'AKTIVOVAT PILOT KOMPLETNÍ') throw new Error('Zadejte přesnou potvrzovací frázi.')
    const configuration = getCompleteNotificationResendConfiguration()
    if (!configuration.liveReady) throw new Error(`Resend LIVE není připraven: ${configuration.issues.join(' ')}`)
    return { success: true, workspace: await activateCompleteNotificationEmailLivePilot(confirmation), error: null }
  } catch (error) {
    return { success: false, workspace: null, error: errorMessage(error) }
  }
}

export async function pauseCompleteNotificationEmailLivePilotAction(
  reason: string,
): Promise<CompleteNotificationEmailManagementActionResult> {
  try {
    const normalizedReason = reason.trim()
    if (normalizedReason.length < 3 || normalizedReason.length > 500) throw new Error('Důvod musí mít 3 až 500 znaků.')
    return { success: true, workspace: await pauseCompleteNotificationEmailLivePilot(normalizedReason), error: null }
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
  includeErrorDetails = true,
): Promise<CompleteProviderDiagnosticActionResult> {
  try {
    return { success: true, diagnostic: await getCompletePowerOutageProviderDiagnostic(provider, currentState, includeErrorDetails), error: null }
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

    const { supabase, user } = await getPowerOutageRuntimeContext({ requireMarkets: true })
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
      throw new Error('Režimy TEST a AKTIVNÍ se mění pouze samostatným bezpečnostním krokem.')
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

export async function setMarketClientEmailLiveAction(input: {
  clientId: string
  enabled: boolean
  eventKinds: MarketClientEmailEventKind[]
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
        throw new Error(`Ostrý režim nelze spustit: ${configuration.issues.join(' ')}`)
      }
      if (input.eventKinds.length === 0) throw new Error('Vyberte alespoň jedno pravidlo.')
      const allowedEventKinds: MarketClientEmailEventKind[] = ['new_outage', 'schedule_changed', 'cancelled', 'reminder_24h', 'missing_job_72h']
      if (input.eventKinds.some((eventKind) => !allowedEventKinds.includes(eventKind))) {
        throw new Error('Výběr obsahuje neplatné pravidlo.')
      }
      if (input.eventKinds.includes('missing_job_72h') && input.eventKinds.length !== 1) {
        throw new Error('Pravidlo Bez objednávky – 3 dny předem musí být aktivní samostatně.')
      }
    }

    const service = getServiceRoleClient()
    if (!service) throw new Error('Chybí zabezpečené serverové připojení pro ostrý režim.')
    const { error } = await service.rpc('set_power_outage_client_email_live', {
      p_client_id: input.clientId,
      p_enabled: input.enabled,
      p_event_kinds: input.enabled ? input.eventKinds : [],
    })
    if (error) throw new Error(`Ostrý režim se nepodařilo změnit: ${error.message}`)

    if (input.enabled) {
      try {
        await planMarketClientEmailCandidates(200)
      } catch (planningError) {
        await service.rpc('set_power_outage_client_email_live', {
          p_client_id: input.clientId,
          p_enabled: false,
          p_event_kinds: [],
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
  eventKind: MarketClientEmailEventKind
  enabled: boolean
}): Promise<MarketClientEmailMutationActionResult> {
  try {
    if (!validUuid(input.clientId)) throw new Error('Neplatné technické ID klienta.')
    const allowedEventKinds: MarketClientEmailEventKind[] = ['new_outage', 'schedule_changed', 'cancelled', 'reminder_24h', 'missing_job_72h']
    if (!allowedEventKinds.includes(input.eventKind)) {
      throw new Error('Neplatný typ e-mailového pravidla.')
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
