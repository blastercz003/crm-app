import { getServiceRoleClient } from '@/lib/supabase/service'
import type { JobCalendarJobRow } from './calendar-feed'

export const JOB_GOOGLE_CALENDAR_NAME = 'B-ENERGY ZAKÁZKY TECHNIKA'
export const JOB_GOOGLE_CALENDAR_TIME_ZONE = 'Europe/Prague'
const JOB_GOOGLE_CALENDAR_ALARM_MINUTES = 120
const JOB_GOOGLE_CALENDAR_UID_PREFIX = 'b-energy-zakazky-technika-google'
const GOOGLE_OAUTH_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'
const GOOGLE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_REQUEST_TIMEOUT_MS = 8_000
const GOOGLE_REQUEST_RETRY_DELAY_MS = 250

type GoogleOAuthTokenResponse = {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
  token_type?: string
  id_token?: string
}

export type JobGoogleCalendarIntegrationRow = {
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

type JobGoogleCalendarItemRow = {
  job_id: string
  user_id: string
  google_event_id: string
  sequence: number
  is_cancelled: boolean
  cancelled_at: string | null
}

type JobGoogleCalendarContext = {
  supabase: ReturnType<typeof getServiceClient>
  integration: JobGoogleCalendarIntegrationRow
  accessToken: string
  calendarId: string
}

function getServiceClient() {
  const client = getServiceRoleClient()

  if (!client) {
    throw new Error('Chybí Supabase service role client pro Google kalendář zakázek.')
  }

  return client
}

function formatPragueDateTime(value: string | null) {
  if (!value) return '—'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: JOB_GOOGLE_CALENDAR_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function buildSummary(job: JobCalendarJobRow) {
  const jobNumber = job.job_number.trim()
  const companyName = job.company_name.trim()

  if (jobNumber && companyName) {
    return `${jobNumber} · ${companyName}`
  }

  if (jobNumber) {
    return `Zakázka ${jobNumber}`
  }

  return companyName || 'Zakázka'
}

function getJobStatusLabel(status: JobCalendarJobRow['job_status']) {
  const labels: Record<JobCalendarJobRow['job_status'], string> = {
    nova: 'Nová',
    k_reseni: 'V řešení',
    realizace: 'Realizace',
    ukoncena: 'Ukončená',
    storno: 'Storno',
  }

  return labels[status] ?? status
}

function getInvoiceStatusLabel(status: JobCalendarJobRow['invoice_status']) {
  const labels: Record<JobCalendarJobRow['invoice_status'], string> = {
    bez_faktury: 'Bez faktury',
    k_fakturaci: 'K fakturaci',
    vyfakturovano: 'Vyfakturováno',
  }

  return labels[status] ?? status
}

function getEvidenceStatusLabel(status: JobCalendarJobRow['evidence_status']) {
  const labels: Record<JobCalendarJobRow['evidence_status'], string> = {
    nove: 'Zapsat',
    zapsano: 'Zapsáno',
  }

  return labels[status] ?? status
}

function buildDescription(job: JobCalendarJobRow) {
  const lines = [
    job.job_number.trim() ? `Číslo zakázky: ${job.job_number.trim()}` : null,
    job.company_name.trim() ? `Firma: ${job.company_name.trim()}` : null,
    job.contact_person?.trim()
      ? `Kontaktní osoba: ${job.contact_person.trim()}`
      : null,
    `Začátek: ${formatPragueDateTime(job.start_at)}`,
    `Konec: ${formatPragueDateTime(job.end_at)}`,
    job.site_address?.trim() ? `Adresa: ${job.site_address.trim()}` : null,
    job.store_number?.trim() ? `Prodejna: ${job.store_number.trim()}` : null,
    job.technician_name?.trim()
      ? `Technik: ${job.technician_name.trim()}`
      : null,
    job.generator_name?.trim()
      ? `Agregát: ${job.generator_name.trim()}`
      : null,
    job.info_note?.trim() ? `Info poznámka: ${job.info_note.trim()}` : null,
    `Stav zakázky: ${getJobStatusLabel(job.job_status)}`,
    `Fakturace: ${getInvoiceStatusLabel(job.invoice_status)}`,
    `Evidence: ${getEvidenceStatusLabel(job.evidence_status)}`,
  ].filter((line): line is string => Boolean(line))

  return lines.join('\n')
}

function buildGoogleCalendarEvent(job: JobCalendarJobRow) {
  return {
    summary: buildSummary(job),
    description: buildDescription(job),
    location: job.site_address?.trim() || undefined,
    start: {
      dateTime: job.start_at,
      timeZone: JOB_GOOGLE_CALENDAR_TIME_ZONE,
    },
    end: {
      dateTime: job.end_at,
      timeZone: JOB_GOOGLE_CALENDAR_TIME_ZONE,
    },
    transparency: 'opaque',
    reminders: {
      useDefault: false,
      overrides: [
        {
          method: 'popup',
          minutes: JOB_GOOGLE_CALENDAR_ALARM_MINUTES,
        },
      ],
    },
  }
}

function buildEventUid(userId: string, jobId: string) {
  return `${JOB_GOOGLE_CALENDAR_UID_PREFIX}:${userId}:${jobId}`
}

async function readGoogleError(response: Response) {
  const text = await response.text()

  if (!text) {
    return `${response.status} ${response.statusText}`
  }

  return text
}

function canRetryGoogleRequest(method: string) {
  return method === 'GET' || method === 'DELETE'
}

function isRetryableGoogleStatus(status: number) {
  return status === 429 || status >= 500
}

async function fetchGoogle(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const method = String(options.method ?? 'GET').toUpperCase()
  const maxAttempts = canRetryGoogleRequest(method) ? 2 : 1

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController()
    const parentSignal = options.signal
    const abortFromParent = () => controller.abort(parentSignal?.reason)
    const timeoutId = setTimeout(
      () => controller.abort(new Error('Google API request timeout')),
      GOOGLE_REQUEST_TIMEOUT_MS
    )

    if (parentSignal) {
      if (parentSignal.aborted) {
        abortFromParent()
      } else {
        parentSignal.addEventListener('abort', abortFromParent, { once: true })
      }
    }

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      })

      if (
        attempt < maxAttempts &&
        isRetryableGoogleStatus(response.status)
      ) {
        await response.body?.cancel()
        await new Promise((resolve) =>
          setTimeout(resolve, GOOGLE_REQUEST_RETRY_DELAY_MS)
        )
        continue
      }

      return response
    } catch (error) {
      if (attempt < maxAttempts && !parentSignal?.aborted) {
        await new Promise((resolve) =>
          setTimeout(resolve, GOOGLE_REQUEST_RETRY_DELAY_MS)
        )
        continue
      }

      if (controller.signal.aborted && !parentSignal?.aborted) {
        throw new Error(
          `Google API neodpovědělo do ${GOOGLE_REQUEST_TIMEOUT_MS / 1000} sekund.`,
          { cause: error }
        )
      }

      throw error
    } finally {
      clearTimeout(timeoutId)
      parentSignal?.removeEventListener('abort', abortFromParent)
    }
  }

  throw new Error('Google API požadavek se nepodařilo dokončit.')
}

async function fetchGoogleJson<T>(
  url: string,
  options: RequestInit,
  accessToken: string
) {
  const response = await fetchGoogle(url, {
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

  if (!clientId || !clientSecret) {
    throw new Error('Chybí Google OAuth konfigurace.')
  }

  const response = await fetchGoogle(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }).toString(),
  })

  if (!response.ok) {
    throw new Error(await readGoogleError(response))
  }

  return (await response.json()) as GoogleOAuthTokenResponse
}

async function refreshGoogleAccessToken(refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    throw new Error('Chybí Google OAuth konfigurace.')
  }

  const response = await fetchGoogle(GOOGLE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }).toString(),
  })

  if (!response.ok) {
    throw new Error(await readGoogleError(response))
  }

  const payload = (await response.json()) as GoogleOAuthTokenResponse

  if (!payload.access_token) {
    throw new Error('Google nevrátil přístupový token.')
  }

  return payload.access_token
}

async function createGoogleCalendar(accessToken: string) {
  const response = await fetchGoogle(
    'https://www.googleapis.com/calendar/v3/calendars',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        summary: JOB_GOOGLE_CALENDAR_NAME,
        timeZone: JOB_GOOGLE_CALENDAR_TIME_ZONE,
        description: 'Kalendář zakázek technika B-ENERGY.',
      }),
    }
  )

  if (!response.ok) {
    throw new Error(await readGoogleError(response))
  }

  const payload = (await response.json()) as { id?: string }

  if (!payload.id) {
    throw new Error('Google nevytvořil kalendář.')
  }

  return payload.id
}

async function ensureGoogleCalendarId({
  supabase,
  userId,
  integration,
  accessToken,
}: {
  supabase: ReturnType<typeof getServiceClient>
  userId: string
  integration: JobGoogleCalendarIntegrationRow
  accessToken: string
}) {
  if (integration.calendar_id) {
    const response = await fetchGoogle(
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
    .from('job_google_calendar_integrations')
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

async function getGoogleSyncContext(userId: string): Promise<JobGoogleCalendarContext | null> {
  const supabase = getServiceClient()

  const { data: integration, error } = await supabase
    .from('job_google_calendar_integrations')
    .select(
      'user_id, google_sub, google_email, refresh_token, calendar_id, calendar_name, enabled, disabled_at, connected_at, created_at, updated_at'
    )
    .eq('user_id', userId)
    .maybeSingle<JobGoogleCalendarIntegrationRow>()

  if (error) {
    throw new Error(
      `Nepodařilo se načíst Google kalendář zakázek: ${error.message}`
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

async function getAssignedJobIdsForUser(userId: string) {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('job_technicians')
    .select('job_id')
    .eq('technician_id', userId)

  if (error) {
    throw new Error(
      `Nepodařilo se načíst přiřazené zakázky pro Google kalendář: ${error.message}`
    )
  }

  return Array.from(
    new Set(
      (data ?? [])
        .map((item) => String(item.job_id ?? '').trim())
        .filter((jobId) => Boolean(jobId))
    )
  )
}

async function fetchGoogleEventById(
  calendarId: string,
  eventId: string,
  accessToken: string
) {
  const response = await fetchGoogle(
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
  job,
}: {
  calendarId: string
  accessToken: string
  job: JobCalendarJobRow
}) {
  return fetchGoogleJson<{ id: string }>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events?sendUpdates=none`,
    {
      method: 'POST',
      body: JSON.stringify(buildGoogleCalendarEvent(job)),
    },
    accessToken
  )
}

async function patchGoogleEvent({
  calendarId,
  eventId,
  accessToken,
  job,
}: {
  calendarId: string
  eventId: string
  accessToken: string
  job: JobCalendarJobRow
}) {
  return fetchGoogleJson<{ id: string }>(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(
      calendarId
    )}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
    {
      method: 'PATCH',
      body: JSON.stringify(buildGoogleCalendarEvent(job)),
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
  const response = await fetchGoogle(
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
  const response = await fetchGoogle(
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

async function syncJobGoogleCalendarItemWithContext(params: {
  context: JobGoogleCalendarContext
  jobId: string
  job: JobCalendarJobRow
}) {
  const { context, jobId, job } = params
  const { supabase, calendarId, accessToken } = context

  const { data: existingItem, error: itemError } = await supabase
    .from('job_google_calendar_items')
    .select(
      'job_id, user_id, google_event_id, sequence, is_cancelled, cancelled_at'
    )
    .eq('job_id', jobId)
    .eq('user_id', context.integration.user_id)
    .maybeSingle<JobGoogleCalendarItemRow>()

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
        job,
      })

      savedEventId = patchedEvent?.id ?? nextEventId
    } else {
      const createdEvent = await insertGoogleEvent({
        calendarId,
        accessToken,
        job,
      })

      savedEventId = createdEvent?.id ?? buildEventUid(context.integration.user_id, jobId)
    }
  } else {
    const createdEvent = await insertGoogleEvent({
      calendarId,
      accessToken,
      job,
    })

    savedEventId = createdEvent?.id ?? buildEventUid(context.integration.user_id, jobId)
  }

  const { error } = await supabase.from('job_google_calendar_items').upsert({
    job_id: jobId,
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

async function cancelJobGoogleCalendarItemWithContext(params: {
  context: JobGoogleCalendarContext | null
  jobId: string
}) {
  if (!params.context) {
    return
  }

  const { context, jobId } = params
  const { supabase, calendarId, accessToken } = context

  const { data: existingItem, error: itemError } = await supabase
    .from('job_google_calendar_items')
    .select(
      'job_id, user_id, google_event_id, sequence, is_cancelled, cancelled_at'
    )
    .eq('job_id', jobId)
    .eq('user_id', context.integration.user_id)
    .maybeSingle<JobGoogleCalendarItemRow>()

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

  const { error } = await supabase.from('job_google_calendar_items').upsert({
    job_id: jobId,
    user_id: context.integration.user_id,
    google_event_id: existingItem?.google_event_id ?? buildEventUid(context.integration.user_id, jobId),
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

export async function syncJobGoogleCalendarItem(params: {
  jobId: string
  userId: string
  job: JobCalendarJobRow
}) {
  const context = await getGoogleSyncContext(params.userId)

  if (!context) {
    return null
  }

  return syncJobGoogleCalendarItemWithContext({
    context,
    jobId: params.jobId,
    job: params.job,
  })
}

export async function cancelJobGoogleCalendarItem(params: {
  jobId: string
  userId: string
}) {
  const context = await getGoogleSyncContext(params.userId)

  return cancelJobGoogleCalendarItemWithContext({
    context,
    jobId: params.jobId,
  })
}

export async function backfillJobGoogleCalendarItemsForUser(userId: string) {
  const context = await getGoogleSyncContext(userId)

  if (!context) {
    return { insertedCount: 0 }
  }

  const assignedJobIds = await getAssignedJobIdsForUser(userId)

  if (assignedJobIds.length === 0) {
    return { insertedCount: 0 }
  }

  const { data: existingItems, error: itemsError } = await context.supabase
    .from('job_google_calendar_items')
    .select('job_id')
    .eq('user_id', userId)

  if (itemsError) {
    throw new Error(
      `Nepodařilo se načíst položky Google kalendáře pro backfill: ${itemsError.message}`
    )
  }

  const existingJobIds = new Set(
    (existingItems ?? []).map((item) => String(item.job_id ?? '').trim())
  )
  const missingCount = assignedJobIds.filter(
    (jobId) => !existingJobIds.has(jobId)
  ).length

  const { data: jobs, error: jobsError } = await context.supabase
    .from('jobs')
    .select(
      `
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
        evidence_status
      `
    )
    .in('id', assignedJobIds)
    .order('start_at', { ascending: true })

  if (jobsError) {
    throw new Error(
      `Nepodařilo se načíst zakázky pro backfill Google kalendáře: ${jobsError.message}`
    )
  }

  for (const job of (jobs ?? []) as JobCalendarJobRow[]) {
    await syncJobGoogleCalendarItemWithContext({
      context,
      jobId: job.id,
      job,
    })
  }

  return { insertedCount: missingCount }
}

export async function createJobGoogleCalendarOAuthUrl(params: {
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

export async function completeJobGoogleCalendarOAuth(params: {
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
    .from('job_google_calendar_integrations')
    .select(
      'user_id, google_sub, google_email, refresh_token, calendar_id, calendar_name, enabled, disabled_at, connected_at, created_at, updated_at'
    )
    .eq('user_id', params.userId)
    .maybeSingle<JobGoogleCalendarIntegrationRow>()

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
    const response = await fetchGoogle(
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
    .from('job_google_calendar_integrations')
    .upsert({
      user_id: params.userId,
      google_sub: existingIntegration?.google_sub ?? null,
      google_email: existingIntegration?.google_email ?? null,
      refresh_token: refreshToken,
      calendar_id: calendarId,
      calendar_name: JOB_GOOGLE_CALENDAR_NAME,
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

  const backfillResult = await backfillJobGoogleCalendarItemsForUser(params.userId)

  return {
    insertedCount: backfillResult.insertedCount,
    calendarId,
  }
}

export async function disconnectJobGoogleCalendar(userId: string) {
  const supabase = getServiceClient()

  const { data: integration, error } = await supabase
    .from('job_google_calendar_integrations')
    .select(
      'user_id, google_sub, google_email, refresh_token, calendar_id, calendar_name, enabled, disabled_at, connected_at, created_at, updated_at'
    )
    .eq('user_id', userId)
    .maybeSingle<JobGoogleCalendarIntegrationRow>()

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
    .from('job_google_calendar_items')
    .delete()
    .eq('user_id', userId)

  if (itemsError) {
    throw new Error(
      `Nepodařilo se odstranit položky Google kalendáře: ${itemsError.message}`
    )
  }

  const { error: deleteError } = await supabase
    .from('job_google_calendar_integrations')
    .delete()
    .eq('user_id', userId)

  if (deleteError) {
    throw new Error(
      `Nepodařilo se odstranit Google kalendář zakázek: ${deleteError.message}`
    )
  }

  return {
    disconnected: true,
    deletedCalendar,
    disconnectedAt: now,
  }
}
