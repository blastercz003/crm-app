'use server'

import { revalidatePath } from 'next/cache'
import { unstable_rethrow } from 'next/navigation'
import { getActivityRuntimeContext } from '@/lib/activities/access'
import { normalizeActivityDateTime } from '@/lib/activities/date'
import {
  STICKY_NOTE_COLORS,
  STICKY_NOTE_CONVERSION_TYPES,
  type StickyNoteActionState,
  type StickyNoteColor,
  type StickyNoteConversionActionResult,
  type StickyNoteConversionType,
  type StickyNoteRow,
  type StickyNoteListActionResult,
  type StickyNoteView,
} from '@/lib/sticky-notes/types'
import { getStickyNotes } from '@/lib/sticky-notes/service'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TITLE_MAX_LENGTH = 120
const CONTENT_MAX_LENGTH = 1000

export async function getStickyNotesViewAction(input: {
  view: StickyNoteView
  limit?: number
  offset?: number
}): Promise<StickyNoteListActionResult> {
  try {
    const result = await getStickyNotes({
      view: input.view,
      limit: input.limit ?? 100,
      offset: input.offset ?? 0,
    })
    return { success: true, error: null, ...result }
  } catch (error) {
    unstable_rethrow(error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Lístečky se nepodařilo načíst.',
      items: [],
      total: 0,
      view: input.view,
    }
  }
}

function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value : ''
}

function getTrimmedString(formData: FormData, key: string) {
  return getString(formData, key).trim()
}

function getBoolean(formData: FormData, key: string) {
  const value = getTrimmedString(formData, key).toLowerCase()
  return value === '1' || value === 'true' || value === 'on'
}

function normalizeUuid(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()
  return UUID_PATTERN.test(normalized) ? normalized : null
}

function normalizeColor(value: string): StickyNoteColor {
  return STICKY_NOTE_COLORS.includes(value as StickyNoteColor)
    ? (value as StickyNoteColor)
    : 'yellow'
}

function parseStickyNoteForm(formData: FormData) {
  const title = getTrimmedString(formData, 'title') || null
  const content = getString(formData, 'content')
  const clientIdRaw = getTrimmedString(formData, 'client_id') || null
  const reminderEnabled = getBoolean(formData, 'reminder_enabled')
  const reminderRaw = getTrimmedString(formData, 'reminder_at') || null

  if (!title && !content.trim()) {
    throw new Error('Vyplňte nadpis nebo obsah Lístečku.')
  }
  if (title && title.length > TITLE_MAX_LENGTH) {
    throw new Error(`Nadpis může mít nejvýše ${TITLE_MAX_LENGTH} znaků.`)
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new Error(`Obsah může mít nejvýše ${CONTENT_MAX_LENGTH} znaků.`)
  }
  if (clientIdRaw && !normalizeUuid(clientIdRaw)) {
    throw new Error('Vybraný klient nemá platný identifikátor.')
  }

  const reminderAt = reminderEnabled
    ? normalizeActivityDateTime(reminderRaw ?? '')
    : null
  if (reminderEnabled && !reminderAt) {
    throw new Error('Vyberte platný čas připomínky.')
  }

  return {
    title,
    content,
    clientId: normalizeUuid(clientIdRaw),
    color: normalizeColor(getTrimmedString(formData, 'color')),
    isPinned: getBoolean(formData, 'is_pinned'),
    reminderEnabled,
    reminderAt,
  }
}

async function assertAccessibleClient(
  supabase: Awaited<ReturnType<typeof getActivityRuntimeContext>>['supabase'],
  clientId: string | null,
) {
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

async function loadOwnedStickyNote(
  noteId: string,
  context: Awaited<ReturnType<typeof getActivityRuntimeContext>>,
) {
  const normalizedId = normalizeUuid(noteId)
  if (!normalizedId) throw new Error('Lísteček nebyl nalezen.')

  const { data, error } = await context.supabase
    .from('sticky_notes')
    .select('*')
    .eq('id', normalizedId)
    .eq('user_id', context.profile.id)
    .maybeSingle<StickyNoteRow>()

  if (error || !data) throw new Error('Lísteček nebyl nalezen.')
  return data
}

function revalidateStickyNotePaths() {
  revalidatePath('/activities')
  revalidatePath('/dashboard')
}

export async function createStickyNoteAction(
  _previousState: StickyNoteActionState,
  formData: FormData,
): Promise<StickyNoteActionState> {
  try {
    const context = await getActivityRuntimeContext()
    const values = parseStickyNoteForm(formData)
    await assertAccessibleClient(context.supabase, values.clientId)

    const { data, error } = await context.supabase
      .from('sticky_notes')
      .insert({
        user_id: context.profile.id,
        client_id: values.clientId,
        title: values.title,
        content: values.content,
        color: values.color,
        is_pinned: values.isPinned,
        reminder_enabled: values.reminderEnabled,
        reminder_at: values.reminderAt,
        reminder_sent_at: null,
        reminder_skipped_at: null,
      })
      .select('id, updated_at')
      .single<{ id: string; updated_at: string }>()

    if (error || !data) {
      throw new Error(`Lísteček se nepodařilo uložit: ${error?.message ?? 'Neznámá chyba.'}`)
    }

    revalidateStickyNotePaths()
    return { success: true, error: null, noteId: data.id, updatedAt: data.updated_at }
  } catch (error) {
    unstable_rethrow(error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Lísteček se nepodařilo uložit.',
    }
  }
}

export async function updateStickyNoteAction(
  noteId: string,
  _previousState: StickyNoteActionState,
  formData: FormData,
): Promise<StickyNoteActionState> {
  try {
    const context = await getActivityRuntimeContext()
    const note = await loadOwnedStickyNote(noteId, context)
    if (note.deleted_at) throw new Error('Lísteček v koši nelze upravovat.')

    const values = parseStickyNoteForm(formData)
    await assertAccessibleClient(context.supabase, values.clientId)
    const reminderChanged =
      note.reminder_enabled !== values.reminderEnabled
      || note.reminder_at !== values.reminderAt

    const { data, error } = await context.supabase
      .from('sticky_notes')
      .update({
        client_id: values.clientId,
        title: values.title,
        content: values.content,
        color: values.color,
        is_pinned: values.isPinned,
        reminder_enabled: values.reminderEnabled,
        reminder_at: values.reminderAt,
        reminder_sent_at: reminderChanged ? null : note.reminder_sent_at,
        reminder_skipped_at: reminderChanged ? null : note.reminder_skipped_at,
      })
      .eq('id', note.id)
      .select('updated_at')
      .single<{ updated_at: string }>()

    if (error || !data) {
      throw new Error(`Lísteček se nepodařilo upravit: ${error?.message ?? 'Neznámá chyba.'}`)
    }

    revalidateStickyNotePaths()
    return { success: true, error: null, noteId: note.id, updatedAt: data.updated_at }
  } catch (error) {
    unstable_rethrow(error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Lísteček se nepodařilo upravit.',
    }
  }
}

async function updateOwnedStickyNoteState(
  noteId: string,
  patch: Record<string, unknown>,
): Promise<StickyNoteActionState> {
  try {
    const context = await getActivityRuntimeContext()
    const note = await loadOwnedStickyNote(noteId, context)
    const { data, error } = await context.supabase
      .from('sticky_notes')
      .update(patch)
      .eq('id', note.id)
      .select('updated_at')
      .single<{ updated_at: string }>()

    if (error || !data) throw new Error(`Lísteček se nepodařilo upravit: ${error?.message ?? 'Neznámá chyba.'}`)
    revalidateStickyNotePaths()
    return { success: true, error: null, noteId: note.id, updatedAt: data.updated_at }
  } catch (error) {
    unstable_rethrow(error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Lísteček se nepodařilo upravit.',
    }
  }
}

export async function setStickyNotePinnedAction(noteId: string, isPinned: boolean) {
  return updateOwnedStickyNoteState(noteId, { is_pinned: Boolean(isPinned) })
}

export async function archiveStickyNoteAction(noteId: string) {
  return updateOwnedStickyNoteState(noteId, {
    archived_at: new Date().toISOString(),
    reminder_enabled: false,
  })
}

export async function restoreStickyNoteFromArchiveAction(noteId: string) {
  return updateOwnedStickyNoteState(noteId, { archived_at: null })
}

export async function moveStickyNoteToTrashAction(noteId: string) {
  return updateOwnedStickyNoteState(noteId, {
    deleted_at: new Date().toISOString(),
    reminder_enabled: false,
  })
}

export async function restoreStickyNoteFromTrashAction(noteId: string) {
  return updateOwnedStickyNoteState(noteId, { deleted_at: null })
}

export async function permanentlyDeleteStickyNoteAction(
  noteId: string,
): Promise<StickyNoteActionState> {
  try {
    const context = await getActivityRuntimeContext()
    const note = await loadOwnedStickyNote(noteId, context)
    if (!note.deleted_at) {
      throw new Error('Definitivně odstranit lze pouze Lísteček v koši.')
    }

    const { error } = await context.supabase
      .from('sticky_notes')
      .delete()
      .eq('id', note.id)

    if (error) throw new Error(`Lísteček se nepodařilo odstranit: ${error.message}`)
    revalidateStickyNotePaths()
    return { success: true, error: null, noteId: note.id }
  } catch (error) {
    unstable_rethrow(error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Lísteček se nepodařilo odstranit.',
    }
  }
}

export async function recordStickyNoteConversionAction(input: {
  noteId: string
  targetType: StickyNoteConversionType
  targetId: string
  targetTitle: string
  targetPath: string
}): Promise<StickyNoteConversionActionResult> {
  try {
    const context = await getActivityRuntimeContext()
    const note = await loadOwnedStickyNote(input.noteId, context)
    if (note.deleted_at) throw new Error('Lísteček v koši nelze převést.')
    if (!STICKY_NOTE_CONVERSION_TYPES.includes(input.targetType)) {
      throw new Error('Typ převodu není platný.')
    }

    const targetId = normalizeUuid(input.targetId)
    const targetTitle = String(input.targetTitle ?? '').trim()
    const targetPath = String(input.targetPath ?? '').trim()
    if (!targetId || !targetTitle || targetTitle.length > 240 || !targetPath.startsWith('/')) {
      throw new Error('Cílový záznam převodu není platný.')
    }

    const targetResponse = input.targetType === 'task'
      ? await context.supabase
          .from('tasks')
          .select('id')
          .eq('id', targetId)
          .maybeSingle<{ id: string }>()
      : await context.supabase
          .from('activities')
          .select('id')
          .eq('id', targetId)
          .eq('origin', 'manual')
          .eq('user_id', context.profile.id)
          .is('deleted_at', null)
          .maybeSingle<{ id: string }>()

    if (targetResponse.error || !targetResponse.data) {
      throw new Error('Vytvořený cílový záznam nebyl nalezen nebo k němu nemáte přístup.')
    }

    const { data, error } = await context.supabase
      .from('sticky_note_conversions')
      .insert({
        sticky_note_id: note.id,
        user_id: context.profile.id,
        target_type: input.targetType,
        target_id: targetId,
        target_title: targetTitle,
        target_path: targetPath,
      })
      .select('id')
      .single<{ id: string }>()

    if (error || !data) {
      throw new Error(`Převod Lístečku se nepodařilo uložit: ${error?.message ?? 'Neznámá chyba.'}`)
    }

    revalidateStickyNotePaths()
    return { success: true, error: null, conversionId: data.id }
  } catch (error) {
    unstable_rethrow(error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Převod Lístečku se nepodařilo uložit.',
    }
  }
}
