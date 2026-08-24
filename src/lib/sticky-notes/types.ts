export const STICKY_NOTE_COLORS = [
  'yellow',
  'blue',
  'green',
  'pink',
  'purple',
  'gray',
] as const

export const STICKY_NOTE_CONVERSION_TYPES = ['task', 'activity'] as const
export const STICKY_NOTE_VIEWS = ['active', 'archive', 'trash'] as const

export type StickyNoteColor = (typeof STICKY_NOTE_COLORS)[number]
export type StickyNoteConversionType = (typeof STICKY_NOTE_CONVERSION_TYPES)[number]
export type StickyNoteView = (typeof STICKY_NOTE_VIEWS)[number]

export type StickyNoteRow = {
  id: string
  user_id: string
  client_id: string | null
  title: string | null
  content: string
  color: StickyNoteColor
  is_pinned: boolean
  reminder_enabled: boolean
  reminder_at: string | null
  reminder_sent_at: string | null
  reminder_skipped_at: string | null
  archived_at: string | null
  deleted_at: string | null
  created_at: string
  updated_at: string
}

export type StickyNoteConversionRow = {
  id: string
  sticky_note_id: string
  user_id: string
  target_type: StickyNoteConversionType
  target_id: string
  target_title: string
  target_path: string
  created_at: string
}

export type StickyNoteListItem = StickyNoteRow & {
  client_name: string | null
  conversions: StickyNoteConversionRow[]
}

export type StickyNoteListResult = {
  items: StickyNoteListItem[]
  total: number
  view: StickyNoteView
}

export type StickyNoteCounts = {
  active: number
  archive: number
  trash: number
  pinned: number
  reminders: number
}

export type StickyNoteActionState = {
  success: boolean
  error: string | null
  noteId?: string
  updatedAt?: string
}

export type StickyNoteListActionResult = {
  success: boolean
  error: string | null
  items: StickyNoteListItem[]
  total: number
  view: StickyNoteView
}

export type StickyNoteConversionActionResult = {
  success: boolean
  error: string | null
  conversionId?: string
}
