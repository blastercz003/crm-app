import { getServiceRoleClient } from '@/lib/supabase/service'
import type { DispatcherCalendarJobRow } from './dispatcher-calendar-feed'

export const DISPATCHER_GOOGLE_CALENDAR_NAME = 'B-ENERGY VŠECHNY ZAKÁZKY'
export const DISPATCHER_GOOGLE_CALENDAR_TIME_ZONE = 'Europe/Prague'
const DISPATCHER_GOOGLE_CALENDAR_ALARM_MINUTES = 120
const DISPATCHER_GOOGLE_CALENDAR_UID_PREFIX = 'b-energy-vsechny-zakazky-google'
const GOOGLE_OAUTH_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'
const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'

type GoogleOAuthTokenResponse = {
  access_token: string
  refresh_token?: string
}

type DispatcherGoogleIntegrationRow = {
  user_id: string
  google_sub: string | null
  google_email: string | null
  refresh_token: string
  calendar_id: string | null
  calendar_name: string
  enabled: boolean
  disabled_at: string | null
  connected_at: string | null
}

type DispatcherGoogleItemRow = {
  job_id: string
  user_id: string
  google_event_id: string
  sequence: number
  is_cancelled: boolean
  cancelled_at: string | null
}

type GoogleSyncContext = {
  supabase: ReturnType<typeof getServiceClient>
  integration: DispatcherGoogleIntegrationRow
  accessToken: string
  calendarId: string
}

const INTEGRATION_SELECT =
  'user_id, google_sub, google_email, refresh_token, calendar_id, calendar_name, enabled, disabled_at, connected_at'

const JOB_SELECT = `
  id,
  job_number,
  company_name,
  contact_person,
  start_at,
  end_at,
  site_address,
  store_number,
  technician_name,
  generator_name,
  info_note,
  job_status,
  invoice_status,
  evidence_status,
  marny_vyjezd
`

function getServiceClient() {
  const client = getServiceRoleClient()

  if (!client) {
    throw new Error('Chybí Supabase service role client pro Google kalendář dispečera.')
  }

  return client
}

function formatPragueDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: DISPATCHER_GOOGLE_CALENDAR_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function getJobStatusLabel(status: DispatcherCalendarJobRow['job_status']) {
  return {
    nova: 'Nová',
    k_reseni: 'V řešení',
    realizace: 'Realizace',
    ukoncena: 'Ukončená',
    storno: 'Storno',
  }[status]
}

function getInvoiceStatusLabel(status: DispatcherCalendarJobRow['invoice_status']) {
  return {
    bez_faktury: 'Bez faktury',
    k_fakturaci: 'K fakturaci',
    vyfakturovano: 'Vyfakturováno',
  }[status]
}

function getEvidenceStatusLabel(status: DispatcherCalendarJobRow['evidence_status']) {
  return { nove: 'Zapsat', zapsano: 'Zapsáno' }[status]
}

function buildSummary(job: DispatcherCalendarJobRow) {
  const jobNumber = job.job_number.trim()
  const companyName = job.company_name.trim()
  const summary =
    jobNumber && companyName
      ? `${jobNumber} · ${companyName}`
      : jobNumber
        ? `Zakázka ${jobNumber}`
        : companyName || 'Zakázka'

  return job.job_status === 'storno' ? `STORNO · ${summary}` : summary
}

function buildDescription(job: DispatcherCalendarJobRow) {
  return [
    `Číslo zakázky: ${job.job_number.trim()}`,
    `Firma: ${job.company_name.trim()}`,
    job.contact_person?.trim()
      ? `Kontaktní osoba: ${job.contact_person.trim()}`
      : null,
    `Začátek: ${formatPragueDateTime(job.start_at)}`,
    `Konec: ${formatPragueDateTime(job.end_at)}`,
    job.site_address?.trim() ? `Adresa: ${job.site_address.trim()}` : null,
    job.store_number?.trim() ? `Prodejna: ${job.store_number.trim()}` : null,
    job.technician_name?.trim() ? `Technik: ${job.technician_name.trim()}` : null,
    job.generator_name?.trim() ? `Agregát: ${job.generator_name.trim()}` : null,
    `Stav zakázky: ${getJobStatusLabel(job.job_status)}`,
    `Fakturace: ${getInvoiceStatusLabel(job.invoice_status)}`,
    `Evidence: ${getEvidenceStatusLabel(job.evidence_status)}`,
    job.info_note?.trim() ? `Info poznámka: ${job.info_note.trim()}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

function buildGoogleEvent(job: DispatcherCalendarJobRow) {
  return {
    summary: buildSummary(job),
    description: buildDescription(job),
    location: job.site_address?.trim() || undefined,
    start: {
      dateTime: job.start_at,
      timeZone: DISPATCHER_GOOGLE_CALENDAR_TIME_ZONE,
    },
    end: {
      dateTime: job.end_at,
      timeZone: DISPATCHER_GOOGLE_CALENDAR_TIME_ZONE,
    },
    transparency: 'opaque',
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: DISPATCHER_GOOGLE_CALENDAR_ALARM_MINUTES },
      ],
    },
  }
}

function buildFallbackEventId(userId: string, jobId: string) {
  return `${DISPATCHER_GOOGLE_CALENDAR_UID_PREFIX}:${userId}:${jobId}`
}

async function readGoogleError(response: Response) {
  const text = await response.text()
  return text || `${response.status} ${response.statusText}`
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

  if (response.status === 204) return null as T
  if (!response.ok) throw new Error(await readGoogleError(response))
  return (await response.json()) as T
}

async function exchangeAuthorizationCode(code: string, redirectUri: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Chybí Google OAuth konfigurace.')

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  })

  if (!response.ok) throw new Error(await readGoogleError(response))
  return (await response.json()) as GoogleOAuthTokenResponse
}

async function refreshAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('Chybí Google OAuth konfigurace.')

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }).toString(),
  })

  if (!response.ok) throw new Error(await readGoogleError(response))
  const payload = (await response.json()) as GoogleOAuthTokenResponse
  if (!payload.access_token) throw new Error('Google nevrátil přístupový token.')
  return payload.access_token
}

async function createGoogleCalendar(accessToken: string) {
  const payload = await fetchGoogleJson<{ id?: string }>(
    'https://www.googleapis.com/calendar/v3/calendars',
    {
      method: 'POST',
      body: JSON.stringify({
        summary: DISPATCHER_GOOGLE_CALENDAR_NAME,
        timeZone: DISPATCHER_GOOGLE_CALENDAR_TIME_ZONE,
        description: 'Kompletní přehled zakázek B-ENERGY pro dispečera.',
      }),
    },
    accessToken
  )

  if (!payload?.id) throw new Error('Google nevytvořil dispečerský kalendář.')
  return payload.id
}

async function googleCalendarExists(calendarId: string, accessToken: string) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  if (response.status === 404) return false
  if (!response.ok) throw new Error(await readGoogleError(response))
  return true
}

async function getSyncContext(userId: string): Promise<GoogleSyncContext | null> {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('dispatcher_job_google_calendar_integrations')
    .select(INTEGRATION_SELECT)
    .eq('user_id', userId)
    .maybeSingle<DispatcherGoogleIntegrationRow>()

  if (error) throw new Error(`Nepodařilo se načíst Google kalendář: ${error.message}`)
  if (!data || !data.enabled || data.disabled_at || !data.refresh_token) return null

  const accessToken = await refreshAccessToken(data.refresh_token)
  let calendarId = data.calendar_id
  if (!calendarId || !(await googleCalendarExists(calendarId, accessToken))) {
    calendarId = await createGoogleCalendar(accessToken)
    const { error: updateError } = await supabase
      .from('dispatcher_job_google_calendar_integrations')
      .update({ calendar_id: calendarId })
      .eq('user_id', userId)
    if (updateError) throw new Error(`Nepodařilo se uložit ID kalendáře: ${updateError.message}`)
  }

  return { supabase, integration: data, accessToken, calendarId }
}

async function fetchGoogleEvent(context: GoogleSyncContext, eventId: string) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      context.calendarId
    )}/events/${encodeURIComponent(eventId)}`,
    { headers: { Authorization: `Bearer ${context.accessToken}` } }
  )
  if (response.status === 404 || response.status === 410) return null
  if (!response.ok) throw new Error(await readGoogleError(response))
  return (await response.json()) as { id?: string }
}

async function insertGoogleEvent(context: GoogleSyncContext, job: DispatcherCalendarJobRow) {
  return fetchGoogleJson<{ id?: string }>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      context.calendarId
    )}/events`,
    { method: 'POST', body: JSON.stringify(buildGoogleEvent(job)) },
    context.accessToken
  )
}

async function patchGoogleEvent(
  context: GoogleSyncContext,
  eventId: string,
  job: DispatcherCalendarJobRow
) {
  return fetchGoogleJson<{ id?: string }>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      context.calendarId
    )}/events/${encodeURIComponent(eventId)}`,
    { method: 'PATCH', body: JSON.stringify(buildGoogleEvent(job)) },
    context.accessToken
  )
}

async function deleteGoogleEvent(context: GoogleSyncContext, eventId: string) {
  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      context.calendarId
    )}/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${context.accessToken}` } }
  )
  if (response.status !== 404 && response.status !== 410 && !response.ok) {
    throw new Error(await readGoogleError(response))
  }
}

async function syncWithContext(
  context: GoogleSyncContext,
  job: DispatcherCalendarJobRow
) {
  const { data: existingItem, error: itemError } = await context.supabase
    .from('dispatcher_job_google_calendar_items')
    .select('job_id, user_id, google_event_id, sequence, is_cancelled, cancelled_at')
    .eq('job_id', job.id)
    .eq('user_id', context.integration.user_id)
    .maybeSingle<DispatcherGoogleItemRow>()

  if (itemError) throw new Error(`Nepodařilo se načíst Google událost: ${itemError.message}`)

  let googleEventId: string | undefined
  if (existingItem?.google_event_id && !existingItem.is_cancelled) {
    const existingEvent = await fetchGoogleEvent(context, existingItem.google_event_id)
    if (existingEvent) {
      googleEventId = (await patchGoogleEvent(context, existingItem.google_event_id, job))?.id
    }
  }
  if (!googleEventId) googleEventId = (await insertGoogleEvent(context, job))?.id
  googleEventId ??= buildFallbackEventId(context.integration.user_id, job.id)

  const { error } = await context.supabase
    .from('dispatcher_job_google_calendar_items')
    .upsert({
      job_id: job.id,
      user_id: context.integration.user_id,
      google_event_id: googleEventId,
      sequence: (existingItem?.sequence ?? 0) + 1,
      is_cancelled: false,
      cancelled_at: null,
      updated_at: new Date().toISOString(),
    })
  if (error) throw new Error(`Nepodařilo se uložit Google událost: ${error.message}`)
}

async function cancelWithContext(context: GoogleSyncContext, jobId: string) {
  const { data: existingItem, error: itemError } = await context.supabase
    .from('dispatcher_job_google_calendar_items')
    .select('job_id, user_id, google_event_id, sequence, is_cancelled, cancelled_at')
    .eq('job_id', jobId)
    .eq('user_id', context.integration.user_id)
    .maybeSingle<DispatcherGoogleItemRow>()

  if (itemError) throw new Error(`Nepodařilo se načíst Google událost: ${itemError.message}`)
  if (!existingItem) return
  if (!existingItem.is_cancelled) {
    await deleteGoogleEvent(context, existingItem.google_event_id)
  }

  const { error } = await context.supabase
    .from('dispatcher_job_google_calendar_items')
    .update({
      sequence: existingItem.sequence + 1,
      is_cancelled: true,
      cancelled_at: new Date().toISOString(),
    })
    .eq('job_id', jobId)
    .eq('user_id', context.integration.user_id)
  if (error) throw new Error(`Nepodařilo se zrušit Google událost: ${error.message}`)
}

export async function syncDispatcherGoogleCalendarItem(params: {
  userId: string
  job: DispatcherCalendarJobRow
}) {
  const context = await getSyncContext(params.userId)
  if (!context) return null
  if (params.job.marny_vyjezd) return cancelWithContext(context, params.job.id)
  return syncWithContext(context, params.job)
}

export async function cancelDispatcherGoogleCalendarItem(params: {
  userId: string
  jobId: string
}) {
  const context = await getSyncContext(params.userId)
  if (!context) return null
  return cancelWithContext(context, params.jobId)
}

export async function backfillDispatcherGoogleCalendarItemsForUser(userId: string) {
  const context = await getSyncContext(userId)
  if (!context) return { insertedCount: 0 }

  const { data: existingItems, error: itemsError } = await context.supabase
    .from('dispatcher_job_google_calendar_items')
    .select('job_id')
    .eq('user_id', userId)
  if (itemsError) throw new Error(`Nepodařilo se načíst Google položky: ${itemsError.message}`)

  const { data: jobs, error: jobsError } = await context.supabase
    .from('jobs')
    .select(JOB_SELECT)
    .or('marny_vyjezd.is.null,marny_vyjezd.eq.false')
    .order('start_at', { ascending: true })
  if (jobsError) throw new Error(`Nepodařilo se načíst zakázky: ${jobsError.message}`)

  const existingJobIds = new Set((existingItems ?? []).map((item) => item.job_id))
  const typedJobs = (jobs ?? []) as DispatcherCalendarJobRow[]
  const insertedCount = typedJobs.filter((job) => !existingJobIds.has(job.id)).length
  for (const job of typedJobs) await syncWithContext(context, job)
  return { insertedCount }
}

export function createDispatcherGoogleCalendarOAuthUrl(params: {
  redirectUri: string
  state: string
}) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) throw new Error('Chybí GOOGLE_CLIENT_ID.')

  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_OAUTH_SCOPE)
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent select_account')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', params.state)
  return url.toString()
}

export async function completeDispatcherGoogleCalendarOAuth(params: {
  code: string
  redirectUri: string
  userId: string
}) {
  const supabase = getServiceClient()
  const tokens = await exchangeAuthorizationCode(params.code, params.redirectUri)
  const { data: existing, error: readError } = await supabase
    .from('dispatcher_job_google_calendar_integrations')
    .select(INTEGRATION_SELECT)
    .eq('user_id', params.userId)
    .maybeSingle<DispatcherGoogleIntegrationRow>()
  if (readError) throw new Error(`Nepodařilo se načíst Google propojení: ${readError.message}`)

  const refreshToken = tokens.refresh_token ?? existing?.refresh_token
  if (!refreshToken) {
    throw new Error('Google neposlal obnovovací token. Zkus aktivaci znovu a potvrď přístup.')
  }

  let calendarId = existing?.calendar_id ?? null
  if (!calendarId || !(await googleCalendarExists(calendarId, tokens.access_token))) {
    calendarId = await createGoogleCalendar(tokens.access_token)
  }

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('dispatcher_job_google_calendar_integrations')
    .upsert({
      user_id: params.userId,
      google_sub: existing?.google_sub ?? null,
      google_email: existing?.google_email ?? null,
      refresh_token: refreshToken,
      calendar_id: calendarId,
      calendar_name: DISPATCHER_GOOGLE_CALENDAR_NAME,
      enabled: true,
      disabled_at: null,
      connected_at: existing?.connected_at ?? now,
      updated_at: now,
    })
  if (error) throw new Error(`Nepodařilo se uložit Google propojení: ${error.message}`)

  const backfill = await backfillDispatcherGoogleCalendarItemsForUser(params.userId)
  return { calendarId, insertedCount: backfill.insertedCount }
}

export async function disconnectDispatcherGoogleCalendar(userId: string) {
  const context = await getSyncContext(userId)
  const supabase = getServiceClient()
  if (!context) return { disconnected: false, deletedCalendar: false }

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      context.calendarId
    )}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${context.accessToken}` } }
  )
  if (response.status !== 404 && !response.ok) throw new Error(await readGoogleError(response))

  const { error: itemsError } = await supabase
    .from('dispatcher_job_google_calendar_items')
    .delete()
    .eq('user_id', userId)
  if (itemsError) throw new Error(`Nepodařilo se odstranit Google položky: ${itemsError.message}`)

  const { error: integrationError } = await supabase
    .from('dispatcher_job_google_calendar_integrations')
    .delete()
    .eq('user_id', userId)
  if (integrationError) {
    throw new Error(`Nepodařilo se odstranit Google propojení: ${integrationError.message}`)
  }

  return { disconnected: true, deletedCalendar: true }
}
