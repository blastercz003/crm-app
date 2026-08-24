'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { getActivityRuntimeContext } from '@/lib/activities/access'
import { normalizeActivityDateTime } from '@/lib/activities/date'
import {
  MANUAL_ACTIVITY_TYPES,
  type ActivityActionState,
  type ActivityRecurrenceUnit,
  type ActivityRow,
  type ManualActivityType,
} from '@/lib/activities/types'
import { logUserActivity } from '@/lib/activity-log/logUserActivity'
import { getActivityAdminReport, getManualActivityPage } from '@/lib/activities/service'
import type { ActivityReportActionResult, ActivityReportInput } from '@/lib/activities/types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_DESCRIPTION_LENGTH = 5000
const MAX_COMPLETION_RESULT_LENGTH = 5000
const MAX_RECURRENCE_INTERVAL = 365
const PRAGUE_TIME_ZONE = 'Europe/Prague'

export async function getActivityReportAction(
  input: ActivityReportInput,
): Promise<ActivityReportActionResult> {
  try {
    return {
      success: true,
      error: null,
      report: await getActivityAdminReport(input),
    }
  } catch (error) {
    unstable_rethrow(error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Report aktivit se nepodařilo načíst.',
    }
  }
}

export async function loadManualActivityPageAction(input: {
  userId: string
  kind: 'planned' | 'logged'
  offset: number
  limit?: number
}): Promise<{
  success: boolean
  error: string | null
  items: import('@/lib/activities/types').ActivityListItem[]
  total: number
  nextOffset: number
  hasMore: boolean
}> {
  try {
    const page = await getManualActivityPage(input)
    return { success: true, error: null, ...page }
  } catch (error) {
    unstable_rethrow(error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Další aktivity se nepodařilo načíst.',
      items: [],
      total: 0,
      nextOffset: input.offset,
      hasMore: false,
    }
  }
}

function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function getOptionalString(formData: FormData, key: string) {
  const value = getString(formData, key)
  return value || null
}

function getBoolean(formData: FormData, key: string) {
  const value = getString(formData, key).toLowerCase()
  return value === '1' || value === 'true' || value === 'on'
}

function normalizeUuid(value: string | null) {
  return value && UUID_PATTERN.test(value) ? value : null
}

function normalizeManualActivityType(value: string): ManualActivityType {
  if (MANUAL_ACTIVITY_TYPES.includes(value as ManualActivityType)) {
    return value as ManualActivityType
  }

  throw new Error('Vybraný typ aktivity není platný.')
}

function normalizeRecurrenceUnit(value: string): ActivityRecurrenceUnit | null {
  if (!value) return null
  if (value === 'day' || value === 'week' || value === 'month') return value
  throw new Error('Vybrané opakování není platné.')
}

function getPragueDateParts(value: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute'), second: read('second') }
}

function pragueLocalToIso(parts: { year: number; month: number; day: number; hour: number; minute: number; second: number }) {
  let timestamp = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  const desiredWallTime = timestamp

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const actual = getPragueDateParts(new Date(timestamp).toISOString())
    const actualWallTime = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second)
    const correction = desiredWallTime - actualWallTime
    timestamp += correction
    if (correction === 0) break
  }

  return new Date(timestamp).toISOString()
}

function getRecurringOccurrence(params: {
  anchorAt: string
  unit: ActivityRecurrenceUnit
  interval: number
  sequence: number
}) {
  const { anchorAt, unit, interval, sequence } = params
  const anchor = getPragueDateParts(anchorAt)
  const step = interval * sequence
  const local = new Date(Date.UTC(anchor.year, anchor.month - 1, anchor.day, anchor.hour, anchor.minute, anchor.second))

  if (unit === 'month') {
    const targetMonth = new Date(Date.UTC(anchor.year, anchor.month - 1 + step, 1))
    const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate()
    return pragueLocalToIso({
      year: targetMonth.getUTCFullYear(),
      month: targetMonth.getUTCMonth() + 1,
      day: Math.min(anchor.day, lastDay),
      hour: anchor.hour,
      minute: anchor.minute,
      second: anchor.second,
    })
  }

  local.setUTCDate(local.getUTCDate() + step * (unit === 'week' ? 7 : 1))
  return pragueLocalToIso({
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: anchor.hour,
    minute: anchor.minute,
    second: anchor.second,
  })
}

function getNextRecurringOccurrence(activity: ActivityRow, completedAt: string) {
  if (!activity.recurrence_unit || !activity.recurrence_interval || !activity.recurrence_anchor_at) return null
  let sequence = Math.max(0, activity.recurrence_sequence) + 1

  for (let attempt = 0; attempt < 12000; attempt += 1, sequence += 1) {
    const scheduledFor = getRecurringOccurrence({
      anchorAt: activity.recurrence_anchor_at,
      unit: activity.recurrence_unit,
      interval: activity.recurrence_interval,
      sequence,
    })
    if (new Date(scheduledFor).getTime() > new Date(completedAt).getTime()) {
      return { scheduledFor, sequence }
    }
  }

  throw new Error('Další termín opakované aktivity se nepodařilo vypočítat.')
}

function normalizeDateTime(value: string | null, label: string, fallback?: Date) {
  if (!value && fallback) return fallback.toISOString()
  if (!value) throw new Error(`${label} je povinný.`)

  const normalized = normalizeActivityDateTime(value)
  if (!normalized) throw new Error(`${label} nemá platný formát.`)

  return normalized
}

async function assertAccessibleClient(params: {
  supabase: Awaited<ReturnType<typeof getActivityRuntimeContext>>['supabase']
  clientId: string | null
}) {
  const { supabase, clientId } = params
  if (!clientId) return

  const { data, error } = await supabase
    .from('clients')
    .select('id')
    .eq('id', clientId)
    .maybeSingle<{ id: string }>()

  if (error || !data) {
    throw new Error('Vybraný klient nebyl nalezen nebo k němu nemáte přístup.')
  }
}

function parseManualActivityForm(formData: FormData) {
  const activityType = normalizeManualActivityType(getString(formData, 'activity_type'))
  const title = getString(formData, 'title')
  const description = getOptionalString(formData, 'description')
  const clientIdRaw = getOptionalString(formData, 'client_id')
  const mode = getString(formData, 'mode') || 'logged'

  if (!title) throw new Error('Krátký popis aktivity je povinný.')
  if (title.length > 240) throw new Error('Krátký popis může mít nejvýše 240 znaků.')
  if (description && description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`Poznámka může mít nejvýše ${MAX_DESCRIPTION_LENGTH} znaků.`)
  }

  if (clientIdRaw && !normalizeUuid(clientIdRaw)) {
    throw new Error('Vybraný klient nemá platný identifikátor.')
  }

  if (mode !== 'logged' && mode !== 'planned') {
    throw new Error('Vybraný režim aktivity není platný.')
  }

  const occurredAt = normalizeDateTime(
    getOptionalString(formData, 'occurred_at'),
    'Datum aktivity',
    new Date(),
  )
  const scheduledFor = mode === 'planned'
    ? normalizeDateTime(getOptionalString(formData, 'scheduled_for'), 'Plánovaný termín')
    : null
  const reminderEnabled = mode === 'planned' && getBoolean(formData, 'reminder_enabled')
  const recurrenceEnabled = mode === 'planned' && getBoolean(formData, 'recurrence_enabled')
  const recurrenceUnit = recurrenceEnabled
    ? normalizeRecurrenceUnit(getString(formData, 'recurrence_unit'))
    : null
  const recurrenceIntervalRaw = recurrenceEnabled
    ? Number.parseInt(getString(formData, 'recurrence_interval'), 10)
    : 0
  const recurrenceInterval = recurrenceEnabled ? recurrenceIntervalRaw : null

  if (recurrenceEnabled && !recurrenceUnit) throw new Error('Vyberte způsob opakování aktivity.')
  if (recurrenceEnabled && (!recurrenceInterval || recurrenceInterval < 1 || recurrenceInterval > MAX_RECURRENCE_INTERVAL)) {
    throw new Error(`Interval opakování musí být od 1 do ${MAX_RECURRENCE_INTERVAL}.`)
  }
  if (reminderEnabled && scheduledFor && new Date(scheduledFor).getTime() <= Date.now()) {
    throw new Error('Notifikaci lze zapnout pouze pro budoucí termín.')
  }

  return {
    activityType,
    title,
    description,
    clientId: normalizeUuid(clientIdRaw),
    status: mode,
    occurredAt,
    scheduledFor,
    reminderEnabled,
    recurrenceUnit,
    recurrenceInterval,
  }
}

async function loadOwnedManualActivity(
  activityId: string,
  context: Awaited<ReturnType<typeof getActivityRuntimeContext>>,
) {
  if (!UUID_PATTERN.test(activityId)) throw new Error('Aktivita nebyla nalezena.')

  const { data, error } = await context.supabase
    .from('activities')
    .select('*')
    .eq('id', activityId)
    .is('deleted_at', null)
    .maybeSingle<ActivityRow>()

  if (error || !data) throw new Error('Aktivita nebyla nalezena.')
  if (data.origin !== 'manual' || data.user_id !== context.profile.id) {
    throw new Error('Tuto aktivitu nemůžete upravovat.')
  }

  return data
}

function revalidateActivityPaths(clientIds: Array<string | null | undefined>) {
  revalidatePath('/activities')
  revalidatePath('/dashboard')

  for (const clientId of new Set(clientIds.filter((id): id is string => Boolean(id)))) {
    revalidatePath(`/clients/${clientId}`)
  }
}

export async function createManualActivityAction(
  _previousState: ActivityActionState,
  formData: FormData,
): Promise<ActivityActionState> {
  try {
    const context = await getActivityRuntimeContext()
    const values = parseManualActivityForm(formData)
    await assertAccessibleClient({ supabase: context.supabase, clientId: values.clientId })
    const recurrenceSeriesId = values.recurrenceUnit ? crypto.randomUUID() : null

    const { data, error } = await context.supabase
      .from('activities')
      .insert({
        user_id: context.profile.id,
        created_by: context.profile.id,
        client_id: values.clientId,
        origin: 'manual',
        activity_type: values.activityType,
        title: values.title,
        description: values.description,
        status: values.status,
        occurred_at: values.occurredAt,
        scheduled_for: values.scheduledFor,
        completed_at: null,
        completion_result: null,
        reminder_enabled: values.reminderEnabled,
        reminder_sent_at: null,
        reminder_skipped_at: null,
        recurrence_unit: values.recurrenceUnit,
        recurrence_interval: values.recurrenceInterval,
        recurrence_series_id: recurrenceSeriesId,
        recurrence_parent_id: null,
        recurrence_anchor_at: values.recurrenceUnit ? values.scheduledFor : null,
        recurrence_sequence: 0,
        deleted_at: null,
        deleted_by: null,
      })
      .select('id')
      .single<{ id: string }>()

    if (error || !data) {
      throw new Error(`Aktivitu se nepodařilo uložit: ${error?.message ?? 'Neznámá chyba.'}`)
    }

    await logUserActivity({
      action: `Zapsal aktivitu: ${values.title}`,
      section: 'Aktivity',
      route: '/activities',
      userId: context.profile.id,
    }, context.supabase)

    revalidateActivityPaths([values.clientId])
    return { success: true, error: null, activityId: data.id }
  } catch (error) {
    unstable_rethrow(error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Aktivitu se nepodařilo uložit.',
    }
  }
}

export async function updateManualActivityAction(
  activityId: string,
  _previousState: ActivityActionState,
  formData: FormData,
): Promise<ActivityActionState> {
  try {
    const context = await getActivityRuntimeContext()
    const existing = await loadOwnedManualActivity(activityId, context)
    const values = parseManualActivityForm(formData)
    await assertAccessibleClient({ supabase: context.supabase, clientId: values.clientId })
    const scheduleChanged = existing.scheduled_for !== values.scheduledFor
    const reminderChanged = existing.reminder_enabled !== values.reminderEnabled
    const recurrenceChanged = existing.recurrence_unit !== values.recurrenceUnit
      || existing.recurrence_interval !== values.recurrenceInterval
      || scheduleChanged
    const recurrenceSeriesId = values.recurrenceUnit
      ? recurrenceChanged ? crypto.randomUUID() : existing.recurrence_series_id ?? crypto.randomUUID()
      : existing.recurrence_series_id

    const { error } = await context.supabase
      .from('activities')
      .update({
        client_id: values.clientId,
        activity_type: values.activityType,
        title: values.title,
        description: values.description,
        status: values.status,
        occurred_at: values.occurredAt,
        scheduled_for: values.scheduledFor,
        completed_at: null,
        completion_result: null,
        reminder_enabled: values.reminderEnabled,
        reminder_sent_at: scheduleChanged || reminderChanged ? null : existing.reminder_sent_at,
        reminder_skipped_at: scheduleChanged || reminderChanged ? null : existing.reminder_skipped_at,
        recurrence_unit: values.recurrenceUnit,
        recurrence_interval: values.recurrenceInterval,
        recurrence_series_id: recurrenceSeriesId,
        recurrence_parent_id: values.recurrenceUnit && !recurrenceChanged ? existing.recurrence_parent_id : null,
        recurrence_anchor_at: values.recurrenceUnit
          ? recurrenceChanged ? values.scheduledFor : existing.recurrence_anchor_at ?? values.scheduledFor
          : existing.recurrence_anchor_at,
        recurrence_sequence: values.recurrenceUnit && !recurrenceChanged ? existing.recurrence_sequence : 0,
      })
      .eq('id', existing.id)

    if (error) throw new Error(`Aktivitu se nepodařilo upravit: ${error.message}`)

    revalidateActivityPaths([existing.client_id, values.clientId])
    return { success: true, error: null, activityId: existing.id }
  } catch (error) {
    unstable_rethrow(error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Aktivitu se nepodařilo upravit.',
    }
  }
}

export async function completeManualActivityAction(
  activityId: string,
  input: { result?: string | null } = {},
): Promise<ActivityActionState> {
  try {
    const context = await getActivityRuntimeContext()
    const activity = await loadOwnedManualActivity(activityId, context)

    if (activity.status !== 'planned') {
      throw new Error('Dokončit lze pouze naplánovanou aktivitu.')
    }

    const completionResult = String(input.result ?? '').trim() || null
    if (completionResult && completionResult.length > MAX_COMPLETION_RESULT_LENGTH) {
      throw new Error(`Výsledek může mít nejvýše ${MAX_COMPLETION_RESULT_LENGTH} znaků.`)
    }

    const completedAt = new Date().toISOString()
    const nextOccurrence = getNextRecurringOccurrence(activity, completedAt)
    let nextActivityId: string | undefined

    if (nextOccurrence && activity.recurrence_series_id) {
      const { data: nextActivity, error: nextActivityError } = await context.supabase
        .from('activities')
        .insert({
          user_id: activity.user_id,
          created_by: activity.created_by,
          client_id: activity.client_id,
          origin: 'manual',
          activity_type: activity.activity_type,
          title: activity.title,
          description: activity.description,
          status: 'planned',
          occurred_at: completedAt,
          scheduled_for: nextOccurrence.scheduledFor,
          completed_at: null,
          completion_result: null,
          reminder_enabled: activity.reminder_enabled,
          reminder_sent_at: null,
          reminder_skipped_at: null,
          recurrence_unit: activity.recurrence_unit,
          recurrence_interval: activity.recurrence_interval,
          recurrence_series_id: activity.recurrence_series_id,
          recurrence_parent_id: activity.id,
          recurrence_anchor_at: activity.recurrence_anchor_at,
          recurrence_sequence: nextOccurrence.sequence,
          deleted_at: null,
          deleted_by: null,
        })
        .select('id')
        .single<{ id: string }>()

      if (nextActivityError && nextActivityError.code !== '23505') {
        throw new Error(`Další opakování aktivity se nepodařilo vytvořit: ${nextActivityError.message}`)
      }
      nextActivityId = nextActivity?.id
      if (!nextActivityId && nextActivityError?.code === '23505') {
        const { data: existingChild } = await context.supabase
          .from('activities')
          .select('id')
          .eq('recurrence_parent_id', activity.id)
          .maybeSingle<{ id: string }>()
        nextActivityId = existingChild?.id
      }
    }

    const { error } = await context.supabase
      .from('activities')
      .update({
        status: 'completed',
        completed_at: completedAt,
        completion_result: completionResult,
        occurred_at: completedAt,
        reminder_enabled: false,
        recurrence_unit: null,
        recurrence_interval: null,
      })
      .eq('id', activity.id)

    if (error) throw new Error(`Aktivitu se nepodařilo dokončit: ${error.message}`)

    revalidateActivityPaths([activity.client_id])
    return { success: true, error: null, activityId: activity.id, nextActivityId }
  } catch (error) {
    unstable_rethrow(error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Aktivitu se nepodařilo dokončit.',
    }
  }
}

export async function deleteManualActivityAction(
  activityId: string,
): Promise<ActivityActionState> {
  try {
    const context = await getActivityRuntimeContext()
    const activity = await loadOwnedManualActivity(activityId, context)
    const deletedAt = new Date().toISOString()

    const { error } = await context.supabase
      .from('activities')
      .update({
        deleted_at: deletedAt,
        deleted_by: context.profile.id,
        reminder_enabled: false,
        recurrence_unit: null,
        recurrence_interval: null,
      })
      .eq('id', activity.id)

    if (error) throw new Error(`Aktivitu se nepodařilo odstranit: ${error.message}`)

    revalidateActivityPaths([activity.client_id])
    return { success: true, error: null, activityId: activity.id }
  } catch (error) {
    unstable_rethrow(error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Aktivitu se nepodařilo odstranit.',
    }
  }
}
