import { getServiceRoleClient } from '@/lib/supabase/service'
import {
  DISPATCHER_CALENDAR_NAMES,
  isDispatcherCalendarSalesOwner,
  type DispatcherCalendarSalesOwner,
  type DispatcherCalendarScope,
} from './dispatcher-calendar-scope'

export const DISPATCHER_JOB_CALENDAR_NAME = DISPATCHER_CALENDAR_NAMES.all_jobs
export const DISPATCHER_JOB_CALENDAR_TIME_ZONE = 'Europe/Prague'
const DISPATCHER_JOB_CALENDAR_ALARM_MINUTES = 120
const DISPATCHER_JOB_CALENDAR_UID_PREFIX = 'b-energy-vsechny-zakazky'

type DispatcherCalendarFeedRow = {
  user_id: string
  token: string
  enabled: boolean
  calendar_scope: DispatcherCalendarScope
  disabled_at: string | null
}

type DispatcherCalendarItemRow = {
  job_id: string
  user_id: string
  uid: string
  sequence: number
  is_cancelled: boolean
  cancelled_at: string | null
}

export type DispatcherCalendarJobRow = {
  id: string
  job_number: string
  company_name: string
  contact_person: string | null
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  technician_name: string | null
  generator_name: string | null
  info_note: string | null
  job_status: 'nova' | 'k_reseni' | 'realizace' | 'ukoncena' | 'storno'
  invoice_status: 'bez_faktury' | 'k_fakturaci' | 'vyfakturovano'
  evidence_status: 'nove' | 'zapsano'
  marny_vyjezd: boolean | null
  pohotovost: boolean | null
  sales_owner: string | null
}

type DispatcherCalendarEvent = {
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
    throw new Error('Chybí Supabase service role client pro dispečerský kalendář.')
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

  if (line.length <= maxLength) return line

  const chunks: string[] = []
  for (let index = 0; index < line.length; index += maxLength) {
    const chunk = line.slice(index, index + maxLength)
    chunks.push(index === 0 ? chunk : ` ${chunk}`)
  }

  return chunks.join('\r\n')
}

function serializeIcs(lines: string[]) {
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`
}

function chunkValues<T>(values: T[], size: number) {
  const chunks: T[][] = []

  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }

  return chunks
}

function formatUtcIsoForIcs(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new Error('Zakázka má neplatné datum pro dispečerský kalendář.')
  }

  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(
    date.getUTCDate()
  )}T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(
    date.getUTCSeconds()
  )}Z`
}

function formatPragueDateTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: DISPATCHER_JOB_CALENDAR_TIME_ZONE,
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
  return {
    nove: 'Zapsat',
    zapsano: 'Zapsáno',
  }[status]
}

function buildSummary(job: DispatcherCalendarJobRow, scope: DispatcherCalendarScope) {
  const jobNumber = job.job_number.trim()
  const companyName = job.company_name.trim()
  const baseSummary =
    jobNumber && companyName
      ? `${jobNumber} · ${companyName}`
      : jobNumber
        ? `Zakázka ${jobNumber}`
        : companyName || 'Zakázka'
  const onCallSummary = job.pohotovost ? `${baseSummary} · POHOTOVOST` : baseSummary
  const summary =
    scope === 'sales_owner' && job.marny_vyjezd
      ? `MARNÝ VÝJEZD · ${onCallSummary}`
      : onCallSummary

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
    job.marny_vyjezd ? 'Marný výjezd: Ano' : null,
    job.info_note?.trim() ? `Info poznámka: ${job.info_note.trim()}` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
}

function buildEventUid(userId: string, jobId: string) {
  return `${DISPATCHER_JOB_CALENDAR_UID_PREFIX}:${userId}:${jobId}`
}

function buildCalendarEvent(
  job: DispatcherCalendarJobRow,
  item: DispatcherCalendarItemRow,
  scope: DispatcherCalendarScope
): DispatcherCalendarEvent | null {
  if (!job.start_at || !job.end_at || (scope === 'all_jobs' && job.marny_vyjezd)) {
    return null
  }

  return {
    uid: item.uid,
    sequence: item.sequence,
    summary: buildSummary(job, scope),
    description: buildDescription(job),
    location: job.site_address?.trim() || null,
    startIso: job.start_at,
    endIso: job.end_at,
    isCancelled: item.is_cancelled,
  }
}

function buildCancelledEvent(item: DispatcherCalendarItemRow) {
  const now = new Date().toISOString()

  return {
    uid: item.uid,
    sequence: item.sequence,
    summary: 'Zakázka byla odebrána',
    description: 'Tato zakázka byla odebrána z dispečerského kalendáře.',
    location: null,
    startIso: now,
    endIso: now,
    isCancelled: true,
  } satisfies DispatcherCalendarEvent
}

function serializeEvent(event: DispatcherCalendarEvent) {
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
  ]

  if (event.location) lines.push(`LOCATION:${escapeIcsText(event.location)}`)

  if (event.isCancelled) {
    lines.push('STATUS:CANCELLED')
  } else {
    lines.push(
      'BEGIN:VALARM',
      `TRIGGER:-PT${DISPATCHER_JOB_CALENDAR_ALARM_MINUTES}M`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText('B-ENERGY připomínka zakázky')}`,
      'END:VALARM'
    )
  }

  lines.push('END:VEVENT')
  return lines
}

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
  marny_vyjezd,
  pohotovost,
  sales_owner
`

export async function ensureDispatcherJobCalendarFeed(
  userId: string,
  calendarScope: DispatcherCalendarScope = 'all_jobs'
) {
  const supabase = getServiceClient()
  const { data: existingFeed, error: readError } = await supabase
    .from('dispatcher_job_calendar_feeds')
    .select('user_id, token, enabled, calendar_scope, disabled_at')
    .eq('user_id', userId)
    .maybeSingle<DispatcherCalendarFeedRow>()

  if (readError) {
    throw new Error(`Nepodařilo se načíst dispečerský kalendář: ${readError.message}`)
  }

  if (existingFeed) {
    if (
      !existingFeed.enabled ||
      existingFeed.disabled_at ||
      existingFeed.calendar_scope !== calendarScope
    ) {
      const { error } = await supabase
        .from('dispatcher_job_calendar_feeds')
        .update({ enabled: true, disabled_at: null, calendar_scope: calendarScope })
        .eq('user_id', userId)

      if (error) {
        throw new Error(`Nepodařilo se obnovit dispečerský kalendář: ${error.message}`)
      }
    }

    return {
      ...existingFeed,
      enabled: true,
      disabled_at: null,
      calendar_scope: calendarScope,
    }
  }

  const token = globalThis.crypto.randomUUID().replaceAll('-', '')
  const { data, error } = await supabase
    .from('dispatcher_job_calendar_feeds')
    .insert({
      user_id: userId,
      token,
      enabled: true,
      calendar_scope: calendarScope,
      disabled_at: null,
    })
    .select('user_id, token, enabled, calendar_scope, disabled_at')
    .single<DispatcherCalendarFeedRow>()

  if (error || !data) {
    throw new Error(`Nepodařilo se vytvořit dispečerský kalendář: ${error?.message ?? 'Neznámá chyba'}`)
  }

  return data
}

export async function syncDispatcherJobCalendarItem(params: {
  jobId: string
  userId: string
  job: DispatcherCalendarJobRow
  calendarScope?: DispatcherCalendarScope
}) {
  const calendarScope = params.calendarScope ?? 'all_jobs'
  if (calendarScope === 'all_jobs' && params.job.marny_vyjezd) {
    return cancelDispatcherJobCalendarItem(params)
  }

  const supabase = getServiceClient()
  const { data: existingItem, error: itemError } = await supabase
    .from('dispatcher_job_calendar_items')
    .select('job_id, user_id, uid, sequence, is_cancelled, cancelled_at')
    .eq('job_id', params.jobId)
    .eq('user_id', params.userId)
    .maybeSingle<DispatcherCalendarItemRow>()

  if (itemError) {
    throw new Error(`Nepodařilo se načíst položku dispečerského kalendáře: ${itemError.message}`)
  }

  const item = {
    job_id: params.jobId,
    user_id: params.userId,
    uid: existingItem?.uid ?? buildEventUid(params.userId, params.jobId),
    sequence: (existingItem?.sequence ?? 0) + 1,
    is_cancelled: false,
    cancelled_at: null,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('dispatcher_job_calendar_items').upsert(item)

  if (error) {
    throw new Error(`Nepodařilo se synchronizovat dispečerský kalendář: ${error.message}`)
  }

  return buildCalendarEvent(params.job, item, calendarScope)
}

export async function cancelDispatcherJobCalendarItem(params: {
  jobId: string
  userId: string
}) {
  const supabase = getServiceClient()
  const { data: existingItem, error: itemError } = await supabase
    .from('dispatcher_job_calendar_items')
    .select('job_id, user_id, uid, sequence, is_cancelled, cancelled_at')
    .eq('job_id', params.jobId)
    .eq('user_id', params.userId)
    .maybeSingle<DispatcherCalendarItemRow>()

  if (itemError) {
    throw new Error(`Nepodařilo se načíst položku dispečerského kalendáře: ${itemError.message}`)
  }

  if (!existingItem) return

  const { error } = await supabase
    .from('dispatcher_job_calendar_items')
    .update({
      sequence: existingItem.sequence + 1,
      is_cancelled: true,
      cancelled_at: new Date().toISOString(),
    })
    .eq('job_id', params.jobId)
    .eq('user_id', params.userId)

  if (error) {
    throw new Error(`Nepodařilo se zrušit položku dispečerského kalendáře: ${error.message}`)
  }
}

export async function backfillDispatcherJobCalendarItemsForUser(
  userId: string,
  calendarScope: DispatcherCalendarScope = 'all_jobs',
  salesOwner: DispatcherCalendarSalesOwner | null = null
) {
  const supabase = getServiceClient()
  await ensureDispatcherJobCalendarFeed(userId, calendarScope)

  if (calendarScope === 'sales_owner' && !salesOwner) {
    throw new Error('Uživatel nemá nastavený rozsah zakázek pro portálový kalendář.')
  }

  let jobsQuery = supabase
    .from('jobs')
    .select(JOB_SELECT)
    .order('start_at', { ascending: true })

  jobsQuery =
    calendarScope === 'sales_owner'
      ? jobsQuery.eq('sales_owner', salesOwner)
      : jobsQuery.or('marny_vyjezd.is.null,marny_vyjezd.eq.false')

  const [jobsResponse, itemsResponse] = await Promise.all([
    jobsQuery,
    supabase
      .from('dispatcher_job_calendar_items')
      .select('job_id, user_id, uid, sequence, is_cancelled, cancelled_at')
      .eq('user_id', userId),
  ])

  if (jobsResponse.error) {
    throw new Error(`Nepodařilo se načíst zakázky pro kalendář: ${jobsResponse.error.message}`)
  }
  if (itemsResponse.error) {
    throw new Error(`Nepodařilo se načíst položky kalendáře: ${itemsResponse.error.message}`)
  }

  const jobs = (jobsResponse.data ?? []) as DispatcherCalendarJobRow[]
  const desiredJobIds = new Set(jobs.map((job) => job.id))
  const existingItems = (itemsResponse.data ?? []) as DispatcherCalendarItemRow[]
  const existingByJobId = new Map(existingItems.map((item) => [item.job_id, item]))
  const missingJobs = jobs.filter((job) => !existingByJobId.has(job.id))
  const now = new Date().toISOString()
  const rowsToUpsert = jobs
    .filter((job) => !existingByJobId.has(job.id) || existingByJobId.get(job.id)?.is_cancelled)
    .map((job) => {
      const existing = existingByJobId.get(job.id)
      return {
        job_id: job.id,
        user_id: userId,
        uid: existing?.uid ?? buildEventUid(userId, job.id),
        sequence: (existing?.sequence ?? 0) + 1,
        is_cancelled: false,
        cancelled_at: null,
        updated_at: now,
      }
    })
  const staleRows = existingItems
    .filter((item) => !item.is_cancelled && !desiredJobIds.has(item.job_id))
    .map((item) => ({
      ...item,
      sequence: item.sequence + 1,
      is_cancelled: true,
      cancelled_at: now,
      updated_at: now,
    }))

  const rows = [...rowsToUpsert, ...staleRows]
  if (rows.length === 0) return { insertedCount: 0 }

  const { error } = await supabase
    .from('dispatcher_job_calendar_items')
    .upsert(rows)

  if (error) {
    throw new Error(`Nepodařilo se doplnit zakázky do kalendáře: ${error.message}`)
  }

  return { insertedCount: missingJobs.length }
}

export async function getDispatcherJobCalendarFeedByToken(token: string) {
  const supabase = getServiceClient()
  const { data: feed, error: feedError } = await supabase
    .from('dispatcher_job_calendar_feeds')
    .select('user_id, token, enabled, calendar_scope, disabled_at')
    .eq('token', token)
    .maybeSingle<DispatcherCalendarFeedRow>()

  if (feedError) {
    throw new Error(`Nepodařilo se načíst dispečerský feed: ${feedError.message}`)
  }
  if (!feed || !feed.enabled || feed.disabled_at) return null

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, can_view_jobs, can_view_jobs_portal, jobs_sales_scope')
    .eq('id', feed.user_id)
    .maybeSingle<{
      role: string | null
      can_view_jobs: boolean | null
      can_view_jobs_portal: boolean | null
      jobs_sales_scope: string | null
    }>()

  if (profileError) {
    throw new Error(`Nepodařilo se ověřit rozsah kalendáře: ${profileError.message}`)
  }

  const salesOwner = isDispatcherCalendarSalesOwner(profile?.jobs_sales_scope)
    ? profile.jobs_sales_scope
    : null
  const hasScopeAccess =
    feed.calendar_scope === 'all_jobs'
      ? profile?.role === 'admin' || profile?.can_view_jobs === true
      : profile?.role !== 'admin' &&
        profile?.can_view_jobs_portal === true &&
        salesOwner !== null

  if (!hasScopeAccess) return null

  const { data: items, error: itemsError } = await supabase
    .from('dispatcher_job_calendar_items')
    .select('job_id, user_id, uid, sequence, is_cancelled, cancelled_at')
    .eq('user_id', feed.user_id)

  if (itemsError) {
    throw new Error(`Nepodařilo se načíst položky dispečerského feedu: ${itemsError.message}`)
  }

  const typedItems = (items ?? []) as DispatcherCalendarItemRow[]
  const activeItems = typedItems.filter((item) => !item.is_cancelled)
  const activeJobIds = activeItems.map((item) => item.job_id)
  const jobsResponses = await Promise.all(
    chunkValues(activeJobIds, 75).map((jobIds) => {
      let query = supabase
        .from('jobs')
        .select(JOB_SELECT)
        .in('id', jobIds)
      query =
        feed.calendar_scope === 'sales_owner'
          ? query.eq('sales_owner', salesOwner)
          : query.or('marny_vyjezd.is.null,marny_vyjezd.eq.false')
      return query
    })
  )
  const jobsError = jobsResponses.find((response) => response.error)?.error

  if (jobsError) {
    throw new Error(`Nepodařilo se načíst zakázky dispečerského feedu: ${jobsError.message}`)
  }

  const jobRows = jobsResponses.flatMap((response) => response.data ?? [])

  const jobById = new Map(
    (jobRows as DispatcherCalendarJobRow[]).map((job) => [job.id, job])
  )
  const activeEvents = activeItems
    .map((item) => {
      const job = jobById.get(item.job_id)
      return job ? buildCalendarEvent(job, item, feed.calendar_scope) : null
    })
    .filter((event): event is DispatcherCalendarEvent => Boolean(event))
  const cancelledEvents = typedItems
    .filter((item) => item.is_cancelled)
    .map(buildCancelledEvent)
  const events = [...activeEvents, ...cancelledEvents].sort(
    (a, b) => new Date(a.startIso).getTime() - new Date(b.startIso).getTime()
  )

  return {
    feed,
    ics: serializeIcs([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//B-ENERGY//Dispatcher Job Calendar Feed//CS',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${escapeIcsText(DISPATCHER_CALENDAR_NAMES[feed.calendar_scope])}`,
      `X-WR-TIMEZONE:${DISPATCHER_JOB_CALENDAR_TIME_ZONE}`,
      'X-PUBLISHED-TTL:PT15M',
      ...events.flatMap(serializeEvent),
      'END:VCALENDAR',
    ]),
  }
}
