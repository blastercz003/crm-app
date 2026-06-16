import { getServiceRoleClient } from '@/lib/supabase/service'

export const MEETING_CALENDAR_NAME = 'B-ENERGY SCHUZKY'
export const MEETING_CALENDAR_TIME_ZONE = 'Europe/Prague'
export const MEETING_CALENDAR_DEFAULT_DURATION_MINUTES = 30
const MEETING_CALENDAR_ALARM_MINUTES = 120
const MEETING_CALENDAR_UID_PREFIX = 'b-energy-schuzky'

type MeetingCalendarFeedRow = {
  user_id: string
  token: string
  enabled: boolean
  disabled_at: string | null
}

type MeetingCalendarItemRow = {
  meeting_id: string
  user_id: string
  uid: string
  sequence: number
  is_cancelled: boolean
  cancelled_at: string | null
}

type MeetingCalendarMeetingRow = {
  id: string
  company_name: string | null
  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null
  address: string | null
  title: string | null
  meeting_datetime: string | null
  pre_meeting_note: string | null
  result_note: string | null
  follow_up_task: string | null
  follow_up_task_note: string | null
  follow_up_task_priority: string | null
  follow_up_task_due_date: string | null
  status: 'planned' | 'completed'
  assigned_user_id: string | null
}

type CalendarFeedEvent = {
  uid: string
  sequence: number
  summary: string
  description: string
  location: string | null
  startIso: string
  endIso: string
  isCancelled: boolean
}

function getServiceClient() {
  const client = getServiceRoleClient()

  if (!client) {
    throw new Error('Chybí Supabase service role client pro kalendář schůzek.')
  }

  return client
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function escapeIcsText(value: string) {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
}

function foldIcsLine(line: string) {
  const maxLength = 73

  if (line.length <= maxLength) {
    return line
  }

  const chunks: string[] = []
  let index = 0

  while (index < line.length) {
    const chunk = line.slice(index, index + maxLength)
    chunks.push(index === 0 ? chunk : ` ${chunk}`)
    index += maxLength
  }

  return chunks.join('\r\n')
}

function serializeIcs(lines: string[]) {
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`
}

function formatUtcIsoForIcs(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new Error('Schůzka má neplatné datum pro kalendář.')
  }

  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
  ].join('') + `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(
    date.getUTCSeconds()
  )}Z`
}

function addMinutesToIso(value: string, minutes: number) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new Error('Schůzka má neplatné datum pro kalendář.')
  }

  return new Date(date.getTime() + minutes * 60_000).toISOString()
}

function buildSummary(meeting: MeetingCalendarMeetingRow) {
  const companyName = meeting.company_name?.trim()
  const contactPerson = meeting.contact_person?.trim()
  const title = meeting.title?.trim()

  if (companyName && contactPerson) {
    return `${companyName} · ${contactPerson}`
  }

  if (companyName) {
    return companyName
  }

  if (contactPerson) {
    return contactPerson
  }

  return title || 'Schůzka'
}

function buildDescription(meeting: MeetingCalendarMeetingRow) {
  const lines = [
    meeting.title?.trim() ? `Název schůzky: ${meeting.title.trim()}` : null,
    meeting.company_name?.trim()
      ? `Firma: ${meeting.company_name.trim()}`
      : null,
    meeting.contact_person?.trim()
      ? `Kontaktní osoba: ${meeting.contact_person.trim()}`
      : null,
    meeting.contact_phone?.trim()
      ? `Telefon: ${meeting.contact_phone.trim()}`
      : null,
    meeting.contact_email?.trim()
      ? `E-mail: ${meeting.contact_email.trim()}`
      : null,
    meeting.address?.trim() ? `Adresa: ${meeting.address.trim()}` : null,
    `Stav: ${meeting.status === 'completed' ? 'Proběhlá' : 'Plánovaná'}`,
    meeting.pre_meeting_note?.trim()
      ? `Poznámka před schůzkou: ${meeting.pre_meeting_note.trim()}`
      : null,
    meeting.result_note?.trim()
      ? `Výsledek schůzky: ${meeting.result_note.trim()}`
      : null,
    meeting.follow_up_task?.trim()
      ? `Navazující úkol: ${meeting.follow_up_task.trim()}`
      : null,
    meeting.follow_up_task_note?.trim()
      ? `Poznámka k úkolu: ${meeting.follow_up_task_note.trim()}`
      : null,
    meeting.follow_up_task_due_date
      ? `Termín úkolu: ${meeting.follow_up_task_due_date}`
      : null,
    meeting.follow_up_task_priority?.trim()
      ? `Priorita úkolu: ${meeting.follow_up_task_priority.trim()}`
      : null,
  ].filter((line): line is string => Boolean(line))

  return lines.join('\n')
}

function buildEventUid(userId: string, meetingId: string) {
  return `${MEETING_CALENDAR_UID_PREFIX}:${userId}:${meetingId}`
}

function buildCalendarEvent(meeting: MeetingCalendarMeetingRow, item?: MeetingCalendarItemRow): CalendarFeedEvent | null {
  if (!meeting.meeting_datetime) {
    return null
  }

  const startIso = meeting.meeting_datetime
  const endIso = addMinutesToIso(startIso, MEETING_CALENDAR_DEFAULT_DURATION_MINUTES)

  return {
    uid: item?.uid ?? buildEventUid(meeting.assigned_user_id ?? 'unknown', meeting.id),
    sequence: item?.sequence ?? 1,
    summary: buildSummary(meeting),
    description: buildDescription(meeting),
    location: meeting.address?.trim() || null,
    startIso,
    endIso,
    isCancelled: item?.is_cancelled ?? false,
  }
}

function buildCancelledEvent(item: MeetingCalendarItemRow) {
  return {
    uid: item.uid,
    sequence: item.sequence,
    summary: 'Schůzka byla zrušena',
    description: 'Tato schůzka byla zrušena v aplikaci B-ENERGY.',
    location: null,
    startIso: new Date().toISOString(),
    endIso: new Date().toISOString(),
    isCancelled: true,
  } satisfies CalendarFeedEvent
}

function serializeEvent(event: CalendarFeedEvent) {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(event.uid)}`,
    `SEQUENCE:${event.sequence}`,
    `DTSTAMP:${formatUtcIsoForIcs(new Date().toISOString())}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
    `DESCRIPTION:${escapeIcsText(event.description)}`,
    `DTSTART:${formatUtcIsoForIcs(event.startIso)}`,
    `DTEND:${formatUtcIsoForIcs(event.endIso)}`,
    'CLASS:PRIVATE',
    'TRANSP:OPAQUE',
    `X-MICROSOFT-CDO-ALLDAYEVENT:FALSE`,
  ]

  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`)
  }

  if (event.isCancelled) {
    lines.push('STATUS:CANCELLED')
  } else {
    lines.push(
      'BEGIN:VALARM',
      `TRIGGER:-PT${MEETING_CALENDAR_ALARM_MINUTES}M`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText('B-ENERGY připomínka schůzky')}`,
      'END:VALARM'
    )
  }

  lines.push('END:VEVENT')

  return lines
}

async function getFeedClientData(token: string) {
  const supabase = getServiceClient()

  const { data: feed, error: feedError } = await supabase
    .from('meeting_calendar_feeds')
    .select('user_id, token, enabled, disabled_at')
    .eq('token', token)
    .maybeSingle<MeetingCalendarFeedRow>()

  if (feedError) {
    throw new Error(`Nepodařilo se načíst kalendářový feed: ${feedError.message}`)
  }

  if (!feed || !feed.enabled || feed.disabled_at) {
    return null
  }

  return { supabase, feed }
}

export async function ensureMeetingCalendarFeed(userId: string) {
  const supabase = getServiceClient()

  const { data: existingFeed, error: existingError } = await supabase
    .from('meeting_calendar_feeds')
    .select('user_id, token, enabled, disabled_at')
    .eq('user_id', userId)
    .maybeSingle<MeetingCalendarFeedRow>()

  if (existingError) {
    throw new Error(
      `Nepodařilo se načíst kalendářový feed: ${existingError.message}`
    )
  }

  if (existingFeed) {
    return existingFeed
  }

  const token = globalThis.crypto.randomUUID().replaceAll('-', '')

  const { error: insertError } = await supabase.from('meeting_calendar_feeds').insert({
    user_id: userId,
    token,
    enabled: true,
    disabled_at: null,
  })

  if (insertError) {
    throw new Error(
      `Nepodařilo se připravit kalendářový feed: ${insertError.message}`
    )
  }

  const { data, error: readError } = await supabase
    .from('meeting_calendar_feeds')
    .select('user_id, token, enabled, disabled_at')
    .eq('user_id', userId)
    .maybeSingle<MeetingCalendarFeedRow>()

  if (readError || !data) {
    throw new Error(
      `Nepodařilo se načíst kalendářový feed: ${readError?.message ?? 'Neznámá chyba'}`
    )
  }

  return data
}

export async function syncMeetingCalendarItem(params: {
  meetingId: string
  userId: string
  meeting: MeetingCalendarMeetingRow
}) {
  const supabase = getServiceClient()
  const { meetingId, userId, meeting } = params

  await ensureMeetingCalendarFeed(userId)

  const { data: existingItem, error: itemError } = await supabase
    .from('meeting_calendar_items')
    .select('meeting_id, user_id, uid, sequence, is_cancelled, cancelled_at')
    .eq('meeting_id', meetingId)
    .maybeSingle<MeetingCalendarItemRow>()

  if (itemError) {
    throw new Error(
      `Nepodařilo se načíst kalendářovou položku: ${itemError.message}`
    )
  }

  const nextSequence = (existingItem?.sequence ?? 0) + 1
  const nextUid =
    existingItem?.uid ?? buildEventUid(userId, meetingId)

  const { error } = await supabase
    .from('meeting_calendar_items')
    .upsert({
      meeting_id: meetingId,
      user_id: userId,
      uid: nextUid,
      sequence: nextSequence,
      is_cancelled: false,
      cancelled_at: null,
      updated_at: new Date().toISOString(),
    })

  if (error) {
    throw new Error(
      `Nepodařilo se synchronizovat schůzku do kalendáře: ${error.message}`
    )
  }

  return buildCalendarEvent(
    meeting,
    {
      meeting_id: meetingId,
      user_id: userId,
      uid: nextUid,
      sequence: nextSequence,
      is_cancelled: false,
      cancelled_at: null,
    }
  )
}

export async function cancelMeetingCalendarItem(params: {
  meetingId: string
  userId: string
}) {
  const supabase = getServiceClient()
  const { meetingId, userId } = params

  await ensureMeetingCalendarFeed(userId)

  const { data: existingItem, error: itemError } = await supabase
    .from('meeting_calendar_items')
    .select('meeting_id, user_id, uid, sequence, is_cancelled, cancelled_at')
    .eq('meeting_id', meetingId)
    .maybeSingle<MeetingCalendarItemRow>()

  if (itemError) {
    throw new Error(
      `Nepodařilo se načíst kalendářovou položku: ${itemError.message}`
    )
  }

  const nextSequence = (existingItem?.sequence ?? 0) + 1
  const nextUid =
    existingItem?.uid ?? buildEventUid(userId, meetingId)

  const { error } = await supabase
    .from('meeting_calendar_items')
    .upsert({
      meeting_id: meetingId,
      user_id: userId,
      uid: nextUid,
      sequence: nextSequence,
      is_cancelled: true,
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })

  if (error) {
    throw new Error(
      `Nepodařilo se zrušit schůzku v kalendáři: ${error.message}`
    )
  }
}

export async function getMeetingCalendarFeedByToken(token: string) {
  const feedResult = await getFeedClientData(token)

  if (!feedResult) {
    return null
  }

  const { supabase, feed } = feedResult

  const [meetingsResponse, itemsResponse] = await Promise.all([
    supabase
      .from('meetings')
      .select(`
        id,
        company_name,
        contact_person,
        contact_phone,
        contact_email,
        address,
        title,
        meeting_datetime,
        pre_meeting_note,
        result_note,
        follow_up_task,
        follow_up_task_note,
        follow_up_task_priority,
        follow_up_task_due_date,
        status,
        assigned_user_id
      `)
      .eq('assigned_user_id', feed.user_id)
      .order('meeting_datetime', { ascending: true }),
    supabase
      .from('meeting_calendar_items')
      .select('meeting_id, user_id, uid, sequence, is_cancelled, cancelled_at')
      .eq('user_id', feed.user_id),
  ])

  const { data: meetings, error: meetingsError } = meetingsResponse
  const { data: items, error: itemsError } = itemsResponse

  if (meetingsError) {
    throw new Error(
      `Nepodařilo se načíst schůzky pro kalendář: ${meetingsError.message}`
    )
  }

  if (itemsError) {
    throw new Error(
      `Nepodařilo se načíst kalendářové položky: ${itemsError.message}`
    )
  }

  const itemByMeetingId = new Map(
    (items ?? []).map((item) => [item.meeting_id, item as MeetingCalendarItemRow])
  )

  const activeEvents = (meetings ?? [])
    .map((meeting) => {
      const item = itemByMeetingId.get(meeting.id)

      if (item?.is_cancelled) {
        return null
      }

      return buildCalendarEvent(
        meeting as MeetingCalendarMeetingRow,
        item
      )
    })
    .filter((event): event is CalendarFeedEvent => Boolean(event))

  const cancelledEvents = (items ?? [])
    .filter((item) => item.is_cancelled)
    .map((item) => buildCancelledEvent(item as MeetingCalendarItemRow))

  const events = [...activeEvents, ...cancelledEvents].sort((a, b) => {
    return new Date(a.startIso).getTime() - new Date(b.startIso).getTime()
  })

  const ics = serializeIcs([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//B-ENERGY//Meeting Calendar Feed//CS',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(MEETING_CALENDAR_NAME)}`,
    `X-WR-TIMEZONE:${MEETING_CALENDAR_TIME_ZONE}`,
    'X-PUBLISHED-TTL:PT15M',
    ...events.flatMap((event) => serializeEvent(event)),
    'END:VCALENDAR',
  ])

  return {
    ics,
    feed,
  }
}

export async function backfillMeetingCalendarItemsForUser(userId: string) {
  const supabase = getServiceClient()

  await ensureMeetingCalendarFeed(userId)

  const [meetingsResponse, itemsResponse] = await Promise.all([
    supabase
      .from('meetings')
      .select(`
        id,
        company_name,
        contact_person,
        contact_phone,
        contact_email,
        address,
        title,
        meeting_datetime,
        pre_meeting_note,
        result_note,
        follow_up_task,
        follow_up_task_note,
        follow_up_task_priority,
        follow_up_task_due_date,
        status,
        assigned_user_id
      `)
      .eq('assigned_user_id', userId)
      .not('meeting_datetime', 'is', null)
      .order('meeting_datetime', { ascending: true }),
    supabase
      .from('meeting_calendar_items')
      .select('meeting_id')
      .eq('user_id', userId),
  ])

  const { data: meetings, error: meetingsError } = meetingsResponse
  const { data: existingItems, error: itemsError } = itemsResponse

  if (meetingsError) {
    throw new Error(
      `Nepodařilo se načíst schůzky pro backfill kalendáře: ${meetingsError.message}`
    )
  }

  if (itemsError) {
    throw new Error(
      `Nepodařilo se načíst položky kalendáře pro backfill: ${itemsError.message}`
    )
  }

  const existingMeetingIds = new Set(
    (existingItems ?? []).map((item) => item.meeting_id)
  )

  const missingMeetings = (meetings ?? []).filter(
    (meeting) => !existingMeetingIds.has(meeting.id)
  )

  if (missingMeetings.length === 0) {
    return { insertedCount: 0 }
  }

  const rowsToInsert = missingMeetings.map((meeting) => ({
    meeting_id: meeting.id,
    user_id: userId,
    uid: buildEventUid(userId, meeting.id),
    sequence: 1,
    is_cancelled: false,
    cancelled_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }))

  const { error } = await supabase
    .from('meeting_calendar_items')
    .insert(rowsToInsert)

  if (error) {
    throw new Error(
      `Nepodařilo se provést backfill kalendáře: ${error.message}`
    )
  }

  return { insertedCount: rowsToInsert.length }
}
