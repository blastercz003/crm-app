'use server'

import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { createNotification } from '@/lib/notifications/createNotification'
import { reportActionError } from '@/lib/errors/reportActionError'
import { logUserActivity } from '@/lib/activity-log/logUserActivity'
import {
  areChangeValuesEqual,
  upsertJobChangeQueueEntry,
  type ChangedValues,
} from '@/lib/jobs/changes-queue'
import {
  joinTechnicianNames,
  resolveTechnicianNames,
} from '@/lib/jobs/technicians'
import { setJobPpRequired } from '@/lib/jobs/pp-requirements'
import { createClient } from '@/lib/supabase/server'
import { getServiceRoleClient } from '@/lib/supabase/service'
import {
  getPersistedJobInfoAlert,
  parseJobInfoAlertValue,
} from './info-note-shared'
import {
  cancelJobCalendarItem,
  backfillJobCalendarItemsForUser,
  ensureJobCalendarFeed,
  syncJobCalendarItem,
  type JobCalendarJobRow,
} from '@/lib/jobs/calendar-feed'
import {
  cancelJobGoogleCalendarItem,
  disconnectJobGoogleCalendar,
  syncJobGoogleCalendarItem,
} from '@/lib/jobs/google-calendar'
import {
  cancelDispatcherCalendarsForJob,
  syncDispatcherCalendarsForJob,
  syncDispatcherCalendarsForJobId,
} from '@/lib/jobs/dispatcher-calendar-sync'
import type { DispatcherCalendarJobRow } from '@/lib/jobs/dispatcher-calendar-feed'
import { canViewTechJobsSection } from '@/lib/auth/access'

export type CreateJobActionState = {
  success: boolean
  error: string | null
  warning?: string | null
  jobNumber?: string | null
  companyName?: string | null
}

export type UpdateJobActionState = {
  success: boolean
  error: string | null
  warning?: string | null
}

export type JobCalendarActivationActionState = {
  success: boolean
  error: string | null
  token?: string
  feedPath?: string
  insertedCount?: number
}

export type JobGoogleCalendarDisconnectActionState = {
  success: boolean
  error: string | null
  disconnectedAt?: string
  deletedCalendar?: boolean
}

export type UpdateJobInfoActionState = {
  success: boolean
  error: string | null
}

export type UpdateJobInfoAlertActionState = {
  success: boolean
  error: string | null
}

export type UpdateJobStatusActionState = {
  success: boolean
  error: string | null
}

export type UpdateJobInvoiceStatusActionState = {
  success: boolean
  error: string | null
}

export type UpdateJobInlineFieldActionState = {
  success: boolean
  error: string | null
  warning?: string | null
}

export type UpdateJobSalesOwnerActionState = {
  success: boolean
  error: string | null
}

export type UpdateJobEvidenceStatusActionState = {
  success: boolean
  error: string | null
}

export type DeleteJobActionState = {
  success: boolean
  error: string | null
}

export type JobFormSuggestions = {
  clientSuggestions: Array<{ id: string; name: string }>
  clientContacts: Array<{
    id: string
    client_id: string
    name: string
    is_primary: boolean
  }>
  offerSuggestions: Array<{
    id: string
    client_id: string
    offer_number: string
    title: string
    order_reference: string | null
    realization_starts_at: string | null
    realization_ends_at: string | null
    realization_address: string | null
  }>
  technicianSuggestions: string[]
}

export type GetJobFormSuggestionsActionResult =
  | { success: true; data: JobFormSuggestions }
  | { success: false; error: string }

type ProfilePermissionRow = {
  can_view_jobs: boolean | null
  role: string | null
}

type TechJobsSectionProfileRow = {
  role: string | null
  can_view_tech_jobs: boolean | null
}

type JobNotificationProfileRow = {
  id: string
  role: string | null
  receive_job_notifications: boolean | null
}

type TechnicianProfileRow = {
  id: string
  name: string | null
  can_be_assigned_as_technician: boolean | null
}

type CreatedJobNotificationRow = {
  id: string
  job_number: string | null
  company_name: string | null
  sales_owner: string | null
  start_at: string | null
  end_at: string | null
  site_address: string | null
}

type JobPostCreateTaskRow = {
  id: string
  job_id: string
  actor_user_id: string
  technician_ids: string[] | null
  status: 'pending' | 'processing' | 'retry' | 'completed'
  attempts: number
}

type JobAssignmentNotificationRow = {
  job_number: string | null
  start_at: string | null
  end_at: string | null
  site_address: string | null
}

type ClientRow = {
  id: string
  name: string | null
}

type ClientContactRow = {
  id: string
  client_id: string
  name: string | null
}

type OfferForJobRow = {
  id: string
  client_id: string
  offer_type: string | null
  status: string | null
}

type JobQueueSourceRow = {
  id: string
  job_number: string | null
  company_name: string | null
  contact_person: string | null
  sales_owner: string | null
  start_at: string | null
  end_at: string | null
  site_address: string | null
  store_number: string | null
  technician_name: string | null
  generator_name: string | null
  info_note: string | null
  marny_vyjezd: boolean | null
  job_status: string | null
  invoice_status: string | null
  evidence_status: string | null
}

type AssignedTechnicianRow = {
  technician_id: string
}

const SALES_OWNER_VALUES = ['JIŘÍ', 'MICHAL', 'LÍDA'] as const
const JOB_STATUS_VALUES = [
  'nova',
  'k_reseni',
  'realizace',
  'ukoncena',
  'storno',
] as const
const INVOICE_STATUS_VALUES = [
  'bez_faktury',
  'k_fakturaci',
  'vyfakturovano',
] as const
const EVIDENCE_STATUS_VALUES = ['nove', 'zapsano'] as const

const SALES_OWNER_NOTIFICATION_RECIPIENTS: Partial<Record<string, string>> = {
  MICHAL: '46c40df2-04d7-41e9-ad6d-51cc2ee76019',
  LÍDA: '735d158c-667a-42c0-8af0-6ee12a9c1f11',
}

const INLINE_EDITABLE_FIELDS = [
  'company_name',
  'contact_person',
  'start_at',
  'end_at',
  'site_address',
  'store_number',
  'technician_name',
  'generator_name',
] as const

const NON_ADMIN_ALLOWED_INLINE_FIELDS = [
  'technician_name',
  'generator_name',
] as const

type InlineEditableField = (typeof INLINE_EDITABLE_FIELDS)[number]
type TrackedChangeField =
  | 'company_name'
  | 'start_at'
  | 'end_at'
  | 'site_address'
  | 'technician_name'
  | 'generator_name'

const TRACKED_CHANGE_FIELDS = new Set<TrackedChangeField>([
  'company_name',
  'start_at',
  'end_at',
  'site_address',
  'technician_name',
  'generator_name',
])

function getJobFieldActivityLabel(field: InlineEditableField) {
  const map: Record<InlineEditableField, string> = {
    company_name: 'Firma',
    contact_person: 'Kontaktní osoba',
    start_at: 'Začátek',
    end_at: 'Konec',
    site_address: 'Adresa',
    store_number: 'Prodejna',
    technician_name: 'Technik',
    generator_name: 'Agregát',
  }

  return map[field] ?? field
}

function getJobStatusActivityLabel(status: string) {
  const map: Record<string, string> = {
    nova: 'Nová',
    k_reseni: 'V řešení',
    realizace: 'Realizace',
    ukoncena: 'Ukončená',
    storno: 'Storno',
  }
  return map[status] ?? status
}

function getInvoiceStatusActivityLabel(status: string) {
  const map: Record<string, string> = {
    bez_faktury: 'Bez faktury',
    k_fakturaci: 'K fakturaci',
    vyfakturovano: 'Vyfakturováno',
  }
  return map[status] ?? status
}

function getEvidenceStatusActivityLabel(status: string) {
  const map: Record<string, string> = {
    nove: 'Zapsat',
    zapsano: 'Zapsáno',
  }
  return map[status] ?? status
}

function formatPragueDateTimeForLog(value: string | null | undefined) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

async function getJobNumberForLog(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
) {
  const { data } = await supabase
    .from('jobs')
    .select('job_number')
    .eq('id', jobId)
    .maybeSingle()

  return String((data as { job_number?: string | null } | null)?.job_number ?? '').trim()
}

function normalizeText(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

function normalizeCheckbox(value: FormDataEntryValue | null) {
  if (value === null) return false

  const text = String(value).trim().toLowerCase()
  return text !== '' && text !== '0' && text !== 'false'
}

function normalizePpRequired(value: FormDataEntryValue | null) {
  if (value === null) return true
  return normalizeCheckbox(value)
}

function normalizeTechnicianText(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

function normalizeUuid(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()

  if (!text) return null

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  return uuidPattern.test(text) ? text : null
}

function normalizeSalesOwner(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()

  return SALES_OWNER_VALUES.includes(
    text as (typeof SALES_OWNER_VALUES)[number]
  )
    ? text
    : 'JIŘÍ'
}

function normalizeJobStatus(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()

  return JOB_STATUS_VALUES.includes(text as (typeof JOB_STATUS_VALUES)[number])
    ? text
    : 'nova'
}

function normalizeInvoiceStatus(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()

  return INVOICE_STATUS_VALUES.includes(
    text as (typeof INVOICE_STATUS_VALUES)[number]
  )
    ? text
    : 'bez_faktury'
}

function normalizeEvidenceStatus(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()

  return EVIDENCE_STATUS_VALUES.includes(
    text as (typeof EVIDENCE_STATUS_VALUES)[number]
  )
    ? text
    : 'nove'
}

function isInlineEditableField(value: string): value is InlineEditableField {
  return INLINE_EDITABLE_FIELDS.includes(value as InlineEditableField)
}

function canNonAdminEditInlineField(
  field: InlineEditableField
): field is (typeof NON_ADMIN_ALLOWED_INLINE_FIELDS)[number] {
  return NON_ADMIN_ALLOWED_INLINE_FIELDS.includes(
    field as (typeof NON_ADMIN_ALLOWED_INLINE_FIELDS)[number]
  )
}

function parseDateTimeLocalAsPrague(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()

  if (!text) return null

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(text)

  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  const getParts = (date: Date) => {
    const parts = formatter.formatToParts(date)

    return {
      year: Number(parts.find((part) => part.type === 'year')?.value ?? '0'),
      month: Number(parts.find((part) => part.type === 'month')?.value ?? '0'),
      day: Number(parts.find((part) => part.type === 'day')?.value ?? '0'),
      hour: Number(parts.find((part) => part.type === 'hour')?.value ?? '0'),
      minute: Number(parts.find((part) => part.type === 'minute')?.value ?? '0'),
    }
  }

  let utcGuess = Date.UTC(year, month - 1, day, hour, minute)

  for (let index = 0; index < 3; index += 1) {
    const parts = getParts(new Date(utcGuess))

    const desiredAsUtc = Date.UTC(year, month - 1, day, hour, minute)
    const actualAsUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute
    )

    const diff = desiredAsUtc - actualAsUtc

    if (diff === 0) {
      return new Date(utcGuess).toISOString()
    }

    utcGuess += diff
  }

  return new Date(utcGuess).toISOString()
}

async function requireAuthenticatedUser() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      supabase,
      user: null,
      error: 'Nejsi přihlášený.',
    }
  }

  return {
    supabase,
    user,
    error: null,
  }
}

async function requireJobsAccess() {
  const { supabase, user, error } = await requireAuthenticatedUser()

  if (!user) {
    return {
      supabase,
      user: null,
      error,
      isAdmin: false,
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('can_view_jobs, role')
    .eq('id', user.id)
    .single()

  if (profileError) {
    return {
      supabase,
      user: null,
      error: 'Nepodařilo se ověřit oprávnění uživatele.',
      isAdmin: false,
    }
  }

  const typedProfile = profile as ProfilePermissionRow | null
  const isAdmin = typedProfile?.role === 'admin'

  if (!isAdmin && !typedProfile?.can_view_jobs) {
    return {
      supabase,
      user: null,
      error: 'Nemáš oprávnění pro práci se zakázkami.',
      isAdmin: false,
    }
  }

  return {
    supabase,
    user,
    error: null,
    isAdmin,
  }
}

export async function getJobFormSuggestionsAction(
  currentOfferId?: string | null
): Promise<GetJobFormSuggestionsActionResult> {
  const { supabase, user, error } = await requireJobsAccess()

  if (!user) {
    return { success: false, error: error ?? 'Nemáš oprávnění pro práci se zakázkami.' }
  }

  const normalizedCurrentOfferId = String(currentOfferId ?? '').trim()
  const [clientsResponse, contactsResponse, offersResponse, techniciansResponse, currentOfferResponse] =
    await Promise.all([
      supabase.from('clients').select('id, name').order('name', { ascending: true }),
      supabase
        .from('client_contacts')
        .select('id, client_id, name, is_primary')
        .order('is_primary', { ascending: false })
        .order('name', { ascending: true }),
      supabase
        .from('offers')
        .select(
          'id, client_id, offer_number, title, order_reference, realization_starts_at, realization_ends_at, realization_address'
        )
        .eq('offer_type', 'classic')
        .neq('status', 'realizace')
        .order('offer_number', { ascending: false }),
      supabase
        .from('profiles')
        .select('name')
        .eq('can_be_assigned_as_technician', true)
        .order('name', { ascending: true }),
      normalizedCurrentOfferId
        ? supabase
            .from('offers')
            .select(
              'id, client_id, offer_number, title, order_reference, realization_starts_at, realization_ends_at, realization_address'
            )
            .eq('id', normalizedCurrentOfferId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

  const responseError =
    clientsResponse.error ??
    contactsResponse.error ??
    offersResponse.error ??
    techniciansResponse.error ??
    currentOfferResponse.error

  if (responseError) {
    return { success: false, error: 'Nepodařilo se načíst údaje pro formulář zakázky.' }
  }

  return {
    success: true,
    data: {
      clientSuggestions: (clientsResponse.data ?? [])
        .map((item) => ({
          id: String(item.id ?? '').trim(),
          name: String(item.name ?? '').trim(),
        }))
        .filter((item) => item.id && item.name),
      clientContacts: (contactsResponse.data ?? [])
        .map((item) => ({
          id: String(item.id ?? '').trim(),
          client_id: String(item.client_id ?? '').trim(),
          name: String(item.name ?? '').trim(),
          is_primary: Boolean(item.is_primary),
        }))
        .filter((item) => item.id && item.client_id && item.name),
      offerSuggestions: [
        ...(offersResponse.data ?? []),
        ...(currentOfferResponse.data ? [currentOfferResponse.data] : []),
      ]
        .map((item) => ({
          id: String(item.id ?? '').trim(),
          client_id: String(item.client_id ?? '').trim(),
          offer_number: String(item.offer_number ?? '').trim(),
          title: String(item.title ?? '').trim(),
          order_reference: String(item.order_reference ?? '').trim() || null,
          realization_starts_at: item.realization_starts_at ?? null,
          realization_ends_at: item.realization_ends_at ?? null,
          realization_address: item.realization_address ?? null,
        }))
        .filter((item) => item.id && item.client_id && item.offer_number && item.title)
        .filter(
          (item, index, items) =>
            items.findIndex((candidate) => candidate.id === item.id) === index
        ),
      technicianSuggestions: (techniciansResponse.data ?? [])
        .map((item) => String(item.name ?? '').trim())
        .filter(Boolean),
    },
  }
}

async function requireTechJobsSectionAccess() {
  const { supabase, user, error } = await requireAuthenticatedUser()

  if (!user) {
    return {
      supabase,
      user: null,
      error,
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, can_view_tech_jobs')
    .eq('id', user.id)
    .single()

  if (profileError) {
    return {
      supabase,
      user: null,
      error: 'Nepodařilo se ověřit oprávnění uživatele.',
    }
  }

  const typedProfile = profile as TechJobsSectionProfileRow | null

  if (!canViewTechJobsSection(typedProfile?.role ?? null, typedProfile)) {
    return {
      supabase,
      user: null,
      error: 'Nemáš oprávnění pro práci se zakázkami.',
    }
  }

  return {
    supabase,
    user,
    error: null,
  }
}

export async function activateJobCalendarModalAction(
  _prevState: JobCalendarActivationActionState,
  _formData: FormData
): Promise<JobCalendarActivationActionState> {
  void _prevState
  void _formData

  try {
    const { user, error: accessError } = await requireTechJobsSectionAccess()

    if (!user) {
      return {
        success: false,
        error: accessError,
      }
    }

    const backfillResult = await backfillJobCalendarItemsForUser(user.id)
    const feed = await ensureJobCalendarFeed(user.id)

    return {
      success: true,
      error: null,
      token: feed.token,
      feedPath: `/api/job-calendars/${feed.token}`,
      insertedCount: backfillResult.insertedCount,
    }
  } catch (error) {
    await reportActionError({
      error,
      action: 'activateJobCalendarModalAction',
      section: 'jobs',
      errorType: 'JobCalendarActivationError',
    })

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Nepodařilo se aktivovat kalendář.',
    }
  }
}

export async function disconnectJobGoogleCalendarModalAction(
  _prevState: JobGoogleCalendarDisconnectActionState,
  _formData: FormData
): Promise<JobGoogleCalendarDisconnectActionState> {
  void _prevState
  void _formData

  try {
    const { user, error: accessError } = await requireTechJobsSectionAccess()

    if (!user) {
      return {
        success: false,
        error: accessError,
      }
    }

    const result = await disconnectJobGoogleCalendar(user.id)
    revalidatePath('/zakazky-techniku')

    return {
      success: true,
      error: null,
      disconnectedAt: result.disconnectedAt,
      deletedCalendar: result.deletedCalendar,
    }
  } catch (error) {
    await reportActionError({
      error,
      action: 'disconnectJobGoogleCalendarModalAction',
      section: 'jobs',
      errorType: 'JobGoogleCalendarDisconnectError',
    })

    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Nepodařilo se odpojit Google kalendář.',
    }
  }
}

function revalidateAllRelatedPaths() {
  revalidatePath('/jobs')
  revalidatePath('/zakazky-techniku')
  revalidatePath('/jobs-portal')
  revalidatePath('/faktury')
}

async function syncJobClientOrderNumberToFinance(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  jobId: string
  clientOrderNumber: string | null
}) {
  const { supabase, jobId, clientOrderNumber } = params

  const { error } = await supabase
    .from('job_finances')
    .update({
      client_order_number: clientOrderNumber,
    })
    .eq('job_id', jobId)

  if (error) {
    throw new Error('Nepodařilo se synchronizovat objednávku do fakturace.')
  }
}

async function jobHasInfoAttachments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
) {
  const { count, error } = await supabase
    .from('job_info_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', jobId)

  if (error) {
    throw new Error('Nepodařilo se ověřit fotky v info zakázky.')
  }

  return (count ?? 0) > 0
}

async function getJobInfoAlertStatus(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
) {
  const { data, error } = await supabase
    .from('jobs')
    .select('job_status')
    .eq('id', jobId)
    .maybeSingle()

  if (error || !data) {
    throw new Error('Nepodařilo se ověřit stav zakázky.')
  }

  return String((data as { job_status?: string | null }).job_status ?? '').trim()
}

async function getJobQueueSource(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
) {
  const { data, error } = await supabase
    .from('jobs')
    .select(
      'id, job_number, company_name, contact_person, sales_owner, start_at, end_at, site_address, store_number, technician_name, generator_name, info_note, marny_vyjezd, job_status, invoice_status, evidence_status'
    )
    .eq('id', jobId)
    .single()

  if (error || !data) {
    throw new Error('Nepodařilo se načíst zakázku pro frontu změn.')
  }

  return data as JobQueueSourceRow
}

async function removeJobFromChangesQueue(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
) {
  const { error } = await supabase
    .from('job_changes_queue')
    .delete()
    .eq('job_id', jobId)

  if (error) {
    throw new Error('Nepodařilo se odebrat marný výjezd z fronty změn.')
  }
}

function buildChangedValuesSnapshot({
  source,
  fields,
}: {
  source: JobQueueSourceRow
  fields: string[]
}) {
  const values: ChangedValues = {}

  for (const field of fields) {
    switch (field) {
      case 'company_name':
        values[field] = source.company_name
        break
      case 'contact_person':
        values[field] = source.contact_person
        break
      case 'sales_owner':
        values[field] = source.sales_owner
        break
      case 'start_at':
        values[field] = source.start_at
        break
      case 'end_at':
        values[field] = source.end_at
        break
      case 'site_address':
        values[field] = source.site_address
        break
      case 'store_number':
        values[field] = source.store_number
        break
      case 'technician_name':
        values[field] = source.technician_name
        break
      case 'generator_name':
        values[field] = source.generator_name
        break
      case 'info_note':
        values[field] = source.info_note
        break
      case 'job_status':
        values[field] = source.job_status
        break
      case 'invoice_status':
        values[field] = source.invoice_status
        break
      default:
        values[field] = null
        break
    }
  }

  return values
}

async function enqueueNewJobChange({
  supabase,
  jobId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  jobId: string
}) {
  const source = await getJobQueueSource(supabase, jobId)

  if (source.marny_vyjezd) {
    await removeJobFromChangesQueue(supabase, jobId)
    return
  }

  await upsertJobChangeQueueEntry({
    supabase,
    job: {
      id: source.id,
      job_number: source.job_number,
      start_at: source.start_at,
    },
    kind: 'new_job',
    nextFields: [],
  })
}

async function enqueueJobPostCreateTask({
  jobId,
  actorUserId,
  technicianIds,
}: {
  jobId: string
  actorUserId: string
  technicianIds: string[]
}) {
  const supabase = getServiceRoleClient()

  if (!supabase) {
    throw new Error('Chybí service role client pro frontu navazujících akcí zakázky.')
  }

  const { error } = await supabase.from('job_post_create_tasks').upsert(
    {
      job_id: jobId,
      task_type: 'new_job',
      actor_user_id: actorUserId,
      technician_ids: technicianIds,
      status: 'pending',
      attempts: 0,
      available_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      completed_at: null,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'job_id,task_type' }
  )

  if (error) {
    throw new Error(`Nepodařilo se zařadit navazující akce zakázky do fronty: ${error.message}`)
  }
}

async function runJobPostCreateEffects({
  supabase,
  jobId,
  actorUserId,
  technicianIds,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  jobId: string
  actorUserId: string
  technicianIds: string[]
}) {
  const { data, error } = await supabase
    .from('jobs')
    .select('id, job_number, company_name, sales_owner, start_at, end_at, site_address, marny_vyjezd')
    .eq('id', jobId)
    .maybeSingle()

  if (error) {
    throw new Error(`Nepodařilo se načíst novou zakázku pro navazující akce: ${error.message}`)
  }

  if (!data) return

  const job = data as CreatedJobNotificationRow & { marny_vyjezd: boolean | null }

  try {
    await enqueueNewJobChange({ supabase, jobId })
  } catch (queueError) {
    console.error('Nepodařilo se uložit novou zakázku do fronty změn.', queueError)
    await reportActionError({
      error: queueError,
      action: 'createJobAction',
      section: 'jobs',
      errorType: 'CreateJobQueueError',
      userId: actorUserId,
      context: { jobId },
    })
  }

  if (!job.marny_vyjezd) {
    try {
      await notifyUsersAboutCreatedJob({
        supabase,
        actorUserId,
        job,
      })
    } catch (notificationError) {
      console.error('Nepodařilo se vytvořit notifikace k nové zakázce.', notificationError)
      await reportActionError({
        error: notificationError,
        action: 'createJobAction',
        section: 'jobs',
        errorType: 'CreateJobNotificationError',
        userId: actorUserId,
        context: { jobId },
      })
    }

    try {
      await notifyTechniciansAboutJobAssignment({
        supabase,
        actorUserId,
        jobId,
        job,
        technicianIds,
      })
    } catch (notificationError) {
      console.error('Nepodařilo se vytvořit notifikaci o přiřazení technikům.', notificationError)
      await reportActionError({
        error: notificationError,
        action: 'createJobAction',
        section: 'jobs',
        errorType: 'CreateJobTechnicianNotificationError',
        userId: actorUserId,
        context: { jobId },
      })
    }
  }

  try {
    await syncJobCalendarForTechniciansSafely({
      supabase,
      jobId,
      technicianIds,
      action: 'createJobAction',
      errorType: 'CreateJobCalendarSyncError',
      userIdForErrorLog: actorUserId,
    })
  } catch (calendarError) {
    console.error('Nepodařilo se synchronizovat kalendář po vytvoření zakázky.', calendarError)
  }

  try {
    await logUserActivity({
      action: `Vytvořil zakázku ${job.job_number ?? jobId}`,
      section: 'Zakázky',
      route: '/jobs',
      userId: actorUserId,
    }, supabase)
  } catch (activityError) {
    console.error('Nepodařilo se zapsat aktivitu po vytvoření zakázky.', activityError)
  }
}

async function processJobPostCreateTask(task: JobPostCreateTaskRow) {
  const serviceSupabase = getServiceRoleClient()

  if (!serviceSupabase) {
    throw new Error('Chybí service role client pro zpracování fronty zakázky.')
  }

  const supabase = serviceSupabase as unknown as Awaited<ReturnType<typeof createClient>>
  const now = new Date().toISOString()

  const { data: lockedTask, error: lockError } = await serviceSupabase
    .from('job_post_create_tasks')
    .update({
      status: 'processing',
      attempts: task.attempts + 1,
      locked_at: now,
      locked_by: 'app',
      updated_at: now,
    })
    .eq('id', task.id)
    .in('status', ['pending', 'retry'])
    .select('id')
    .maybeSingle()

  if (lockError || !lockedTask) {
    throw new Error(
      lockError
        ? `Nepodařilo se převzít úlohu navazujících akcí zakázky: ${lockError.message}`
        : 'Úlohu navazujících akcí zakázky již zpracovává jiný pracovní proces.'
    )
  }

  try {
    await runJobPostCreateEffects({
      supabase,
      jobId: task.job_id,
      actorUserId: task.actor_user_id,
      technicianIds: task.technician_ids ?? [],
    })

    const { error: completeError } = await serviceSupabase
      .from('job_post_create_tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        locked_at: null,
        locked_by: null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', task.id)

    if (completeError) {
      throw new Error(`Nepodařilo se dokončit úlohu navazujících akcí zakázky: ${completeError.message}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Neznámá chyba při zpracování navazujících akcí zakázky.'
    const retryAt = new Date(Date.now() + 60_000).toISOString()

    await serviceSupabase
      .from('job_post_create_tasks')
      .update({
        status: 'retry',
        available_at: retryAt,
        locked_at: null,
        locked_by: null,
        last_error: message,
        updated_at: new Date().toISOString(),
      })
      .eq('id', task.id)

    throw error
  }
}

export async function runPendingJobPostCreateTasks(limit = 10) {
  const serviceSupabase = getServiceRoleClient()

  if (!serviceSupabase) {
    throw new Error('Chybí service role client pro frontu navazujících akcí zakázek.')
  }

  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 25)
  const staleLockThreshold = new Date(Date.now() - 10 * 60_000).toISOString()
  const { error: releaseStaleTasksError } = await serviceSupabase
    .from('job_post_create_tasks')
    .update({
      status: 'retry',
      available_at: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq('status', 'processing')
    .lt('locked_at', staleLockThreshold)

  if (releaseStaleTasksError) {
    throw new Error(`Nepodařilo se obnovit nedokončené navazující akce zakázek: ${releaseStaleTasksError.message}`)
  }

  const { data, error } = await serviceSupabase
    .from('job_post_create_tasks')
    .select('id, job_id, actor_user_id, technician_ids, status, attempts')
    .in('status', ['pending', 'retry'])
    .lte('available_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(safeLimit)

  if (error) {
    throw new Error(`Nepodařilo se načíst frontu navazujících akcí zakázek: ${error.message}`)
  }

  const tasks = (data ?? []) as JobPostCreateTaskRow[]

  for (const task of tasks) {
    try {
      await processJobPostCreateTask(task)
    } catch (error) {
      console.error('Nepodařilo se zpracovat navazující akce nové zakázky.', error)
      await reportActionError({
        error,
        action: 'runPendingJobPostCreateTasks',
        section: 'jobs',
        errorType: 'JobPostCreateTaskError',
        userId: task.actor_user_id,
        context: { jobId: task.job_id, taskId: task.id },
      })
    }
  }

  return { processed: tasks.length }
}

async function enqueueUpdatedJobChangeIfWritten({
  supabase,
  jobId,
  fields,
  previousValues,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  jobId: string
  fields: string[]
  previousValues?: ChangedValues
}) {
  const trackedFields = fields.filter((field): field is TrackedChangeField =>
    TRACKED_CHANGE_FIELDS.has(field as TrackedChangeField)
  )

  if (trackedFields.length === 0) {
    return
  }

  const source = await getJobQueueSource(supabase, jobId)

  if (source.marny_vyjezd) {
    await removeJobFromChangesQueue(supabase, jobId)
    return
  }

  if (source.evidence_status !== 'zapsano') {
    return
  }

  const nextValues = buildChangedValuesSnapshot({
    source,
    fields: trackedFields,
  })
  const actuallyChangedFields = previousValues
    ? trackedFields.filter(
        (field) =>
          !areChangeValuesEqual(field, previousValues[field], nextValues[field])
      )
    : trackedFields

  if (actuallyChangedFields.length === 0) {
    return
  }

  await upsertJobChangeQueueEntry({
    supabase,
    job: {
      id: source.id,
      job_number: source.job_number,
      start_at: source.start_at,
    },
    kind: 'updated_job',
    nextFields: actuallyChangedFields,
    previousValues,
    nextValues,
  })
}

function formatJobNotificationDate(value: string | null) {
  if (!value) return 'neuvedeno'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'neuvedeno'

  const parts = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const hour = parts.find((part) => part.type === 'hour')?.value ?? ''
  const minute = parts.find((part) => part.type === 'minute')?.value ?? ''

  if (!day || !month || !hour || !minute) return 'neuvedeno'

  return `${day}.${month}. ${hour}:${minute}`
}

function formatJobAssignmentDate(value: string | null) {
  if (!value) return 'neuvedeno'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'neuvedeno'

  const parts = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)

  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''

  const day = getPart('day')
  const month = getPart('month')
  const hour = getPart('hour')
  const minute = getPart('minute')

  return `${day}.${month}. ${hour}:${minute}`
}

function getJobAddressLabel(siteAddress: string | null | undefined) {
  return String(siteAddress ?? '')
    .split(',')
    .at(0)
    ?.trim() || 'bez adresy'
}

async function syncHandoverProtocolPlace(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  siteAddress: string | null
) {
  const { error } = await supabase
    .from('handover_protocols')
    .update({
      handover_place: siteAddress,
    })
    .eq('job_id', jobId)

  if (error) {
    throw new Error(
      `Nepodařilo se synchronizovat místo předání s adresou zakázky: ${error.message}`
    )
  }
}

async function notifyTechniciansAboutJobAssignment({
  supabase,
  actorUserId,
  jobId,
  job,
  technicianIds,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  actorUserId: string
  jobId: string
  job: JobAssignmentNotificationRow
  technicianIds: string[]
}) {
  const recipientIds = Array.from(
    new Set(
      technicianIds
        .map((technicianId) => String(technicianId ?? '').trim())
        .filter((technicianId) => Boolean(technicianId))
    )
  )

  if (recipientIds.length === 0) return 0

  const jobNumber = String(job.job_number ?? '').trim() || jobId
  const addressLabel = getJobAddressLabel(job.site_address)
  const startAt = formatJobAssignmentDate(job.start_at)
  const endAt = formatJobAssignmentDate(job.end_at)
  const message = `Zakázka ${jobNumber} ${addressLabel} v termínu ${startAt} - ${endAt} Ti byla přiřazena.`

  await Promise.all(
    recipientIds.map((recipientUserId) =>
      createNotification({
        supabase,
        recipientUserId,
        actorUserId,
        category: 'jobs',
        type: 'job_assigned',
        title: 'PŘIŘAZENA NOVÁ ZAKÁZKA',
        message,
        entityType: 'job',
        entityId: jobId,
        href: '/zakazky-techniku',
        priority: 'high',
        dedupeKey: `job_assigned:${jobId}:${recipientUserId}`,
      })
    )
  )

  return recipientIds.length
}

async function getJobNotificationRecipientIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  salesOwner: string | null
) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, role, receive_job_notifications')
    .or('role.eq.admin,receive_job_notifications.eq.true')

  if (error) {
    throw new Error(
      `Nepodařilo se načíst příjemce notifikací zakázek: ${error.message}`
    )
  }

  const recipientIds = new Set(
    ((data ?? []) as JobNotificationProfileRow[]).map((profile) => profile.id)
  )
  const salesOwnerRecipientId = salesOwner
    ? SALES_OWNER_NOTIFICATION_RECIPIENTS[salesOwner]
    : null

  if (salesOwnerRecipientId) {
    recipientIds.add(salesOwnerRecipientId)
  }

  return Array.from(recipientIds)
}

async function getTechnicianProfiles(
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, name, can_be_assigned_as_technician')
    .eq('can_be_assigned_as_technician', true)
    .order('name', { ascending: true })

  if (error) {
    throw new Error(
      `Nepodařilo se načíst techniky z databáze: ${error.message}`
    )
  }

  return ((data ?? []) as TechnicianProfileRow[])
    .map((profile) => ({
      id: String(profile.id ?? '').trim(),
      name: profile.name?.trim() ?? '',
      can_be_assigned_as_technician: Boolean(
        profile.can_be_assigned_as_technician
      ),
    }))
    .filter((profile) => Boolean(profile.id) && Boolean(profile.name))
}

async function resolveTechnicianSelection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  formData: FormData
) {
  const rawValue = normalizeTechnicianText(
    formData.get('technician_name') ?? formData.get('value')
  )

  if (!rawValue) {
    return {
      error: null,
      technicianIds: [] as string[],
      technicianNames: [] as string[],
      technicianLabel: null as string | null,
    }
  }

  const profiles = await getTechnicianProfiles(supabase)
  const availableNames = profiles.map((profile) => profile.name)
  const resolution = resolveTechnicianNames(rawValue, availableNames)

  if (resolution.error) {
    return {
      error: resolution.error,
      technicianIds: [] as string[],
      technicianNames: [] as string[],
      technicianLabel: null as string | null,
    }
  }

  const profileByName = new Map(
    profiles.map((profile) => [profile.name, profile] as const)
  )

  const technicianIds = resolution.names
    .map((name) => profileByName.get(name)?.id ?? '')
    .filter((id) => Boolean(id))

  if (technicianIds.length !== resolution.names.length) {
    return {
      error: 'Některého technika se nepodařilo přiřadit podle jména.',
      technicianIds: [] as string[],
      technicianNames: [] as string[],
      technicianLabel: null as string | null,
    }
  }

  return {
    error: null,
    technicianIds,
    technicianNames: resolution.names,
    technicianLabel: joinTechnicianNames(resolution.names),
  }
}

async function syncJobTechnicians(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string,
  technicianIds: string[]
) {
  const { error } = await supabase.rpc('sync_job_technicians_for_job', {
    p_job_id: jobId,
    p_technician_ids: technicianIds,
  })

  if (error) {
    throw new Error(
      `Nepodařilo se uložit přiřazené techniky k zakázce: ${error.message}`
    )
  }
}

async function getAssignedTechnicianIdsForJob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
) {
  const { data, error } = await supabase
    .from('job_technicians')
    .select('technician_id')
    .eq('job_id', jobId)

  if (error) {
    throw new Error(
      `Nepodařilo se načíst přiřazené techniky k zakázce: ${error.message}`
    )
  }

  return Array.from(
    new Set(
      ((data ?? []) as AssignedTechnicianRow[])
        .map((row) => String(row.technician_id ?? '').trim())
        .filter((technicianId) => Boolean(technicianId))
    )
  )
}

async function getJobCalendarSnapshot(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
) {
  const { data, error } = await supabase
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
        evidence_status,
        marny_vyjezd,
        pohotovost
      `
    )
    .eq('id', jobId)
    .single()

  if (error || !data) {
    throw new Error(
      `Nepodařilo se načíst zakázku pro kalendář: ${error?.message ?? 'Neznámá chyba'}`
    )
  }

  return data as JobCalendarJobRow & DispatcherCalendarJobRow
}

async function syncJobCalendarItemSafely(params: {
  jobId: string
  userId: string
  job: JobCalendarJobRow
  action: string
  errorType: string
  userIdForErrorLog?: string | null
}) {
  try {
    await syncJobCalendarItem({
      jobId: params.jobId,
      userId: params.userId,
      job: params.job,
    })
  } catch (error) {
    try {
      await reportActionError({
        error,
        action: params.action,
        section: 'jobs',
        errorType: params.errorType,
        userId: params.userIdForErrorLog ?? params.userId,
      })
    } catch (reportError) {
      console.error('Kalendářová synchronizace zakázky selhala.', reportError)
    }
  }
}

async function cancelJobCalendarItemSafely(params: {
  jobId: string
  userId: string
  action: string
  errorType: string
  userIdForErrorLog?: string | null
}) {
  try {
    await cancelJobCalendarItem({
      jobId: params.jobId,
      userId: params.userId,
    })
  } catch (error) {
    try {
      await reportActionError({
        error,
        action: params.action,
        section: 'jobs',
        errorType: params.errorType,
        userId: params.userIdForErrorLog ?? params.userId,
      })
    } catch (reportError) {
      console.error('Kalendářové zrušení zakázky selhalo.', reportError)
    }
  }
}

async function syncJobGoogleCalendarItemSafely(params: {
  jobId: string
  userId: string
  job: JobCalendarJobRow
  action: string
  errorType: string
  userIdForErrorLog?: string | null
}) {
  try {
    await syncJobGoogleCalendarItem({
      jobId: params.jobId,
      userId: params.userId,
      job: params.job,
    })
  } catch (error) {
    try {
      await reportActionError({
        error,
        action: params.action,
        section: 'jobs',
        errorType: params.errorType,
        userId: params.userIdForErrorLog ?? params.userId,
      })
    } catch (reportError) {
      console.error('Google kalendářová synchronizace zakázky selhala.', reportError)
    }
  }
}

async function cancelJobGoogleCalendarItemSafely(params: {
  jobId: string
  userId: string
  action: string
  errorType: string
  userIdForErrorLog?: string | null
}) {
  try {
    await cancelJobGoogleCalendarItem({
      jobId: params.jobId,
      userId: params.userId,
    })
  } catch (error) {
    try {
      await reportActionError({
        error,
        action: params.action,
        section: 'jobs',
        errorType: params.errorType,
        userId: params.userIdForErrorLog ?? params.userId,
      })
    } catch (reportError) {
      console.error('Google kalendářové zrušení zakázky selhalo.', reportError)
    }
  }
}

async function syncJobCalendarForTechniciansSafely(params: {
  supabase?: Awaited<ReturnType<typeof createClient>>
  jobId: string
  technicianIds: string[]
  action: string
  errorType: string
  userIdForErrorLog?: string | null
}) {
  const supabase = params.supabase ?? (await createClient())
  const job = await getJobCalendarSnapshot(supabase, params.jobId)

  await Promise.all(
    [
      syncDispatcherCalendarsForJob(job),
      ...params.technicianIds.map((technicianId) =>
        Promise.all([
          syncJobCalendarItemSafely({
            jobId: params.jobId,
            userId: technicianId,
            job,
            action: params.action,
            errorType: params.errorType,
            userIdForErrorLog: params.userIdForErrorLog,
          }),
          syncJobGoogleCalendarItemSafely({
            jobId: params.jobId,
            userId: technicianId,
            job,
            action: params.action,
            errorType: `${params.errorType}Google`,
            userIdForErrorLog: params.userIdForErrorLog,
          }),
        ])
      ),
    ]
  )
}

async function cancelJobCalendarForTechniciansSafely(params: {
  jobId: string
  technicianIds: string[]
  action: string
  errorType: string
  userIdForErrorLog?: string | null
}) {
  if (params.technicianIds.length === 0) {
    return
  }

  await Promise.all(
    params.technicianIds.map((technicianId) =>
      Promise.all([
        cancelJobCalendarItemSafely({
          jobId: params.jobId,
          userId: technicianId,
          action: params.action,
          errorType: params.errorType,
          userIdForErrorLog: params.userIdForErrorLog,
        }),
        cancelJobGoogleCalendarItemSafely({
          jobId: params.jobId,
          userId: technicianId,
          action: params.action,
          errorType: `${params.errorType}Google`,
          userIdForErrorLog: params.userIdForErrorLog,
        }),
      ])
    )
  )
}

async function notifyUsersAboutCreatedJob({
  supabase,
  actorUserId,
  job,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  actorUserId: string
  job: CreatedJobNotificationRow
}) {
  const recipientIds = await getJobNotificationRecipientIds(
    supabase,
    job.sales_owner
  )

  if (recipientIds.length === 0) return

  const jobNumber = job.job_number ?? String(job.id)
  const companyName = job.company_name?.trim() || 'neuvedený klient'
  const city = job.site_address?.split(',')[0]?.trim() || 'neuvedeno'
  const startAt = formatJobNotificationDate(job.start_at)
  const endAt = formatJobNotificationDate(job.end_at)
  const message = `Vytvořena nová zakázka ${jobNumber} pro klienta: ${companyName}, město: ${city}, termín ${startAt} - ${endAt}.`

  await Promise.all(
    recipientIds.map((recipientUserId) =>
      createNotification({
        supabase,
        recipientUserId,
        actorUserId,
        category: 'jobs',
        type: 'job_created',
        title: 'NOVÁ ZAKÁZKA',
        message,
        entityType: 'job',
        entityId: job.id,
        href: null,
        priority: 'normal',
        dedupeKey: `job_created:${job.id}:${recipientUserId}`,
        skipSelfNotification: false,
      })
    )
  )
}

async function resolveClientSelection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  formData: FormData
) {
  const clientId = normalizeUuid(formData.get('client_id'))

  if (!clientId) {
    return {
      error: 'Vyber firmu ze seznamu klientů.',
      client: null,
    }
  }

  const { data: client, error } = await supabase
    .from('clients')
    .select('id, name')
    .eq('id', clientId)
    .single()

  if (error || !client) {
    return {
      error: 'Vybranou firmu se nepodařilo ověřit.',
      client: null,
    }
  }

  const typedClient = client as ClientRow
  const clientName = typedClient.name?.trim() ?? ''

  if (!clientName) {
    return {
      error: 'Vybraný klient nemá platný název firmy.',
      client: null,
    }
  }

  return {
    error: null,
    client: {
      id: String(typedClient.id),
      name: clientName,
    },
  }
}

async function resolveJobContactSelection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  clientId: string,
  formData: FormData
) {
  const contactId = normalizeUuid(formData.get('client_contact_id'))

  if (!contactId) {
    return {
      error: null,
      contactId: null,
      contactPerson: normalizeText(formData.get('contact_person')),
    }
  }

  const { data: contact, error } = await supabase
    .from('client_contacts')
    .select('id, client_id, name')
    .eq('id', contactId)
    .eq('client_id', clientId)
    .single()

  if (error || !contact) {
    return {
      error: 'Vybranou kontaktní osobu se nepodařilo ověřit.',
      contactId: null,
      contactPerson: null,
    }
  }

  const typedContact = contact as ClientContactRow

  return {
    error: null,
    contactId: String(typedContact.id),
    contactPerson: typedContact.name?.trim() || null,
  }
}

async function resolveJobOfferSelection({
  supabase,
  clientId,
  selectedOfferId,
  currentOfferId = null,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  clientId: string
  selectedOfferId: string | null
  currentOfferId?: string | null
}) {
  if (!selectedOfferId) {
    return {
      error: null as string | null,
      offerId: null as string | null,
    }
  }

  if (currentOfferId && selectedOfferId === currentOfferId) {
    return {
      error: null as string | null,
      offerId: selectedOfferId,
    }
  }

  const { data: offerData, error } = await supabase
    .from('offers')
    .select('id, client_id, offer_type, status')
    .eq('id', selectedOfferId)
    .single()

  if (error || !offerData) {
    return {
      error: 'Vybranou nabídku se nepodařilo ověřit.',
      offerId: null as string | null,
    }
  }

  const typedOffer = offerData as OfferForJobRow

  if (typedOffer.client_id !== clientId) {
    return {
      error: 'Vybraná nabídka nepatří k zadanému klientovi.',
      offerId: null as string | null,
    }
  }

  if (typedOffer.offer_type !== 'classic') {
    return {
      error: 'K zakázce lze navázat pouze klasickou nabídku.',
      offerId: null as string | null,
    }
  }

  if (typedOffer.status === 'realizace') {
    return {
      error: 'Vybraná nabídka je již ve stavu REALIZACE.',
      offerId: null as string | null,
    }
  }

  return {
    error: null as string | null,
    offerId: selectedOfferId,
  }
}

async function getJobPayload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  formData: FormData
) {
  const { error: clientError, client } = await resolveClientSelection(
    supabase,
    formData
  )

  if (clientError || !client) {
    return {
      error: clientError ?? 'Vyber platnou firmu.',
      payload: null,
    }
  }

  const {
    error: contactError,
    contactId,
    contactPerson,
  } = await resolveJobContactSelection(supabase, client.id, formData)

  if (contactError) {
    return {
      error: contactError,
      payload: null,
    }
  }

  const salesOwner = normalizeSalesOwner(formData.get('sales_owner'))
  const startAt = parseDateTimeLocalAsPrague(formData.get('start_at'))
  const endAt = parseDateTimeLocalAsPrague(formData.get('end_at'))
  const siteAddress = normalizeText(formData.get('site_address'))
  const storeNumber = normalizeText(formData.get('store_number'))
  const clientOrderNumber = normalizeText(formData.get('client_order_number'))
  const generatorName = normalizeText(formData.get('generator_name'))
  const infoNote = normalizeText(formData.get('info_note'))
  const marnyVyjezd = normalizeCheckbox(formData.get('marny_vyjezd'))
  const pohotovost = normalizeCheckbox(formData.get('pohotovost'))

  if (marnyVyjezd && pohotovost) {
    return {
      error: 'Zakázka nemůže být současně označena jako marný výjezd a pohotovost.',
      payload: null,
    }
  }

  const jobStatus = marnyVyjezd
    ? 'ukoncena'
    : normalizeJobStatus(formData.get('job_status'))
  const invoiceStatus = normalizeInvoiceStatus(formData.get('invoice_status'))
  const technicianSelection = await resolveTechnicianSelection(supabase, formData)

  if (technicianSelection.error) {
    return {
      error: technicianSelection.error,
      payload: null,
    }
  }

  if (!startAt) {
    return {
      error: 'Vyplň platný začátek.',
      payload: null,
    }
  }

  if (!endAt) {
    return {
      error: 'Vyplň platný konec.',
      payload: null,
    }
  }

  if (new Date(endAt).getTime() < new Date(startAt).getTime()) {
    return {
      error: 'Konec nesmí být dříve než začátek.',
      payload: null,
    }
  }

  return {
    error: null,
    payload: {
      client_id: client.id,
      offer_id: null as string | null,
      client_contact_id: contactId,
      company_name: client.name,
      contact_person: contactPerson,
      sales_owner: salesOwner,
      start_at: startAt,
      end_at: endAt,
      site_address: siteAddress,
      store_number: storeNumber,
      client_order_number: clientOrderNumber,
      technician_name: technicianSelection.technicianLabel,
      generator_name: generatorName,
      info_note: infoNote,
      marny_vyjezd: marnyVyjezd,
      pohotovost,
      job_status: jobStatus,
      invoice_status: invoiceStatus,
    },
    technicianIds: technicianSelection.technicianIds,
  }
}

export async function createJobAction(
  _prevState: CreateJobActionState,
  formData: FormData
): Promise<CreateJobActionState> {
  const {
    supabase,
    user,
    error: accessError,
    isAdmin,
  } = await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  if (!isAdmin) {
    return {
      success: false,
      error: 'Zakázky může vytvářet pouze admin.',
    }
  }

  const {
    error: validationError,
    payload,
    technicianIds,
  } = await getJobPayload(
    supabase,
    formData
  )

  if (validationError || !payload) {
    return {
      success: false,
      error: validationError ?? 'Zakázku se nepodařilo připravit.',
    }
  }

  const selectedOfferId = normalizeUuid(formData.get('offer_id'))
  const offerSelection = await resolveJobOfferSelection({
    supabase,
    clientId: payload.client_id,
    selectedOfferId,
  })

  if (offerSelection.error) {
    return {
      success: false,
      error: offerSelection.error,
    }
  }

  const createPayload = payload as typeof payload & {
    offer_id: string | null
  }
  createPayload.offer_id = offerSelection.offerId
  const ppRequired = normalizePpRequired(formData.get('pp_required'))
  const isMarnyVyjezd = Boolean(createPayload.marny_vyjezd)

  const { data: createdJob, error: createJobError } = await supabase
    .from('jobs')
    .insert({
      ...createPayload,
      evidence_status: isMarnyVyjezd ? 'zapsano' : 'nove',
    })
    .select('id, job_number, company_name, sales_owner, start_at, end_at, site_address')
    .single()

  if (createJobError || !createdJob?.id) {
    return {
      success: false,
      error: 'Zakázku se nepodařilo uložit.',
    }
  }

  const createdJobId = String(createdJob.id)

  try {
    await syncJobTechnicians(
      supabase,
      createdJobId,
      technicianIds ?? []
    )
  } catch (technicianError) {
    await supabase.from('job_finances').delete().eq('job_id', createdJobId)
    await supabase.from('jobs').delete().eq('id', createdJobId)

    console.error(
      'Nepodařilo se uložit techniky k nové zakázce.',
      technicianError
    )
    await reportActionError({
      error: technicianError,
      action: 'createJobAction',
      section: 'jobs',
      errorType: 'CreateJobTechniciansSyncError',
      userId: user.id,
      context: { jobId: createdJobId },
    })

    return {
      success: false,
      error:
        'Zakázka byla vytvořena, ale nepodařilo se uložit přiřazené techniky. Založení bylo vráceno zpět.',
    }
  }

  const { error: createFinanceError } = await supabase
    .from('job_finances')
    .insert({
      job_id: createdJobId,
      client_order_number: createPayload.client_order_number,
    })

  if (createFinanceError) {
    await supabase.from('jobs').delete().eq('id', createdJobId)

    return {
      success: false,
      error:
        'Zakázka byla vytvořena, ale nepodařilo se založit finanční záznam. Založení bylo vráceno zpět.',
    }
  }

  try {
    await setJobPpRequired(supabase, {
      jobId: createdJobId,
      ppRequired,
      updatedBy: user.id,
    })
  } catch (ppRequirementError) {
    await supabase.from('job_finances').delete().eq('job_id', createdJobId)
    await supabase.from('jobs').delete().eq('id', createdJobId)

    console.error(
      'Nepodařilo se uložit nastavení povinného PP u nové zakázky.',
      ppRequirementError
    )
    await reportActionError({
      error: ppRequirementError,
      action: 'createJobAction',
      section: 'jobs',
      errorType: 'CreateJobPpRequirementError',
      userId: user.id,
      context: { jobId: createdJobId, ppRequired },
    })

    return {
      success: false,
      error:
        'Zakázka byla vytvořena, ale nepodařilo se uložit nastavení PP. Založení bylo vráceno zpět.',
    }
  }

  let offerSyncWarning: string | null = null

  if (payload.offer_id) {
    const now = new Date().toISOString()
    const { data: updatedOfferRows, error: offerSyncError } = await supabase
      .from('offers')
      .update({
        status: 'realizace',
        rejection_comment: null,
        last_edited_by: user.id,
        updated_at: now,
      })
      .eq('id', payload.offer_id)
      .eq('client_id', payload.client_id)
      .eq('offer_type', 'classic')
      .neq('status', 'realizace')
      .select('id')

    if (offerSyncError) {
      offerSyncWarning =
        'Zakázka byla vytvořena, ale nepodařilo se automaticky přepnout navázanou nabídku do stavu REALIZACE. Proveď změnu ručně v Nabídkách.'
      console.error('Nepodařilo se přepnout nabídku do stavu realizace po vytvoření zakázky.', offerSyncError)
      await reportActionError({
        error: offerSyncError,
        action: 'createJobAction',
        section: 'jobs',
        errorType: 'CreateJobOfferSyncError',
        userId: user.id,
        context: { jobId: createdJobId, offerId: payload.offer_id },
      })
    } else if (!updatedOfferRows || updatedOfferRows.length === 0) {
      offerSyncWarning =
        'Zakázka byla vytvořena, ale navázaná nabídka už nešla automaticky přepnout do stavu REALIZACE (pravděpodobně změna stavu mezitím). Proveď změnu ručně v Nabídkách.'
    } else {
      revalidatePath('/offers')
      revalidatePath(`/offers/${payload.offer_id}`)
    }
  }

  try {
    await enqueueJobPostCreateTask({
      jobId: createdJobId,
      actorUserId: user.id,
      technicianIds: technicianIds ?? [],
    })

    after(async () => {
      await runPendingJobPostCreateTasks(1)
    })
  } catch (taskQueueError) {
    // The job itself is already safely stored. Preserve the original behavior
    // if the durable background queue is temporarily unavailable.
    console.error(
      'Nepodařilo se zařadit navazující akce nové zakázky do fronty.',
      taskQueueError
    )
    await reportActionError({
      error: taskQueueError,
      action: 'createJobAction',
      section: 'jobs',
      errorType: 'CreateJobPostCreateQueueError',
      userId: user.id,
      context: { jobId: createdJobId },
    })

    after(async () => {
      await runJobPostCreateEffects({
        supabase,
        jobId: createdJobId,
        actorUserId: user.id,
        technicianIds: technicianIds ?? [],
      })
    })
  }

  revalidateAllRelatedPaths()
  revalidatePath('/dashboard')
  revalidatePath('/notifications')

  return {
    success: true,
    error: null,
    warning: offerSyncWarning,
    jobNumber: createdJob.job_number ?? null,
    companyName: createdJob.company_name ?? null,
  }
}

export async function updateJobAction(
  jobId: string,
  _prevState: UpdateJobActionState,
  formData: FormData
): Promise<UpdateJobActionState> {
  const {
    supabase,
    user,
    error: accessError,
    isAdmin,
  } = await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  if (!isAdmin) {
    return {
      success: false,
      error: 'Celou zakázku může upravovat pouze admin.',
    }
  }

  const normalizedJobId = String(jobId ?? '').trim()

  if (!normalizedJobId) {
    return {
      success: false,
      error: 'Chybí ID zakázky.',
    }
  }

  const {
    error: validationError,
    payload,
    technicianIds,
  } = await getJobPayload(
    supabase,
    formData
  )

  if (validationError || !payload) {
    return {
      success: false,
      error: validationError ?? 'Zakázku se nepodařilo připravit.',
    }
  }

  const [currentJobResponse, previousTechnicianIds] = await Promise.all([
    supabase
      .from('jobs')
      .select('job_number, company_name, start_at, end_at, site_address, technician_name, generator_name, offer_id')
      .eq('id', normalizedJobId)
      .single(),
    getAssignedTechnicianIdsForJob(supabase, normalizedJobId),
  ])
  const { data: currentJob, error: currentJobError } = currentJobResponse

  if (currentJobError || !currentJob) {
    return {
      success: false,
      error: 'Nepodařilo se načíst aktuální stav zakázky.',
    }
  }

  const previousTrackedValues: ChangedValues = {
    company_name: currentJob.company_name,
    start_at: currentJob.start_at,
    end_at: currentJob.end_at,
    site_address: currentJob.site_address,
    technician_name: currentJob.technician_name,
    generator_name: currentJob.generator_name,
  }

  const currentOfferId = String(
    (currentJob as { offer_id?: string | null }).offer_id ?? ''
  ).trim()
  const selectedOfferId = normalizeUuid(formData.get('offer_id'))
  const offerSelection = await resolveJobOfferSelection({
    supabase,
    clientId: payload.client_id,
    selectedOfferId,
    currentOfferId,
  })

  if (offerSelection.error) {
    return {
      success: false,
      error: offerSelection.error,
    }
  }

  const updatePayload = payload as typeof payload & {
    offer_id: string | null
  }
  updatePayload.offer_id = offerSelection.offerId
  const ppRequired = normalizePpRequired(formData.get('pp_required'))

  const { error } = await supabase
    .from('jobs')
    .update({
      ...updatePayload,
      ...(updatePayload.marny_vyjezd
        ? { evidence_status: 'zapsano' }
        : {}),
    })
    .eq('id', normalizedJobId)

  if (error) {
    return {
      success: false,
      error: 'Zakázku se nepodařilo upravit.',
    }
  }

  try {
    await syncJobClientOrderNumberToFinance({
      supabase,
      jobId: normalizedJobId,
      clientOrderNumber: updatePayload.client_order_number,
    })
  } catch (syncError) {
    console.error(
      'Nepodařilo se synchronizovat objednávku zakázky do fakturace.',
      syncError
    )
    await reportActionError({
      error: syncError,
      action: 'updateJobAction',
      section: 'jobs',
      errorType: 'UpdateJobClientOrderNumberSyncError',
      userId: user.id,
      context: { jobId: normalizedJobId },
    })

    return {
      success: false,
      error: 'Zakázka byla upravena, ale nepodařilo se synchronizovat objednávku do fakturace.',
    }
  }

  try {
    await setJobPpRequired(supabase, {
      jobId: normalizedJobId,
      ppRequired,
      updatedBy: user.id,
    })
  } catch (ppRequirementError) {
    console.error(
      'Nepodařilo se uložit nastavení povinného PP u zakázky.',
      ppRequirementError
    )
    await reportActionError({
      error: ppRequirementError,
      action: 'updateJobAction',
      section: 'jobs',
      errorType: 'UpdateJobPpRequirementError',
      userId: user.id,
      context: { jobId: normalizedJobId, ppRequired },
    })

    return {
      success: false,
      error: 'Zakázka byla upravena, ale nepodařilo se uložit nastavení PP.',
    }
  }

  let offerSyncWarning: string | null = null
  let handoverPlaceSyncWarning: string | null = null

  if (typeof updatePayload.site_address !== 'undefined') {
    try {
      await syncHandoverProtocolPlace(
        supabase,
        normalizedJobId,
        updatePayload.site_address
      )
      revalidatePath(`/jobs/${normalizedJobId}/pp`)
    } catch (syncError) {
      handoverPlaceSyncWarning =
        'Zakázka byla uložena, ale nepodařilo se synchronizovat adresu do předávacího protokolu.'
      console.error(
        'Nepodařilo se synchronizovat adresu předávacího protokolu po úpravě zakázky.',
        syncError
      )
      await reportActionError({
        error: syncError,
        action: 'updateJobAction',
        section: 'jobs',
        errorType: 'UpdateJobHandoverSyncError',
        userId: user.id,
        context: { jobId: normalizedJobId },
      })
    }
  }

  if (payload.offer_id) {
    const now = new Date().toISOString()
    const { data: updatedOfferRows, error: offerSyncError } = await supabase
      .from('offers')
      .update({
        status: 'realizace',
        rejection_comment: null,
        last_edited_by: user.id,
        updated_at: now,
      })
      .eq('id', payload.offer_id)
      .eq('client_id', payload.client_id)
      .eq('offer_type', 'classic')
      .neq('status', 'realizace')
      .select('id')

    if (offerSyncError) {
      offerSyncWarning =
        'Zakázka byla uložena, ale nepodařilo se automaticky přepnout navázanou nabídku do stavu REALIZACE. Proveď změnu ručně v Nabídkách.'
      console.error(
        'Nepodařilo se přepnout nabídku do stavu realizace po úpravě zakázky.',
        offerSyncError
      )
      await reportActionError({
        error: offerSyncError,
        action: 'updateJobAction',
        section: 'jobs',
        errorType: 'UpdateJobOfferSyncError',
        userId: user.id,
        context: { jobId: normalizedJobId, offerId: payload.offer_id },
      })
    } else if (!updatedOfferRows || updatedOfferRows.length === 0) {
      offerSyncWarning =
        'Zakázka byla uložena, ale navázaná nabídka už nešla automaticky přepnout do stavu REALIZACE (pravděpodobně změna stavu mezitím). Proveď změnu ručně v Nabídkách.'
    } else {
      revalidatePath('/offers')
      revalidatePath(`/offers/${payload.offer_id}`)
    }
  }

  const currentTechnicianName = String(
    (currentJob as { technician_name: string | null }).technician_name ?? ''
  ).trim()
  const nextTechnicianName = String(payload.technician_name ?? '').trim()

  if (currentTechnicianName !== nextTechnicianName) {
    try {
      await syncJobTechnicians(
        supabase,
        normalizedJobId,
        technicianIds ?? []
      )
    } catch (technicianError) {
      console.error(
        'Nepodařilo se uložit techniky u existující zakázky.',
        technicianError
      )
      await reportActionError({
        error: technicianError,
        action: 'updateJobAction',
        section: 'jobs',
        errorType: 'UpdateJobTechniciansSyncError',
        userId: user.id,
        context: { jobId: normalizedJobId },
      })

      return {
        success: false,
        error: 'Techniky se nepodařilo uložit.',
      }
    }

    try {
      await notifyTechniciansAboutJobAssignment({
        supabase,
        actorUserId: user.id,
        jobId: normalizedJobId,
        job: {
          job_number: (currentJob as { job_number: string | null }).job_number ?? null,
          start_at: payload.start_at,
          end_at: payload.end_at,
          site_address: payload.site_address,
        },
        technicianIds: technicianIds ?? [],
      })
    } catch (notificationError) {
      console.error(
        'Nepodařilo se vytvořit notifikaci o přiřazení technikům.',
        notificationError
      )
      await reportActionError({
        error: notificationError,
        action: 'updateJobAction',
        section: 'jobs',
        errorType: 'UpdateJobTechnicianNotificationError',
        userId: user.id,
        context: { jobId: normalizedJobId },
      })
    }

    const nextTechnicianIds = technicianIds ?? []
    const removedTechnicianIds = previousTechnicianIds.filter(
      (technicianId) => !nextTechnicianIds.includes(technicianId)
    )

    try {
      await cancelJobCalendarForTechniciansSafely({
        jobId: normalizedJobId,
        technicianIds: removedTechnicianIds,
        action: 'updateJobAction',
        errorType: 'UpdateJobCalendarCancelError',
        userIdForErrorLog: user.id,
      })
    } catch (calendarError) {
      console.error(
        'Nepodařilo se zrušit kalendář u odebraných techniků.',
        calendarError
      )
    }

    try {
      await syncJobCalendarForTechniciansSafely({
        supabase,
        jobId: normalizedJobId,
        technicianIds: nextTechnicianIds,
        action: 'updateJobAction',
        errorType: 'UpdateJobCalendarSyncError',
        userIdForErrorLog: user.id,
      })
    } catch (calendarError) {
      console.error(
        'Nepodařilo se synchronizovat kalendář po změně techniků.',
        calendarError
      )
    }
  } else {
    try {
      await syncJobCalendarForTechniciansSafely({
        supabase,
        jobId: normalizedJobId,
        technicianIds: previousTechnicianIds,
        action: 'updateJobAction',
        errorType: 'UpdateJobCalendarSyncError',
        userIdForErrorLog: user.id,
      })
    } catch (calendarError) {
      console.error(
        'Nepodařilo se synchronizovat kalendář po úpravě zakázky.',
        calendarError
      )
    }
  }

  try {
    await enqueueUpdatedJobChangeIfWritten({
      supabase,
      jobId: normalizedJobId,
      fields: [
        'company_name',
        'start_at',
        'end_at',
        'site_address',
        'technician_name',
        'generator_name',
      ],
      previousValues: previousTrackedValues,
    })
  } catch (queueError) {
    console.error('Nepodařilo se zapsat změnu zakázky do fronty změn.', queueError)
    await reportActionError({
      error: queueError,
      action: 'updateJobAction',
      section: 'jobs',
      errorType: 'UpdateJobQueueError',
      userId: user.id,
      context: { jobId: normalizedJobId },
    })
  }

  revalidateAllRelatedPaths()
  revalidatePath('/notifications')

  return {
    success: true,
    error: null,
    warning:
      [offerSyncWarning, handoverPlaceSyncWarning]
        .filter((item): item is string => Boolean(item))
        .join(' ') || null,
  }
}

export async function updateJobInfoAction(
  jobId: string,
  _prevState: UpdateJobInfoActionState,
  formData: FormData
): Promise<UpdateJobInfoActionState> {
  const { supabase, user, error: accessError } = await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  const normalizedJobId = String(jobId ?? '').trim()

  if (!normalizedJobId) {
    return {
      success: false,
      error: 'Chybí ID zakázky.',
    }
  }

  const infoNote = normalizeText(formData.get('info_note'))
  const requestedAlertEnabled = parseJobInfoAlertValue(
    formData.get('info_alert_enabled')
  )
  let jobStatus = ''
  let hasAttachments = false

  try {
    ;[jobStatus, hasAttachments] = await Promise.all([
      getJobInfoAlertStatus(supabase, normalizedJobId),
      jobHasInfoAttachments(supabase, normalizedJobId),
    ])
  } catch (error) {
    await reportActionError({
      error,
      action: 'updateJobInfoAction',
      section: 'jobs',
      errorType: 'JobInfoStatusCheckError',
      userId: user.id,
      context: {
        jobId: normalizedJobId,
        jobStatusRequested: requestedAlertEnabled,
      },
    })
    return {
      success: false,
      error: 'Nepodařilo se ověřit stav zakázky.',
    }
  }

  const infoAlertEnabled = getPersistedJobInfoAlert({
    requestedAlertEnabled,
    infoNote,
    hasAttachments,
    jobStatus,
  })

  const { error } = await supabase
    .from('jobs')
    .update({
      info_note: infoNote,
      info_alert_enabled: infoAlertEnabled,
    })
    .eq('id', normalizedJobId)

  if (error) {
    return {
      success: false,
      error: 'Info k zakázce se nepodařilo uložit.',
    }
  }

  try {
    await enqueueUpdatedJobChangeIfWritten({
      supabase,
      jobId: normalizedJobId,
      fields: ['info_note'],
    })
  } catch (queueError) {
    console.error('Nepodařilo se zapsat změnu info do fronty změn.', queueError)
    await reportActionError({
      error: queueError,
      action: 'updateJobInfoAction',
      section: 'jobs',
      errorType: 'JobInfoQueueWriteError',
      userId: user.id,
      context: {
        jobId: normalizedJobId,
        field: 'info_note',
      },
    })
  }

  try {
    await syncJobCalendarForTechniciansSafely({
      supabase,
      jobId: normalizedJobId,
      technicianIds: await getAssignedTechnicianIdsForJob(supabase, normalizedJobId),
      action: 'updateJobInfoAction',
      errorType: 'UpdateJobInfoCalendarSyncError',
      userIdForErrorLog: user.id,
    })
  } catch (calendarError) {
    console.error(
      'Nepodařilo se synchronizovat kalendář po úpravě info zakázky.',
      calendarError
    )
  }

  revalidateAllRelatedPaths()

  return {
    success: true,
    error: null,
  }
}

export async function updateJobInfoAlertAction(
  jobId: string,
  _prevState: UpdateJobInfoAlertActionState,
  formData: FormData
): Promise<UpdateJobInfoAlertActionState> {
  const { supabase, user, error: accessError } = await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  const normalizedJobId = String(jobId ?? '').trim()

  if (!normalizedJobId) {
    return {
      success: false,
      error: 'Chybí ID zakázky.',
    }
  }

  const infoNote = normalizeText(formData.get('info_note'))
  const requestedAlertEnabled = parseJobInfoAlertValue(
    formData.get('info_alert_enabled')
  )

  let jobStatus = ''
  let hasAttachments = false

  try {
    ;[jobStatus, hasAttachments] = await Promise.all([
      getJobInfoAlertStatus(supabase, normalizedJobId),
      jobHasInfoAttachments(supabase, normalizedJobId),
    ])
  } catch (error) {
    await reportActionError({
      error,
      action: 'updateJobInfoAlertAction',
      section: 'jobs',
      errorType: 'JobInfoAlertStatusCheckError',
      userId: user.id,
      context: {
        jobId: normalizedJobId,
        requestedAlertEnabled,
      },
    })
    return {
      success: false,
      error: 'Nepodařilo se ověřit stav zakázky.',
    }
  }

  const infoAlertEnabled = getPersistedJobInfoAlert({
    requestedAlertEnabled,
    infoNote,
    hasAttachments,
    jobStatus,
  })

  const { error } = await supabase
    .from('jobs')
    .update({
      info_note: infoNote,
      info_alert_enabled: infoAlertEnabled,
    })
    .eq('id', normalizedJobId)

  if (error) {
    return {
      success: false,
      error: 'Alert info zakázky se nepodařilo uložit.',
    }
  }

  try {
    await syncJobCalendarForTechniciansSafely({
      supabase,
      jobId: normalizedJobId,
      technicianIds: await getAssignedTechnicianIdsForJob(supabase, normalizedJobId),
      action: 'updateJobInfoAlertAction',
      errorType: 'UpdateJobInfoAlertCalendarSyncError',
      userIdForErrorLog: user.id,
    })
  } catch (calendarError) {
    console.error(
      'Nepodařilo se synchronizovat kalendář po úpravě alertu info zakázky.',
      calendarError
    )
  }

  revalidateAllRelatedPaths()

  return {
    success: true,
    error: null,
  }
}

export async function updateJobStatusAction(
  jobId: string,
  _prevState: UpdateJobStatusActionState,
  formData: FormData
): Promise<UpdateJobStatusActionState> {
  const { supabase, user, error: accessError } = await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  const normalizedJobId = String(jobId ?? '').trim()

  if (!normalizedJobId) {
    return {
      success: false,
      error: 'Chybí ID zakázky.',
    }
  }

  const jobStatusRaw = String(formData.get('job_status') ?? '').trim()

  if (
    !JOB_STATUS_VALUES.includes(
      jobStatusRaw as (typeof JOB_STATUS_VALUES)[number]
    )
  ) {
    return {
      success: false,
      error: 'Neplatný stav zakázky.',
    }
  }

  const statusUpdate =
    jobStatusRaw === 'ukoncena'
      ? {
          job_status: jobStatusRaw,
          info_alert_enabled: false,
        }
      : {
          job_status: jobStatusRaw,
        }

  const { data: updatedJob, error } = await supabase
    .from('jobs')
    .update(statusUpdate)
    .eq('id', normalizedJobId)
    .select('job_number')
    .single()

  if (error) {
    return {
      success: false,
      error: 'Stav zakázky se nepodařilo uložit.',
    }
  }

  after(async () => {
    try {
      await enqueueUpdatedJobChangeIfWritten({
        supabase,
        jobId: normalizedJobId,
        fields: ['job_status'],
      })
    } catch (queueError) {
      console.error('Nepodařilo se zapsat změnu stavu do fronty změn.', queueError)
      await reportActionError({
        error: queueError,
        action: 'updateJobStatusAction',
        section: 'jobs',
        errorType: 'JobStatusQueueWriteError',
        userId: user.id,
        context: {
          jobId: normalizedJobId,
          jobStatus: jobStatusRaw,
        },
      })
    }

    try {
      await syncJobCalendarForTechniciansSafely({
        supabase,
        jobId: normalizedJobId,
        technicianIds: await getAssignedTechnicianIdsForJob(
          supabase,
          normalizedJobId
        ),
        action: 'updateJobStatusAction',
        errorType: 'UpdateJobStatusCalendarSyncError',
        userIdForErrorLog: user.id,
      })
    } catch (calendarError) {
      console.error(
        'Nepodařilo se synchronizovat kalendář po změně stavu zakázky.',
        calendarError
      )
    }

    try {
      await logUserActivity({
        action: `Změnil stav zakázky ${updatedJob?.job_number || normalizedJobId} na ${getJobStatusActivityLabel(jobStatusRaw)}`,
        section: 'Zakázky',
        route: '/jobs',
        userId: user.id,
      })
    } catch (activityError) {
      console.error(
        'Nepodařilo se zapsat aktivitu po změně stavu zakázky.',
        activityError
      )
    }
  })

  revalidateAllRelatedPaths()

  return {
    success: true,
    error: null,
  }
}

export async function updateJobInvoiceStatusAction(
  jobId: string,
  _prevState: UpdateJobInvoiceStatusActionState,
  formData: FormData
): Promise<UpdateJobInvoiceStatusActionState> {
  const {
    supabase,
    user,
    error: accessError,
    isAdmin,
  } = await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  if (!isAdmin) {
    return {
      success: false,
      error: 'Fakturaci může měnit pouze admin.',
    }
  }

  const normalizedJobId = String(jobId ?? '').trim()

  if (!normalizedJobId) {
    return {
      success: false,
      error: 'Chybí ID zakázky.',
    }
  }

  const invoiceStatusRaw = String(formData.get('invoice_status') ?? '').trim()

  if (
    !INVOICE_STATUS_VALUES.includes(
      invoiceStatusRaw as (typeof INVOICE_STATUS_VALUES)[number]
    )
  ) {
    return {
      success: false,
      error: 'Neplatný stav fakturace.',
    }
  }

  const { data: updatedJob, error } = await supabase
    .from('jobs')
    .update({
      invoice_status: invoiceStatusRaw,
    })
    .eq('id', normalizedJobId)
    .select('job_number')
    .single()

  if (error) {
    return {
      success: false,
      error: 'Stav fakturace se nepodařilo uložit.',
    }
  }

  try {
    await enqueueUpdatedJobChangeIfWritten({
      supabase,
      jobId: normalizedJobId,
      fields: ['invoice_status'],
    })
  } catch (queueError) {
    console.error(
      'Nepodařilo se zapsat změnu fakturace do fronty změn.',
      queueError
    )
    await reportActionError({
      error: queueError,
      action: 'updateJobInvoiceStatusAction',
      section: 'jobs',
      errorType: 'UpdateJobInvoiceStatusQueueError',
      userId: user.id,
      context: { jobId: normalizedJobId, invoiceStatus: invoiceStatusRaw },
    })
  }

  try {
    await syncJobCalendarForTechniciansSafely({
      supabase,
      jobId: normalizedJobId,
      technicianIds: await getAssignedTechnicianIdsForJob(supabase, normalizedJobId),
      action: 'updateJobInvoiceStatusAction',
      errorType: 'UpdateJobInvoiceCalendarSyncError',
      userIdForErrorLog: user.id,
    })
  } catch (calendarError) {
    console.error(
      'Nepodařilo se synchronizovat kalendář po změně fakturace.',
      calendarError
    )
  }

  await logUserActivity({
    action: `Změnil stav fakturace zakázky ${updatedJob?.job_number || normalizedJobId} na ${getInvoiceStatusActivityLabel(invoiceStatusRaw)}`,
    section: 'Zakázky',
    route: '/jobs',
    userId: user.id,
  })

  revalidateAllRelatedPaths()

  return {
    success: true,
    error: null,
  }
}

export async function updateJobSalesOwnerAction(
  jobId: string,
  _prevState: UpdateJobSalesOwnerActionState,
  formData: FormData
): Promise<UpdateJobSalesOwnerActionState> {
  const {
    supabase,
    user,
    error: accessError,
    isAdmin,
  } = await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  if (!isAdmin) {
    return {
      success: false,
      error: 'Obchodníka může měnit pouze admin.',
    }
  }

  const normalizedJobId = String(jobId ?? '').trim()

  if (!normalizedJobId) {
    return {
      success: false,
      error: 'Chybí ID zakázky.',
    }
  }

  const salesOwnerRaw = String(formData.get('sales_owner') ?? '').trim()

  if (
    !SALES_OWNER_VALUES.includes(
      salesOwnerRaw as (typeof SALES_OWNER_VALUES)[number]
    )
  ) {
    return {
      success: false,
      error: 'Neplatný obchodník.',
    }
  }

  const { data: updatedJob, error } = await supabase
    .from('jobs')
    .update({
      sales_owner: salesOwnerRaw,
    })
    .eq('id', normalizedJobId)
    .select('job_number')
    .single()

  if (error) {
    return {
      success: false,
      error: 'Obchodníka se nepodařilo uložit.',
    }
  }

  try {
    await enqueueUpdatedJobChangeIfWritten({
      supabase,
      jobId: normalizedJobId,
      fields: ['sales_owner'],
    })
  } catch (queueError) {
    console.error(
      'Nepodařilo se zapsat změnu obchodníka do fronty změn.',
      queueError
    )
    await reportActionError({
      error: queueError,
      action: 'updateJobSalesOwnerAction',
      section: 'jobs',
      errorType: 'UpdateJobSalesOwnerQueueError',
      userId: user.id,
      context: { jobId: normalizedJobId, salesOwner: salesOwnerRaw },
    })
  }

  await logUserActivity({
    action: `Změnil obchodníka zakázky ${updatedJob?.job_number || normalizedJobId} na ${salesOwnerRaw}`,
    section: 'Zakázky',
    route: '/jobs',
    userId: user.id,
  })

  revalidateAllRelatedPaths()

  return {
    success: true,
    error: null,
  }
}

export async function updateJobEvidenceStatusAction(
  jobId: string,
  _prevState: UpdateJobEvidenceStatusActionState,
  formData: FormData
): Promise<UpdateJobEvidenceStatusActionState> {
  const { supabase, user, error: accessError } = await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  const normalizedJobId = String(jobId ?? '').trim()

  if (!normalizedJobId) {
    return {
      success: false,
      error: 'Chybí ID zakázky.',
    }
  }

  const evidenceStatusRaw = normalizeEvidenceStatus(
    formData.get('evidence_status')
  )

  if (
    !EVIDENCE_STATUS_VALUES.includes(
      evidenceStatusRaw as (typeof EVIDENCE_STATUS_VALUES)[number]
    )
  ) {
    return {
      success: false,
      error: 'Neplatný stav evidence.',
    }
  }

  const { data: updatedJob, error } = await supabase
    .from('jobs')
    .update({
      evidence_status: evidenceStatusRaw,
    })
    .eq('id', normalizedJobId)
    .select('job_number')
    .single()

  if (error) {
    return {
      success: false,
      error: 'Stav evidence se nepodařilo uložit.',
    }
  }

  after(async () => {
    try {
      await logUserActivity({
        action: `Změnil stav evidence zakázky ${updatedJob?.job_number || normalizedJobId} na ${getEvidenceStatusActivityLabel(evidenceStatusRaw)}`,
        section: 'Zakázky',
        route: '/jobs',
        userId: user.id,
      })
    } catch (activityError) {
      console.error(
        'Nepodařilo se zapsat aktivitu po změně evidence zakázky.',
        activityError
      )
    }

    try {
      await syncJobCalendarForTechniciansSafely({
        supabase,
        jobId: normalizedJobId,
        technicianIds: await getAssignedTechnicianIdsForJob(
          supabase,
          normalizedJobId
        ),
        action: 'updateJobEvidenceStatusAction',
        errorType: 'UpdateJobEvidenceCalendarSyncError',
        userIdForErrorLog: user.id,
      })
    } catch (calendarError) {
      console.error(
        'Nepodařilo se synchronizovat kalendář po změně evidence.',
        calendarError
      )
    }

    try {
      await syncDispatcherCalendarsForJobId(normalizedJobId)
    } catch (dispatcherCalendarError) {
      console.error(
        'Nepodařilo se synchronizovat dispečerské kalendáře po změně evidence.',
        dispatcherCalendarError
      )
    }
  })

  revalidateAllRelatedPaths()

  return {
    success: true,
    error: null,
  }
}

export async function updateJobInlineFieldAction(
  jobId: string,
  _prevState: UpdateJobInlineFieldActionState,
  formData: FormData
): Promise<UpdateJobInlineFieldActionState> {
  const {
    supabase,
    user,
    error: accessError,
    isAdmin,
  } = await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  const normalizedJobId = String(jobId ?? '').trim()

  if (!normalizedJobId) {
    return {
      success: false,
      error: 'Chybí ID zakázky.',
    }
  }

  const inlineJobNumberForLog = await getJobNumberForLog(supabase, normalizedJobId)

  const field = String(formData.get('field') ?? '').trim()
  const value = formData.get('value')
  const clientId = normalizeUuid(formData.get('client_id'))

  if (!isInlineEditableField(field)) {
    return {
      success: false,
      error: 'Neplatné pole pro editaci.',
    }
  }

  if (!isAdmin && !canNonAdminEditInlineField(field)) {
    return {
      success: false,
      error: 'Toto pole může upravovat pouze admin.',
    }
  }

  const previousTrackedValues = TRACKED_CHANGE_FIELDS.has(field as TrackedChangeField)
    ? buildChangedValuesSnapshot({
        source: await getJobQueueSource(supabase, normalizedJobId),
        fields: [field],
      })
    : undefined

  if (field === 'company_name') {
    if (!clientId) {
      return {
        success: false,
        error: 'Vyber existující firmu ze seznamu klientů.',
      }
    }

    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('id, name')
      .eq('id', clientId)
      .single()

    if (clientError || !client) {
      return {
        success: false,
        error: 'Vybranou firmu se nepodařilo najít v seznamu klientů.',
      }
    }

    const { error } = await supabase
      .from('jobs')
      .update({
        client_id: client.id,
        client_contact_id: null,
        company_name: client.name,
        contact_person: null,
      })
      .eq('id', normalizedJobId)

    if (error) {
      return {
        success: false,
        error: 'Firmu se nepodařilo uložit.',
      }
    }

    try {
      await enqueueUpdatedJobChangeIfWritten({
        supabase,
        jobId: normalizedJobId,
        fields: ['company_name', 'contact_person'],
        previousValues: previousTrackedValues,
      })
    } catch (queueError) {
      console.error('Nepodařilo se zapsat změnu firmy do fronty změn.', queueError)
      await reportActionError({
        error: queueError,
        action: 'updateJobInlineFieldAction',
        section: 'jobs',
        errorType: 'UpdateJobInlineCompanyQueueError',
        userId: user.id,
        context: { jobId: normalizedJobId, field: 'company_name', clientId: client.id },
      })
    }

    try {
      await syncJobCalendarForTechniciansSafely({
        supabase,
        jobId: normalizedJobId,
        technicianIds: await getAssignedTechnicianIdsForJob(supabase, normalizedJobId),
        action: 'updateJobInlineFieldAction',
        errorType: 'UpdateJobInlineCalendarSyncError',
        userIdForErrorLog: user.id,
      })
    } catch (calendarError) {
      console.error(
        'Nepodařilo se synchronizovat kalendář po změně firmy.',
        calendarError
      )
    }

    await logUserActivity({
      action: `Upravil firmu u zakázky ${inlineJobNumberForLog || normalizedJobId} na ${client.name}`,
      section: 'Zakázky',
      route: '/jobs',
      userId: user.id,
    })

    revalidateAllRelatedPaths()

    return {
      success: true,
      error: null,
    }
  }

  const normalizedValue = normalizeText(value)

  if (field === 'site_address') {
    const { error } = await supabase
      .from('jobs')
      .update({
        site_address: normalizedValue,
      })
      .eq('id', normalizedJobId)

    if (error) {
      return {
        success: false,
        error: 'Změnu se nepodařilo uložit.',
      }
    }

    try {
      await syncHandoverProtocolPlace(supabase, normalizedJobId, normalizedValue)
      revalidatePath(`/jobs/${normalizedJobId}/pp`)
    } catch (syncError) {
      console.error(
        'Nepodařilo se synchronizovat adresu předávacího protokolu po inline editaci zakázky.',
        syncError
      )
      await reportActionError({
        error: syncError,
        action: 'updateJobInlineFieldAction',
        section: 'jobs',
        errorType: 'UpdateJobInlineHandoverSyncError',
        userId: user.id,
        context: { jobId: normalizedJobId, field: 'site_address' },
      })
    }

    try {
      await enqueueUpdatedJobChangeIfWritten({
        supabase,
        jobId: normalizedJobId,
        fields: ['site_address'],
        previousValues: previousTrackedValues,
      })
    } catch (queueError) {
      console.error(
        'Nepodařilo se zapsat změnu adresy do fronty změn.',
        queueError
      )
      await reportActionError({
        error: queueError,
        action: 'updateJobInlineFieldAction',
        section: 'jobs',
        errorType: 'UpdateJobInlineAddressQueueError',
        userId: user.id,
        context: { jobId: normalizedJobId, field: 'site_address' },
      })
    }

    try {
      await syncJobCalendarForTechniciansSafely({
        supabase,
        jobId: normalizedJobId,
        technicianIds: await getAssignedTechnicianIdsForJob(supabase, normalizedJobId),
        action: 'updateJobInlineFieldAction',
        errorType: 'UpdateJobInlineCalendarSyncError',
        userIdForErrorLog: user.id,
      })
    } catch (calendarError) {
      console.error(
        'Nepodařilo se synchronizovat kalendář po změně adresy.',
        calendarError
      )
    }

    await logUserActivity({
      action: `Upravil pole zakázky ${inlineJobNumberForLog || normalizedJobId}: Adresa na ${normalizedValue ?? '—'}`,
      section: 'Zakázky',
      route: '/jobs',
      userId: user.id,
    })

    revalidateAllRelatedPaths()

    return {
      success: true,
      error: null,
    }
  }

  if (field === 'start_at' || field === 'end_at') {
    const parsedDate = parseDateTimeLocalAsPrague(value)

    if (!parsedDate) {
      return {
        success: false,
        error:
          field === 'start_at'
            ? 'Vyplň platný začátek.'
            : 'Vyplň platný konec.',
      }
    }

    const { data: currentJob, error: currentJobError } = await supabase
      .from('jobs')
      .select('job_number, start_at, end_at, site_address')
      .eq('id', normalizedJobId)
      .single()

    if (currentJobError || !currentJob) {
      return {
        success: false,
        error: 'Nepodařilo se načíst aktuální termíny zakázky.',
      }
    }

    const nextStartAt =
      field === 'start_at' ? parsedDate : String(currentJob.start_at ?? '')
    const nextEndAt =
      field === 'end_at' ? parsedDate : String(currentJob.end_at ?? '')

    if (!nextStartAt || !nextEndAt) {
      return {
        success: false,
        error: 'Zakázka musí mít začátek i konec.',
      }
    }

    if (new Date(nextEndAt).getTime() < new Date(nextStartAt).getTime()) {
      return {
        success: false,
        error: 'Konec nesmí být dříve než začátek.',
      }
    }

    const { error } = await supabase
      .from('jobs')
      .update({
        [field]: parsedDate,
      })
      .eq('id', normalizedJobId)

    if (error) {
      return {
        success: false,
        error:
          field === 'start_at'
            ? 'Začátek se nepodařilo uložit.'
            : 'Konec se nepodařilo uložit.',
      }
    }

    try {
      await enqueueUpdatedJobChangeIfWritten({
        supabase,
        jobId: normalizedJobId,
        fields: [field],
        previousValues: previousTrackedValues,
      })
    } catch (queueError) {
      console.error('Nepodařilo se zapsat změnu termínu do fronty změn.', queueError)
      await reportActionError({
        error: queueError,
        action: 'updateJobInlineFieldAction',
        section: 'jobs',
        errorType: 'UpdateJobInlineDateQueueError',
        userId: user.id,
        context: { jobId: normalizedJobId, field },
      })
    }

    try {
      await syncJobCalendarForTechniciansSafely({
        supabase,
        jobId: normalizedJobId,
        technicianIds: await getAssignedTechnicianIdsForJob(supabase, normalizedJobId),
        action: 'updateJobInlineFieldAction',
        errorType: 'UpdateJobInlineCalendarSyncError',
        userIdForErrorLog: user.id,
      })
    } catch (calendarError) {
      console.error(
        'Nepodařilo se synchronizovat kalendář po změně termínu.',
        calendarError
      )
    }

    await logUserActivity({
      action:
        field === 'start_at'
          ? `Upravil pole zakázky ${inlineJobNumberForLog || normalizedJobId}: Začátek na ${formatPragueDateTimeForLog(parsedDate)}`
          : `Upravil pole zakázky ${inlineJobNumberForLog || normalizedJobId}: Konec na ${formatPragueDateTimeForLog(parsedDate)}`,
      section: 'Zakázky',
      route: '/jobs',
      userId: user.id,
    })

    revalidateAllRelatedPaths()

    return {
      success: true,
      error: null,
    }
  }

  if (field === 'contact_person') {
    const { error } = await supabase
      .from('jobs')
      .update({
        contact_person: normalizedValue,
        client_contact_id: null,
      })
      .eq('id', normalizedJobId)

    if (error) {
      return {
        success: false,
        error: 'Změnu se nepodařilo uložit.',
      }
    }

    try {
      await enqueueUpdatedJobChangeIfWritten({
        supabase,
        jobId: normalizedJobId,
        fields: ['contact_person'],
      })
    } catch (queueError) {
      console.error('Nepodařilo se zapsat změnu osoby do fronty změn.', queueError)
      await reportActionError({
        error: queueError,
        action: 'updateJobInlineFieldAction',
        section: 'jobs',
        errorType: 'UpdateJobInlineContactQueueError',
        userId: user.id,
        context: { jobId: normalizedJobId, field: 'contact_person' },
      })
    }

    try {
      await syncJobCalendarForTechniciansSafely({
        supabase,
        jobId: normalizedJobId,
        technicianIds: await getAssignedTechnicianIdsForJob(supabase, normalizedJobId),
        action: 'updateJobInlineFieldAction',
        errorType: 'UpdateJobInlineCalendarSyncError',
        userIdForErrorLog: user.id,
      })
    } catch (calendarError) {
      console.error(
        'Nepodařilo se synchronizovat kalendář po změně kontaktní osoby.',
        calendarError
      )
    }

    await logUserActivity({
      action: `Upravil pole zakázky ${inlineJobNumberForLog || normalizedJobId}: Kontaktní osoba na ${normalizedValue ?? '—'}`,
      section: 'Zakázky',
      route: '/jobs',
      userId: user.id,
    })

    revalidateAllRelatedPaths()

    return {
      success: true,
      error: null,
    }
  }

  if (field === 'technician_name') {
    const previousTechnicianIds = await getAssignedTechnicianIdsForJob(
      supabase,
      normalizedJobId
    )

    const { data: currentJob, error: currentJobError } = await supabase
      .from('jobs')
      .select('job_number, start_at, end_at, site_address, technician_name')
      .eq('id', normalizedJobId)
      .single()

    if (currentJobError || !currentJob) {
      return {
        success: false,
        error: 'Nepodařilo se načíst aktuální stav zakázky.',
      }
    }

    const technicianSelection = await resolveTechnicianSelection(
      supabase,
      formData
    )

    if (technicianSelection.error) {
      return {
        success: false,
        error: technicianSelection.error,
      }
    }

    const { error } = await supabase
      .from('jobs')
      .update({
        technician_name: technicianSelection.technicianLabel,
      })
      .eq('id', normalizedJobId)

    if (error) {
      return {
        success: false,
        error: 'Techniky se nepodařilo uložit.',
      }
    }

    try {
      await syncJobTechnicians(
        supabase,
        normalizedJobId,
        technicianSelection.technicianIds
      )
    } catch (technicianError) {
      console.error(
        'Nepodařilo se uložit techniky z inline editace zakázky.',
        technicianError
      )
      await reportActionError({
        error: technicianError,
        action: 'updateJobInlineFieldAction',
        section: 'jobs',
        errorType: 'UpdateJobInlineTechniciansSyncError',
        userId: user.id,
        context: { jobId: normalizedJobId, field: 'technician_name' },
      })

      return {
        success: false,
        error: 'Techniky se nepodařilo uložit.',
      }
    }

    const removedTechnicianIds = previousTechnicianIds.filter(
      (technicianId) => !technicianSelection.technicianIds.includes(technicianId)
    )

    try {
      await cancelJobCalendarForTechniciansSafely({
        jobId: normalizedJobId,
        technicianIds: removedTechnicianIds,
        action: 'updateJobInlineFieldAction',
        errorType: 'UpdateJobInlineCalendarCancelError',
        userIdForErrorLog: user.id,
      })
    } catch (calendarError) {
      console.error(
        'Nepodařilo se zrušit kalendář u odebraných techniků z inline editace.',
        calendarError
      )
    }

    try {
      await syncJobCalendarForTechniciansSafely({
        supabase,
        jobId: normalizedJobId,
        technicianIds: technicianSelection.technicianIds,
        action: 'updateJobInlineFieldAction',
        errorType: 'UpdateJobInlineCalendarSyncError',
        userIdForErrorLog: user.id,
      })
    } catch (calendarError) {
      console.error(
        'Nepodařilo se synchronizovat kalendář po inline změně techniků.',
        calendarError
      )
    }

    const currentTechnicianName = String(
      (currentJob as { technician_name?: string | null }).technician_name ?? ''
    ).trim()
    const nextTechnicianName = String(
      technicianSelection.technicianLabel ?? ''
    ).trim()

    if (currentTechnicianName !== nextTechnicianName && nextTechnicianName) {
      try {
        await notifyTechniciansAboutJobAssignment({
          supabase,
          actorUserId: user.id,
          jobId: normalizedJobId,
          job: {
            job_number: (currentJob as { job_number?: string | null }).job_number ?? null,
            start_at: (currentJob as { start_at?: string | null }).start_at ?? null,
            end_at: (currentJob as { end_at?: string | null }).end_at ?? null,
            site_address: (currentJob as { site_address?: string | null }).site_address ?? null,
          },
          technicianIds: technicianSelection.technicianIds,
        })
      } catch (notificationError) {
        console.error(
          'Nepodařilo se vytvořit notifikaci o přiřazení technikům.',
          notificationError
        )
        await reportActionError({
          error: notificationError,
          action: 'updateJobInlineFieldAction',
          section: 'jobs',
          errorType: 'UpdateJobInlineTechnicianNotificationError',
          userId: user.id,
          context: { jobId: normalizedJobId, field: 'technician_name' },
        })
      }
    }

    try {
      await enqueueUpdatedJobChangeIfWritten({
        supabase,
        jobId: normalizedJobId,
        fields: ['technician_name'],
        previousValues: previousTrackedValues,
      })
    } catch (queueError) {
      console.error('Nepodařilo se zapsat změnu techniků do fronty změn.', queueError)
      await reportActionError({
        error: queueError,
        action: 'updateJobInlineFieldAction',
        section: 'jobs',
        errorType: 'UpdateJobInlineTechniciansQueueError',
        userId: user.id,
        context: { jobId: normalizedJobId, field: 'technician_name' },
      })
    }

    await logUserActivity({
      action: `Upravil pole zakázky ${inlineJobNumberForLog || normalizedJobId}: Technik na ${technicianSelection.technicianLabel ?? '—'}`,
      section: 'Zakázky',
      route: '/jobs',
      userId: user.id,
    })

    revalidateAllRelatedPaths()
    revalidatePath('/notifications')

    return {
      success: true,
      error: null,
    }
  }

  const { error } = await supabase
    .from('jobs')
    .update({
      [field]: normalizedValue,
    })
    .eq('id', normalizedJobId)

  if (error) {
    return {
      success: false,
      error: 'Změnu se nepodařilo uložit.',
    }
  }

  try {
    await enqueueUpdatedJobChangeIfWritten({
      supabase,
      jobId: normalizedJobId,
      fields: [field],
      previousValues: previousTrackedValues,
    })
  } catch (queueError) {
    console.error(
      'Nepodařilo se zapsat inline změnu do fronty změn.',
      queueError
    )
    await reportActionError({
      error: queueError,
      action: 'updateJobInlineFieldAction',
      section: 'jobs',
      errorType: 'UpdateJobInlineGenericQueueError',
      userId: user.id,
      context: { jobId: normalizedJobId, field },
    })
  }

  try {
    await syncJobCalendarForTechniciansSafely({
      supabase,
      jobId: normalizedJobId,
      technicianIds: await getAssignedTechnicianIdsForJob(
        supabase,
        normalizedJobId
      ),
      action: 'updateJobInlineFieldAction',
      errorType: 'UpdateJobInlineCalendarSyncError',
      userIdForErrorLog: user.id,
    })
  } catch (calendarError) {
    console.error(
      'Nepodařilo se synchronizovat kalendář po inline úpravě.',
      calendarError
    )
  }

  await logUserActivity({
    action: `Upravil pole zakázky ${inlineJobNumberForLog || normalizedJobId}: ${getJobFieldActivityLabel(field)} na ${normalizedValue ?? '—'}`,
    section: 'Zakázky',
    route: '/jobs',
    userId: user.id,
  })

  revalidateAllRelatedPaths()
  revalidatePath('/notifications')

  return {
    success: true,
    error: null,
  }
}

export async function deleteJobAction(
  jobId: string
): Promise<DeleteJobActionState> {
  const {
    supabase,
    user,
    error: accessError,
    isAdmin,
  } = await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  if (!isAdmin) {
    return {
      success: false,
      error: 'Zakázku může smazat pouze admin.',
    }
  }

  const normalizedJobId = String(jobId ?? '').trim()

  if (!normalizedJobId) {
    return {
      success: false,
      error: 'Chybí ID zakázky.',
    }
  }

  const assignedTechnicianIds = await getAssignedTechnicianIdsForJob(
    supabase,
    normalizedJobId
  )

  const { error: deleteFinancesError } = await supabase
    .from('job_finances')
    .delete()
    .eq('job_id', normalizedJobId)

  if (deleteFinancesError) {
    return {
      success: false,
      error: 'Nepodařilo se smazat navázaná finanční data zakázky.',
    }
  }

  const { error: deleteJobError } = await supabase
    .from('jobs')
    .delete()
    .eq('id', normalizedJobId)

  if (deleteJobError) {
    return {
      success: false,
      error: 'Zakázku se nepodařilo smazat.',
    }
  }

  try {
    await cancelDispatcherCalendarsForJob(normalizedJobId)
  } catch (calendarError) {
    console.error(
      'Nepodařilo se zrušit zakázku v dispečerských kalendářích.',
      calendarError
    )
    await reportActionError({
      error: calendarError,
      action: 'deleteJobAction',
      section: 'jobs',
      errorType: 'DeleteDispatcherCalendarCancelError',
      userId: user.id,
      context: { jobId: normalizedJobId },
    })
  }

  try {
    await cancelJobCalendarForTechniciansSafely({
      jobId: normalizedJobId,
      technicianIds: assignedTechnicianIds,
      action: 'deleteJobAction',
      errorType: 'DeleteJobCalendarCancelError',
      userIdForErrorLog: user.id,
    })
  } catch (calendarError) {
    console.error(
      'Nepodařilo se zrušit kalendář po smazání zakázky.',
      calendarError
    )
  }

  await logUserActivity({
    action: `Smazal zakázku ${normalizedJobId}`,
    section: 'Zakázky',
    route: '/jobs',
    userId: user.id,
  })

  revalidateAllRelatedPaths()

  return {
    success: true,
    error: null,
  }
}
