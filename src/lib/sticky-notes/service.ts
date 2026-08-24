import 'server-only'

import { getActivityRuntimeContext } from '@/lib/activities/access'
import {
  STICKY_NOTE_VIEWS,
  type StickyNoteConversionRow,
  type StickyNoteCounts,
  type StickyNoteListItem,
  type StickyNoteListResult,
  type StickyNoteRow,
  type StickyNoteView,
} from '@/lib/sticky-notes/types'

const DEFAULT_LIMIT = 6
const MAX_LIMIT = 100

function normalizeView(value: string | null | undefined): StickyNoteView {
  return STICKY_NOTE_VIEWS.includes(value as StickyNoteView)
    ? (value as StickyNoteView)
    : 'active'
}

function normalizeLimit(value: number | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(value ?? DEFAULT_LIMIT)))
}

async function hydrateStickyNotes(
  supabase: Awaited<ReturnType<typeof getActivityRuntimeContext>>['supabase'],
  rows: StickyNoteRow[],
): Promise<StickyNoteListItem[]> {
  if (rows.length === 0) return []

  const noteIds = rows.map((row) => row.id)
  const clientIds = [...new Set(rows.map((row) => row.client_id).filter(Boolean))] as string[]

  const [clientsResponse, conversionsResponse] = await Promise.all([
    clientIds.length
      ? supabase.from('clients').select('id, name').in('id', clientIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('sticky_note_conversions')
      .select('*')
      .in('sticky_note_id', noteIds)
      .order('created_at', { ascending: false }),
  ])

  if (clientsResponse.error) {
    throw new Error(`Klienty Lístečků se nepodařilo načíst: ${clientsResponse.error.message}`)
  }
  if (conversionsResponse.error) {
    throw new Error(`Převody Lístečků se nepodařilo načíst: ${conversionsResponse.error.message}`)
  }

  const clientNames = new Map(
    ((clientsResponse.data ?? []) as Array<{ id: string; name: string | null }>).map((row) => [
      row.id,
      row.name,
    ]),
  )
  const conversionsByNote = new Map<string, StickyNoteConversionRow[]>()

  for (const conversion of (conversionsResponse.data ?? []) as StickyNoteConversionRow[]) {
    const current = conversionsByNote.get(conversion.sticky_note_id) ?? []
    current.push(conversion)
    conversionsByNote.set(conversion.sticky_note_id, current)
  }

  return rows.map((row) => ({
    ...row,
    client_name: row.client_id ? clientNames.get(row.client_id) ?? null : null,
    conversions: conversionsByNote.get(row.id) ?? [],
  }))
}

export async function getStickyNotes(input: {
  view?: StickyNoteView | null
  limit?: number
  offset?: number
} = {}): Promise<StickyNoteListResult> {
  const { supabase, profile } = await getActivityRuntimeContext()
  const view = normalizeView(input.view)
  const limit = normalizeLimit(input.limit)
  const offset = Number.isFinite(input.offset)
    ? Math.max(0, Math.floor(input.offset ?? 0))
    : 0

  let request = supabase
    .from('sticky_notes')
    .select('*', { count: 'exact' })
    .eq('user_id', profile.id)

  if (view === 'active') {
    request = request
      .is('archived_at', null)
      .is('deleted_at', null)
      .order('is_pinned', { ascending: false })
      .order('reminder_at', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false })
  } else if (view === 'archive') {
    request = request
      .not('archived_at', 'is', null)
      .is('deleted_at', null)
      .order('archived_at', { ascending: false })
  } else {
    request = request
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false })
  }

  const { data, error, count } = await request.range(offset, offset + limit - 1)
  if (error) throw new Error(`Lístečky se nepodařilo načíst: ${error.message}`)

  const items = await hydrateStickyNotes(supabase, (data ?? []) as StickyNoteRow[])
  return { items, total: count ?? 0, view }
}

export async function getStickyNoteCounts(): Promise<StickyNoteCounts> {
  const { supabase, profile } = await getActivityRuntimeContext()
  const base = () => supabase
    .from('sticky_notes')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', profile.id)

  const [active, archive, trash, pinned, reminders] = await Promise.all([
    base().is('archived_at', null).is('deleted_at', null),
    base().not('archived_at', 'is', null).is('deleted_at', null),
    base().not('deleted_at', 'is', null),
    base().eq('is_pinned', true).is('archived_at', null).is('deleted_at', null),
    base()
      .eq('reminder_enabled', true)
      .is('reminder_sent_at', null)
      .is('reminder_skipped_at', null)
      .is('archived_at', null)
      .is('deleted_at', null),
  ])

  const failed = [active, archive, trash, pinned, reminders].find((response) => response.error)
  if (failed?.error) {
    throw new Error(`Počty Lístečků se nepodařilo načíst: ${failed.error.message}`)
  }

  return {
    active: active.count ?? 0,
    archive: archive.count ?? 0,
    trash: trash.count ?? 0,
    pinned: pinned.count ?? 0,
    reminders: reminders.count ?? 0,
  }
}
