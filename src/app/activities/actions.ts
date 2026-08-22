'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { getActivityRuntimeContext } from '@/lib/activities/access'
import { normalizeActivityDateTime } from '@/lib/activities/date'
import {
  MANUAL_ACTIVITY_TYPES,
  type ActivityActionState,
  type ActivityRow,
  type ManualActivityType,
} from '@/lib/activities/types'
import { logUserActivity } from '@/lib/activity-log/logUserActivity'
import { getActivityAdminReport } from '@/lib/activities/service'
import type { ActivityReportActionResult, ActivityReportInput } from '@/lib/activities/types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_DESCRIPTION_LENGTH = 5000

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

function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function getOptionalString(formData: FormData, key: string) {
  const value = getString(formData, key)
  return value || null
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

  return {
    activityType,
    title,
    description,
    clientId: normalizeUuid(clientIdRaw),
    status: mode,
    occurredAt,
    scheduledFor,
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
): Promise<ActivityActionState> {
  try {
    const context = await getActivityRuntimeContext()
    const activity = await loadOwnedManualActivity(activityId, context)

    if (activity.status !== 'planned') {
      throw new Error('Dokončit lze pouze naplánovanou aktivitu.')
    }

    const completedAt = new Date().toISOString()
    const { error } = await context.supabase
      .from('activities')
      .update({
        status: 'completed',
        completed_at: completedAt,
        occurred_at: completedAt,
      })
      .eq('id', activity.id)

    if (error) throw new Error(`Aktivitu se nepodařilo dokončit: ${error.message}`)

    revalidateActivityPaths([activity.client_id])
    return { success: true, error: null, activityId: activity.id }
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

    const { error } = await context.supabase
      .from('activities')
      .delete()
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
