import { getServiceRoleClient } from '@/lib/supabase/service'

export const JOB_CALENDAR_NAME = 'B-ENERGY ZAKÁZKY TECHNIKA'
export const JOB_CALENDAR_TIME_ZONE = 'Europe/Prague'
const JOB_CALENDAR_ALARM_MINUTES = 120
const JOB_CALENDAR_UID_PREFIX = 'b-energy-zakazky-technika'

type JobCalendarFeedRow = {
  user_id: string
  token: string
  enabled: boolean
  disabled_at: string | null
}

type JobCalendarItemRow = {
  job_id: string
  user_id: string
  uid: string
  sequence: number
  is_cancelled: boolean
  cancelled_at: string | null
}

export type JobCalendarJobRow = {
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
}

type JobCalendarEvent = {
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
    throw new Error('Chybí Supabase service role client pro kalendář zakázek.')
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
    throw new Error('Zakázka má neplatné datum pro kalendář.')
  }

  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
  ].join('') + `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(
    date.getUTCSeconds()
  )}Z`
}

function formatPragueDateTime(value: string | null) {
  if (!value) return '—'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
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

function buildDescription(job: JobCalendarJobRow) {
  const lines = [
    `Číslo zakázky: ${job.job_number.trim()}`,
    `Firma: ${job.company_name.trim()}`,
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
    `Stav zakázky: ${getJobStatusLabel(job.job_status)}`,
    `Fakturace: ${getInvoiceStatusLabel(job.invoice_status)}`,
    `Evidence: ${getEvidenceStatusLabel(job.evidence_status)}`,
    job.info_note?.trim() ? `Info poznámka: ${job.info_note.trim()}` : null,
  ].filter((line): line is string => Boolean(line))

  return lines.join('\n')
}

function buildEventUid(userId: string, jobId: string) {
  return `${JOB_CALENDAR_UID_PREFIX}:${userId}:${jobId}`
}

function buildCalendarEvent(
  job: JobCalendarJobRow,
  item?: JobCalendarItemRow
): JobCalendarEvent | null {
  if (!job.start_at || !job.end_at) {
    return null
  }

  return {
    uid: item?.uid ?? buildEventUid(item?.user_id ?? 'unknown', job.id),
    sequence: item?.sequence ?? 1,
    summary: buildSummary(job),
    description: buildDescription(job),
    location: job.site_address?.trim() || null,
    startIso: job.start_at,
    endIso: job.end_at,
    isCancelled: item?.is_cancelled ?? false,
  }
}

function buildCancelledEvent(item: JobCalendarItemRow) {
  return {
    uid: item.uid,
    sequence: item.sequence,
    summary: 'Zakázka byla odebrána',
    description: 'Tato zakázka byla odebrána z kalendáře zakázek technika.',
    location: null,
    startIso: new Date().toISOString(),
    endIso: new Date().toISOString(),
    isCancelled: true,
  } satisfies JobCalendarEvent
}

function serializeEvent(event: JobCalendarEvent) {
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
    'X-MICROSOFT-CDO-ALLDAYEVENT:FALSE',
  ]

  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`)
  }

  if (event.isCancelled) {
    lines.push('STATUS:CANCELLED')
  } else {
    lines.push(
      'BEGIN:VALARM',
      `TRIGGER:-PT${JOB_CALENDAR_ALARM_MINUTES}M`,
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcsText('B-ENERGY připomínka zakázky')}`,
      'END:VALARM'
    )
  }

  lines.push('END:VEVENT')

  return lines
}

async function getFeedClientData(token: string) {
  const supabase = getServiceClient()

  const { data: feed, error: feedError } = await supabase
    .from('job_calendar_feeds')
    .select('user_id, token, enabled, disabled_at')
    .eq('token', token)
    .maybeSingle<JobCalendarFeedRow>()

  if (feedError) {
    throw new Error(`Nepodařilo se načíst kalendářový feed: ${feedError.message}`)
  }

  if (!feed || !feed.enabled || feed.disabled_at) {
    return null
  }

  return { supabase, feed }
}

export async function ensureJobCalendarFeed(userId: string) {
  const supabase = getServiceClient()

  const { data: existingFeed, error: existingError } = await supabase
    .from('job_calendar_feeds')
    .select('user_id, token, enabled, disabled_at')
    .eq('user_id', userId)
    .maybeSingle<JobCalendarFeedRow>()

  if (existingError) {
    throw new Error(
      `Nepodařilo se načíst kalendářový feed: ${existingError.message}`
    )
  }

  if (existingFeed) {
    return existingFeed
  }

  const token = globalThis.crypto.randomUUID().replaceAll('-', '')

  const { error: insertError } = await supabase.from('job_calendar_feeds').insert({
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
    .from('job_calendar_feeds')
    .select('user_id, token, enabled, disabled_at')
    .eq('user_id', userId)
    .maybeSingle<JobCalendarFeedRow>()

  if (readError || !data) {
    throw new Error(
      `Nepodařilo se načíst kalendářový feed: ${readError?.message ?? 'Neznámá chyba'}`
    )
  }

  return data
}

async function getAssignedJobIdsForUser(userId: string) {
  const supabase = getServiceClient()

  const { data, error } = await supabase
    .from('job_technicians')
    .select('job_id')
    .eq('technician_id', userId)

  if (error) {
    throw new Error(
      `Nepodařilo se načíst přiřazené zakázky: ${error.message}`
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

export async function syncJobCalendarItem(params: {
  jobId: string
  userId: string
  job: JobCalendarJobRow
}) {
  const supabase = getServiceClient()
  const { jobId, userId, job } = params

  await ensureJobCalendarFeed(userId)

  const { data: existingItem, error: itemError } = await supabase
    .from('job_calendar_items')
    .select('job_id, user_id, uid, sequence, is_cancelled, cancelled_at')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .maybeSingle<JobCalendarItemRow>()

  if (itemError) {
    throw new Error(
      `Nepodařilo se načíst kalendářovou položku: ${itemError.message}`
    )
  }

  const nextSequence = (existingItem?.sequence ?? 0) + 1
  const nextUid = existingItem?.uid ?? buildEventUid(userId, jobId)

  const { error } = await supabase.from('job_calendar_items').upsert({
    job_id: jobId,
    user_id: userId,
    uid: nextUid,
    sequence: nextSequence,
    is_cancelled: false,
    cancelled_at: null,
    updated_at: new Date().toISOString(),
  })

  if (error) {
    throw new Error(
      `Nepodařilo se synchronizovat zakázku do kalendáře: ${error.message}`
    )
  }

  return buildCalendarEvent(job, {
    job_id: jobId,
    user_id: userId,
    uid: nextUid,
    sequence: nextSequence,
    is_cancelled: false,
    cancelled_at: null,
  })
}

export async function cancelJobCalendarItem(params: {
  jobId: string
  userId: string
}) {
  const supabase = getServiceClient()
  const { jobId, userId } = params

  await ensureJobCalendarFeed(userId)

  const { data: existingItem, error: itemError } = await supabase
    .from('job_calendar_items')
    .select('job_id, user_id, uid, sequence, is_cancelled, cancelled_at')
    .eq('job_id', jobId)
    .eq('user_id', userId)
    .maybeSingle<JobCalendarItemRow>()

  if (itemError) {
    throw new Error(
      `Nepodařilo se načíst kalendářovou položku: ${itemError.message}`
    )
  }

  const nextSequence = (existingItem?.sequence ?? 0) + 1
  const nextUid = existingItem?.uid ?? buildEventUid(userId, jobId)

  const { error } = await supabase.from('job_calendar_items').upsert({
    job_id: jobId,
    user_id: userId,
    uid: nextUid,
    sequence: nextSequence,
    is_cancelled: true,
    cancelled_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })

  if (error) {
    throw new Error(
      `Nepodařilo se zrušit zakázku v kalendáři: ${error.message}`
    )
  }
}

export async function getJobCalendarFeedByToken(token: string) {
  const feedResult = await getFeedClientData(token)

  if (!feedResult) {
    return null
  }

  const { supabase, feed } = feedResult

  const [itemsResponse, jobsResponse] = await Promise.all([
    supabase
      .from('job_calendar_items')
      .select('job_id, user_id, uid, sequence, is_cancelled, cancelled_at')
      .eq('user_id', feed.user_id),
    supabase
      .from('job_technicians')
      .select('job_id')
      .eq('technician_id', feed.user_id),
  ])

  const { data: items, error: itemsError } = itemsResponse
  const { data: assignedJobs, error: jobsError } = jobsResponse

  if (itemsError) {
    throw new Error(
      `Nepodařilo se načíst položky kalendáře: ${itemsError.message}`
    )
  }

  if (jobsError) {
    throw new Error(
      `Nepodařilo se načíst zakázky pro kalendář: ${jobsError.message}`
    )
  }

  const jobIds = Array.from(
    new Set((items ?? []).map((item) => String(item.job_id ?? '').trim()).filter(Boolean))
  )

  const assignedJobIds = new Set(
    (assignedJobs ?? [])
      .map((row) => String(row.job_id ?? '').trim())
      .filter((jobId) => Boolean(jobId))
  )

  const visibleJobIds = jobIds.filter((jobId) => assignedJobIds.has(jobId))

  const jobs = visibleJobIds.length
    ? await supabase
        .from('jobs')
        .select(`
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
        `)
        .in('id', visibleJobIds)
        .order('start_at', { ascending: true })
    : { data: [], error: null }

  const { data: jobRows, error: jobRowsError } = jobs

  if (jobRowsError) {
    throw new Error(
      `Nepodařilo se načíst zakázky pro kalendář: ${jobRowsError.message}`
    )
  }

  const jobById = new Map(
    (jobRows ?? []).map((job) => [job.id, job as JobCalendarJobRow])
  )

  const itemByJobId = new Map(
    (items ?? []).map((item) => [item.job_id, item as JobCalendarItemRow])
  )

  const activeEvents = Array.from(visibleJobIds)
    .map((jobId) => {
      const job = jobById.get(jobId)
      const item = itemByJobId.get(jobId)

      if (!job || item?.is_cancelled) {
        return null
      }

      return buildCalendarEvent(job, item)
    })
    .filter((event): event is JobCalendarEvent => Boolean(event))

  const cancelledEvents = (items ?? [])
    .filter((item) => item.is_cancelled && assignedJobIds.has(item.job_id))
    .map((item) => buildCancelledEvent(item as JobCalendarItemRow))

  const events = [...activeEvents, ...cancelledEvents].sort((a, b) => {
    return new Date(a.startIso).getTime() - new Date(b.startIso).getTime()
  })

  const ics = serializeIcs([
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//B-ENERGY//Job Calendar Feed//CS',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(JOB_CALENDAR_NAME)}`,
    `X-WR-TIMEZONE:${JOB_CALENDAR_TIME_ZONE}`,
    'X-PUBLISHED-TTL:PT15M',
    ...events.flatMap((event) => serializeEvent(event)),
    'END:VCALENDAR',
  ])

  return {
    ics,
    feed,
  }
}

export async function backfillJobCalendarItemsForUser(userId: string) {
  const supabase = getServiceClient()

  await ensureJobCalendarFeed(userId)

  const assignedJobIds = await getAssignedJobIdsForUser(userId)

  if (assignedJobIds.length === 0) {
    return { insertedCount: 0 }
  }

  const [jobsResponse, itemsResponse] = await Promise.all([
    supabase
      .from('jobs')
      .select(`
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
      `)
      .in('id', assignedJobIds)
      .order('start_at', { ascending: true }),
    supabase
      .from('job_calendar_items')
      .select('job_id')
      .eq('user_id', userId),
  ])

  const { data: jobs, error: jobsError } = jobsResponse
  const { data: existingItems, error: itemsError } = itemsResponse

  if (jobsError) {
    throw new Error(
      `Nepodařilo se načíst zakázky pro backfill kalendáře: ${jobsError.message}`
    )
  }

  if (itemsError) {
    throw new Error(
      `Nepodařilo se načíst položky kalendáře pro backfill: ${itemsError.message}`
    )
  }

  const existingJobIds = new Set(
    (existingItems ?? []).map((item) => item.job_id)
  )

  const missingJobs = (jobs ?? []).filter(
    (job) => !existingJobIds.has(job.id)
  )

  if (missingJobs.length === 0) {
    return { insertedCount: 0 }
  }

  const rowsToInsert = missingJobs.map((job) => ({
    job_id: job.id,
    user_id: userId,
    uid: buildEventUid(userId, job.id),
    sequence: 1,
    is_cancelled: false,
    cancelled_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }))

  const { error } = await supabase.from('job_calendar_items').insert(rowsToInsert)

  if (error) {
    throw new Error(
      `Nepodařilo se provést backfill kalendáře: ${error.message}`
    )
  }

  return { insertedCount: rowsToInsert.length }
}
