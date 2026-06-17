import { getServiceRoleClient } from '@/lib/supabase/service'

export const MEETING_CALENDAR_NAME = 'B-ENERGY SCHUZKY'
export const MEETING_CALENDAR_TIME_ZONE = 'Europe/Prague'
export const MEETING_CALENDAR_DEFAULT_DURATION_MINUTES = 30
const MEETING_CALENDAR_ALARM_MINUTES = 120
const MEETING_CALENDAR_UID_PREFIX = 'b-energy-schuzky'
export const MEETING_GOOGLE_CALENDAR_NAME = MEETING_CALENDAR_NAME
const GOOGLE_OAUTH_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'
const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'

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

type MeetingGoogleCalendarIntegrationRow = {
  user_id: string
  google_sub: string | null
  google_email: string | null
  refresh_token: string | null
  calendar_id: string | null
  calendar_name: string
  enabled: boolean
  disabled_at: string | null
  connected_at: string | null
  created_at: string
  updated_at: string
}

type MeetingGoogleCalendarItemRow = {
  meeting_id: string
  user_id: string
  google_event_id: string
  sequence: number
  is_cancelled: boolean
  cancelled_at: string | null
}

type MeetingGoogleCalendarContext = {
  supabase: ReturnType<typeof getServiceClient>
  integration: MeetingGoogleCalendarIntegrationRow
  accessToken: string
  calendarId: string
}

type GoogleOAuthTokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type?: string
  id_token?: string
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

function buildGoogleEventUid(userId: string, meetingId: string) {
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

function buildGoogleSummary(meeting: MeetingCalendarMeetingRow) {
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

function buildGoogleDescription(meeting: MeetingCalendarMeetingRow) {
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

function buildGoogleCalendarEvent(meeting: MeetingCalendarMeetingRow) {
  if (!meeting.meeting_datetime) {
    throw new Error('Schůzka nemá datum pro Google kalendář.')
  }

  const start = new Date(meeting.meeting_datetime)
  if (Number.isNaN(start.getTime())) {
    throw new Error('Schůzka má neplatné datum pro Google kalendář.')
  }

  const end = new Date(start.getTime() + MEETING_CALENDAR_DEFAULT_DURATION_MINUTES * 60_000)

  return {
    summary: buildGoogleSummary(meeting),
    description: buildGoogleDescription(meeting),
    location: meeting.address?.trim() || undefined,
    start: {
      dateTime: start.toISOString(),
      timeZone: MEETING_CALENDAR_TIME_ZONE,
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: MEETING_CALENDAR_TIME_ZONE,
    },
    transparency: 'opaque',
    reminders: {
      useDefault: false,
      overrides: [
        {
          method: 'popup',
          minutes: 120,
        },
      ],
    },
  }
}

function buildEventUid(userId: string, meetingId: string) {
  return `${MEETING_CALENDAR_UID_PREFIX}:${userId}:${meetingId}`
}

async function readGoogleError(response: Response) {
  const text = await response.text()

  if (!text) {
    return `${response.status} ${response.statusText}`
  }

  return text
}

async function fetchGoogleJson<T>(
  url: string,
  options: RequestInit,
  accessToken: string
) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  })

  if (response.status === 204) {
    return null as T
  }

  if (!response.ok) {
    throw new Error(await readGoogleError(response))
  }

  return (await response.json()) as T
}

async function exchangeGoogleAuthorizationCode(
  code: string,
  redirectUri: string
) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId) {
    throw new Error('Chybí GOOGLE_CLIENT_ID.')
  }

  if (!clientSecret) {
    throw new Error('Chybí GOOGLE_CLIENT_SECRET.')
  }

  const body = new URLSearchParams()
  body.set('client_id', clientId)
  body.set('client_secret', clientSecret)
  body.set('code', code)
  body.set('grant_type', 'authorization_code')
  body.set('redirect_uri', redirectUri)

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!response.ok) {
    throw new Error(await readGoogleError(response))
  }

  return (await response.json()) as GoogleOAuthTokenResponse
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId) {
    throw new Error('Chybí GOOGLE_CLIENT_ID.')
  }

  if (!clientSecret) {
    throw new Error('Chybí GOOGLE_CLIENT_SECRET.')
  }

  const body = new URLSearchParams()
  body.set('client_id', clientId)
  body.set('client_secret', clientSecret)
  body.set('refresh_token', refreshToken)
  body.set('grant_type', 'refresh_token')

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  })

  if (!response.ok) {
    throw new Error(await readGoogleError(response))
  }

  const data = (await response.json()) as { access_token?: string }

  if (!data.access_token) {
    throw new Error('Google neposlal přístupový token.')
  }

  return data.access_token
}

async function createGoogleCalendar(accessToken: string) {
  const response = await fetchGoogleJson<{ id?: string }>(
    'https://www.googleapis.com/calendar/v3/calendars',
    {
      method: 'POST',
      body: JSON.stringify({
        summary: MEETING_GOOGLE_CALENDAR_NAME,
        timeZone: MEETING_CALENDAR_TIME_ZONE,
        description: 'Kalendář pro schůzky B-ENERGY.',
      }),
    },
    accessToken
  )

  if (!response?.id) {
    throw new Error('Google nevytvořil kalendář.')
  }

  return response.id
}

async function ensureGoogleCalendarId({
  supabase,
  userId,
  integration,
  accessToken,
}: {
  supabase: ReturnType<typeof getServiceClient>
  userId: string
  integration: MeetingGoogleCalendarIntegrationRow
  accessToken: string
}) {
  if (integration.calendar_id) {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
        integration.calendar_id
      )}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (response.ok) {
      return integration.calendar_id
    }

    if (response.status !== 404) {
      throw new Error(await readGoogleError(response))
    }
  }

  const calendarId = await createGoogleCalendar(accessToken)

  const { error } = await supabase
    .from('meeting_google_calendar_integrations')
    .update({
      calendar_id: calendarId,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)

  if (error) {
    throw new Error(
      `Kalendář se sice vytvořil, ale nepodařilo se uložit jeho ID: ${error.message}`
    )
  }

  integration.calendar_id = calendarId
  return calendarId
}

async function getGoogleSyncContext(
  userId: string
): Promise<MeetingGoogleCalendarContext | null> {
  const supabase = getServiceClient()

  const { data: integration, error } = await supabase
    .from('meeting_google_calendar_integrations')
    .select(
      'user_id, google_sub, google_email, refresh_token, calendar_id, calendar_name, enabled, disabled_at, connected_at, created_at, updated_at'
    )
    .eq('user_id', userId)
    .maybeSingle<MeetingGoogleCalendarIntegrationRow>()

  if (error) {
    throw new Error(
      `Nepodařilo se načíst Google kalendář schůzek: ${error.message}`
    )
  }

  if (
    !integration ||
    !integration.enabled ||
    integration.disabled_at ||
    !integration.refresh_token
  ) {
    return null
  }

  const accessToken = await refreshGoogleAccessToken(integration.refresh_token)
  const calendarId = await ensureGoogleCalendarId({
    supabase,
    userId,
    integration,
    accessToken,
  })

  return {
    supabase,
    integration,
    accessToken,
    calendarId,
  }
}

async function getAssignedMeetingIdsForUser(userId: string) {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('meetings')
    .select('id')
    .eq('assigned_user_id', userId)

  if (error) {
    throw new Error(
      `Nepodařilo se načíst přiřazené schůzky pro Google kalendář: ${error.message}`
    )
  }

  return Array.from(
    new Set(
      (data ?? [])
        .map((item) => String((item as { id?: string | null }).id ?? '').trim())
        .filter((meetingId) => Boolean(meetingId))
    )
  )
}

async function fetchGoogleEventById(
  calendarId: string,
  eventId: string,
  accessToken: string
) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events/${encodeURIComponent(eventId)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(await readGoogleError(response))
  }

  return (await response.json()) as { id?: string }
}

async function insertGoogleEvent({
  calendarId,
  accessToken,
  meeting,
}: {
  calendarId: string
  accessToken: string
  meeting: MeetingCalendarMeetingRow
}) {
  return fetchGoogleJson<{ id: string }>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events?sendUpdates=none`,
    {
      method: 'POST',
      body: JSON.stringify(buildGoogleCalendarEvent(meeting)),
    },
    accessToken
  )
}

async function patchGoogleEvent({
  calendarId,
  eventId,
  accessToken,
  meeting,
}: {
  calendarId: string
  eventId: string
  accessToken: string
  meeting: MeetingCalendarMeetingRow
}) {
  return fetchGoogleJson<{ id: string }>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    {
      method: 'PATCH',
      body: JSON.stringify(buildGoogleCalendarEvent(meeting)),
    },
    accessToken
  )
}

async function deleteGoogleEvent({
  calendarId,
  eventId,
  accessToken,
}: {
  calendarId: string
  eventId: string
  accessToken: string
}) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (response.status === 404) {
    return
  }

  if (!response.ok) {
    throw new Error(await readGoogleError(response))
  }
}

async function deleteGoogleCalendar(calendarId: string, accessToken: string) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (response.status === 404) {
    return
  }

  if (!response.ok) {
    throw new Error(await readGoogleError(response))
  }
}

async function syncMeetingGoogleCalendarItemWithContext(params: {
  context: MeetingGoogleCalendarContext
  meetingId: string
  meeting: MeetingCalendarMeetingRow
}) {
  const { context, meetingId, meeting } = params
  const { supabase, calendarId, accessToken } = context

  const { data: existingItem, error: itemError } = await supabase
    .from('meeting_google_calendar_items')
    .select(
      'meeting_id, user_id, google_event_id, sequence, is_cancelled, cancelled_at'
    )
    .eq('meeting_id', meetingId)
    .eq('user_id', context.integration.user_id)
    .maybeSingle<MeetingGoogleCalendarItemRow>()

  if (itemError) {
    throw new Error(
      `Nepodařilo se načíst položku Google kalendáře: ${itemError.message}`
    )
  }

  const nextSequence = (existingItem?.sequence ?? 0) + 1
  const nextEventId = existingItem?.google_event_id
  let savedEventId = nextEventId

  if (nextEventId && !existingItem?.is_cancelled) {
    const existingEvent = await fetchGoogleEventById(
      calendarId,
      nextEventId,
      accessToken
    )

    if (existingEvent) {
      const patchedEvent = await patchGoogleEvent({
        calendarId,
        eventId: nextEventId,
        accessToken,
        meeting,
      })

      savedEventId = patchedEvent?.id ?? nextEventId
    } else {
      const createdEvent = await insertGoogleEvent({
        calendarId,
        accessToken,
        meeting,
      })

      savedEventId =
        createdEvent?.id ??
        buildGoogleEventUid(context.integration.user_id, meetingId)
    }
  } else {
    const createdEvent = await insertGoogleEvent({
      calendarId,
      accessToken,
      meeting,
    })

    savedEventId =
      createdEvent?.id ?? buildGoogleEventUid(context.integration.user_id, meetingId)
  }

  const { error } = await supabase.from('meeting_google_calendar_items').upsert({
    meeting_id: meetingId,
    user_id: context.integration.user_id,
    google_event_id: savedEventId,
    sequence: nextSequence,
    is_cancelled: false,
    cancelled_at: null,
    updated_at: new Date().toISOString(),
  })

  if (error) {
    throw new Error(
      `Nepodařilo se uložit položku Google kalendáře: ${error.message}`
    )
  }

  return {
    savedEventId,
  }
}

async function cancelMeetingGoogleCalendarItemWithContext(params: {
  context: MeetingGoogleCalendarContext | null
  meetingId: string
}) {
  if (!params.context) {
    return
  }

  const { context, meetingId } = params
  const { supabase, calendarId, accessToken } = context

  const { data: existingItem, error: itemError } = await supabase
    .from('meeting_google_calendar_items')
    .select(
      'meeting_id, user_id, google_event_id, sequence, is_cancelled, cancelled_at'
    )
    .eq('meeting_id', meetingId)
    .eq('user_id', context.integration.user_id)
    .maybeSingle<MeetingGoogleCalendarItemRow>()

  if (itemError) {
    throw new Error(
      `Nepodařilo se načíst položku Google kalendáře: ${itemError.message}`
    )
  }

  if (existingItem?.google_event_id && !existingItem.is_cancelled) {
    await deleteGoogleEvent({
      calendarId,
      eventId: existingItem.google_event_id,
      accessToken,
    })
  }

  const { error } = await supabase.from('meeting_google_calendar_items').upsert({
    meeting_id: meetingId,
    user_id: context.integration.user_id,
    google_event_id:
      existingItem?.google_event_id ??
      buildGoogleEventUid(context.integration.user_id, meetingId),
    sequence: (existingItem?.sequence ?? 0) + 1,
    is_cancelled: true,
    cancelled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  if (error) {
    throw new Error(
      `Nepodařilo se zrušit položku Google kalendáře: ${error.message}`
    )
  }
}

export async function syncMeetingGoogleCalendarItem(params: {
  meetingId: string
  userId: string
  meeting: MeetingCalendarMeetingRow
}) {
  const context = await getGoogleSyncContext(params.userId)

  if (!context) {
    return null
  }

  return syncMeetingGoogleCalendarItemWithContext({
    context,
    meetingId: params.meetingId,
    meeting: params.meeting,
  })
}

export async function cancelMeetingGoogleCalendarItem(params: {
  meetingId: string
  userId: string
}) {
  const context = await getGoogleSyncContext(params.userId)

  return cancelMeetingGoogleCalendarItemWithContext({
    context,
    meetingId: params.meetingId,
  })
}

export async function backfillMeetingGoogleCalendarItemsForUser(userId: string) {
  const context = await getGoogleSyncContext(userId)

  if (!context) {
    return { insertedCount: 0 }
  }

  const assignedMeetingIds = await getAssignedMeetingIdsForUser(userId)

  if (assignedMeetingIds.length === 0) {
    return { insertedCount: 0 }
  }

  const { data: existingItems, error: itemsError } = await context.supabase
    .from('meeting_google_calendar_items')
    .select('meeting_id')
    .eq('user_id', userId)

  if (itemsError) {
    throw new Error(
      `Nepodařilo se načíst položky Google kalendáře pro backfill: ${itemsError.message}`
    )
  }

  const existingMeetingIds = new Set(
    (existingItems ?? []).map((item) => String(item.meeting_id ?? '').trim())
  )
  const missingCount = assignedMeetingIds.filter(
    (meetingId) => !existingMeetingIds.has(meetingId)
  ).length

  const { data: meetings, error: meetingsError } = await context.supabase
    .from('meetings')
    .select(
      `
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
      `
    )
    .in('id', assignedMeetingIds)
    .order('meeting_datetime', { ascending: true })

  if (meetingsError) {
    throw new Error(
      `Nepodařilo se načíst schůzky pro backfill Google kalendáře: ${meetingsError.message}`
    )
  }

  for (const meeting of (meetings ?? []) as MeetingCalendarMeetingRow[]) {
    await syncMeetingGoogleCalendarItemWithContext({
      context,
      meetingId: meeting.id,
      meeting,
    })
  }

  return { insertedCount: missingCount }
}

export async function createMeetingGoogleCalendarOAuthUrl(params: {
  redirectUri: string
  state: string
}) {
  const clientId = process.env.GOOGLE_CLIENT_ID

  if (!clientId) {
    throw new Error('Chybí GOOGLE_CLIENT_ID.')
  }

  const authUrl = new URL(GOOGLE_OAUTH_AUTHORIZE_URL)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', params.redirectUri)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', GOOGLE_OAUTH_SCOPE)
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent select_account')
  authUrl.searchParams.set('include_granted_scopes', 'true')
  authUrl.searchParams.set('state', params.state)

  return authUrl.toString()
}

export async function completeMeetingGoogleCalendarOAuth(params: {
  code: string
  redirectUri: string
  userId: string
}) {
  const supabase = getServiceClient()
  const tokens = await exchangeGoogleAuthorizationCode(
    params.code,
    params.redirectUri
  )

  const accessToken = tokens.access_token

  const { data: existingIntegration, error: integrationError } = await supabase
    .from('meeting_google_calendar_integrations')
    .select(
      'user_id, google_sub, google_email, refresh_token, calendar_id, calendar_name, enabled, disabled_at, connected_at, created_at, updated_at'
    )
    .eq('user_id', params.userId)
    .maybeSingle<MeetingGoogleCalendarIntegrationRow>()

  if (integrationError) {
    throw new Error(
      `Nepodařilo se načíst Google kalendář pro aktivaci: ${integrationError.message}`
    )
  }

  const refreshToken = tokens.refresh_token ?? existingIntegration?.refresh_token

  if (!refreshToken) {
    throw new Error(
      'Google neposlal obnovovací token. Zkus prosím aktivaci znovu a potvrď přístup.'
    )
  }

  let calendarId = existingIntegration?.calendar_id ?? null

  if (calendarId) {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (response.status === 404) {
      calendarId = await createGoogleCalendar(accessToken)
    } else if (!response.ok) {
      throw new Error(await readGoogleError(response))
    }
  } else {
    calendarId = await createGoogleCalendar(accessToken)
  }

  const now = new Date().toISOString()
  const { error: upsertError } = await supabase
    .from('meeting_google_calendar_integrations')
    .upsert({
      user_id: params.userId,
      google_sub: existingIntegration?.google_sub ?? null,
      google_email: existingIntegration?.google_email ?? null,
      refresh_token: refreshToken,
      calendar_id: calendarId,
      calendar_name: MEETING_GOOGLE_CALENDAR_NAME,
      enabled: true,
      disabled_at: null,
      connected_at: existingIntegration?.connected_at ?? now,
      updated_at: now,
    })

  if (upsertError) {
    throw new Error(
      `Nepodařilo se uložit Google kalendář: ${upsertError.message}`
    )
  }

  const backfillResult = await backfillMeetingGoogleCalendarItemsForUser(
    params.userId
  )

  return {
    insertedCount: backfillResult.insertedCount,
    calendarId,
  }
}

export async function disconnectMeetingGoogleCalendar(userId: string) {
  const supabase = getServiceClient()

  const { data: integration, error } = await supabase
    .from('meeting_google_calendar_integrations')
    .select(
      'user_id, google_sub, google_email, refresh_token, calendar_id, calendar_name, enabled, disabled_at, connected_at, created_at, updated_at'
    )
    .eq('user_id', userId)
    .maybeSingle<MeetingGoogleCalendarIntegrationRow>()

  if (error) {
    throw new Error(
      `Nepodařilo se načíst Google kalendář pro odpojení: ${error.message}`
    )
  }

  if (!integration) {
    return { disconnected: false, deletedCalendar: false }
  }

  let deletedCalendar = false

  if (integration.refresh_token && integration.calendar_id) {
    const accessToken = await refreshGoogleAccessToken(integration.refresh_token)
    await deleteGoogleCalendar(integration.calendar_id, accessToken)
    deletedCalendar = true
  }

  const now = new Date().toISOString()

  const { error: itemsError } = await supabase
    .from('meeting_google_calendar_items')
    .delete()
    .eq('user_id', userId)

  if (itemsError) {
    throw new Error(
      `Nepodařilo se odstranit položky Google kalendáře: ${itemsError.message}`
    )
  }

  const { error: deleteError } = await supabase
    .from('meeting_google_calendar_integrations')
    .delete()
    .eq('user_id', userId)

  if (deleteError) {
    throw new Error(
      `Nepodařilo se odstranit Google kalendář schůzek: ${deleteError.message}`
    )
  }

  return {
    disconnected: true,
    deletedCalendar,
    disconnectedAt: now,
  }
}
