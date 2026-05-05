'use server'

import { revalidatePath } from 'next/cache'
import { createNotification } from '@/lib/notifications/createNotification'
import { createClient } from '@/lib/supabase/server'

export type CreateJobActionState = {
  success: boolean
  error: string | null
  jobNumber?: string | null
  companyName?: string | null
}

export type UpdateJobActionState = {
  success: boolean
  error: string | null
}

export type UpdateJobInfoActionState = {
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

type ProfilePermissionRow = {
  can_view_jobs: boolean | null
  role: string | null
}

type JobNotificationProfileRow = {
  id: string
  role: string | null
  receive_job_notifications: boolean | null
}

type CreatedJobNotificationRow = {
  id: string
  job_number: string | null
  company_name: string | null
  sales_owner: string | null
  start_at: string | null
  end_at: string | null
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

function normalizeText(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
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

function revalidateAllRelatedPaths() {
  revalidatePath('/jobs')
  revalidatePath('/faktury')
}

function formatJobNotificationDate(value: string | null) {
  if (!value) return 'neuvedeno'

  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
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
  const startAt = formatJobNotificationDate(job.start_at)
  const endAt = formatJobNotificationDate(job.end_at)
  const message = `Byla vytvořena nová zakázka ${jobNumber} pro klienta: ${companyName}, termín ${startAt} - ${endAt}.`

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
  const technicianName = normalizeText(formData.get('technician_name'))
  const generatorName = normalizeText(formData.get('generator_name'))
  const infoNote = normalizeText(formData.get('info_note'))
  const jobStatus = normalizeJobStatus(formData.get('job_status'))
  const invoiceStatus = normalizeInvoiceStatus(formData.get('invoice_status'))

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
      client_contact_id: contactId,
      company_name: client.name,
      contact_person: contactPerson,
      sales_owner: salesOwner,
      start_at: startAt,
      end_at: endAt,
      site_address: siteAddress,
      store_number: storeNumber,
      technician_name: technicianName,
      generator_name: generatorName,
      info_note: infoNote,
      job_status: jobStatus,
      invoice_status: invoiceStatus,
    },
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

  const { error: validationError, payload } = await getJobPayload(
    supabase,
    formData
  )

  if (validationError || !payload) {
    return {
      success: false,
      error: validationError ?? 'Zakázku se nepodařilo připravit.',
    }
  }

  const { data: createdJob, error: createJobError } = await supabase
    .from('jobs')
    .insert({
      ...payload,
      evidence_status: 'nove',
    })
    .select('id, job_number, company_name, sales_owner, start_at, end_at')
    .single()

  if (createJobError || !createdJob?.id) {
    return {
      success: false,
      error: 'Zakázku se nepodařilo uložit.',
    }
  }

  const createdJobId = String(createdJob.id)

  const { error: createFinanceError } = await supabase
    .from('job_finances')
    .insert({
      job_id: createdJobId,
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
    await notifyUsersAboutCreatedJob({
      supabase,
      actorUserId: user.id,
      job: createdJob as CreatedJobNotificationRow,
    })
  } catch (notificationError) {
    console.error(
      'Nepodařilo se vytvořit notifikace k nové zakázce.',
      notificationError
    )
  }

  revalidateAllRelatedPaths()
  revalidatePath('/dashboard')
  revalidatePath('/notifications')

  return {
    success: true,
    error: null,
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

  const { error: validationError, payload } = await getJobPayload(
    supabase,
    formData
  )

  if (validationError || !payload) {
    return {
      success: false,
      error: validationError ?? 'Zakázku se nepodařilo připravit.',
    }
  }

  const { error } = await supabase
    .from('jobs')
    .update(payload)
    .eq('id', normalizedJobId)

  if (error) {
    return {
      success: false,
      error: 'Zakázku se nepodařilo upravit.',
    }
  }

  revalidateAllRelatedPaths()

  return {
    success: true,
    error: null,
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

  const { error } = await supabase
    .from('jobs')
    .update({
      info_note: infoNote,
    })
    .eq('id', normalizedJobId)

  if (error) {
    return {
      success: false,
      error: 'Info k zakázce se nepodařilo uložit.',
    }
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

  const { error } = await supabase
    .from('jobs')
    .update({
      job_status: jobStatusRaw,
    })
    .eq('id', normalizedJobId)

  if (error) {
    return {
      success: false,
      error: 'Stav zakázky se nepodařilo uložit.',
    }
  }

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

  const { error } = await supabase
    .from('jobs')
    .update({
      invoice_status: invoiceStatusRaw,
    })
    .eq('id', normalizedJobId)

  if (error) {
    return {
      success: false,
      error: 'Stav fakturace se nepodařilo uložit.',
    }
  }

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

  const { error } = await supabase
    .from('jobs')
    .update({
      sales_owner: salesOwnerRaw,
    })
    .eq('id', normalizedJobId)

  if (error) {
    return {
      success: false,
      error: 'Obchodníka se nepodařilo uložit.',
    }
  }

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

  const { error } = await supabase
    .from('jobs')
    .update({
      evidence_status: evidenceStatusRaw,
    })
    .eq('id', normalizedJobId)

  if (error) {
    return {
      success: false,
      error: 'Stav evidence se nepodařilo uložit.',
    }
  }

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
      .select('start_at, end_at')
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

    revalidateAllRelatedPaths()

    return {
      success: true,
      error: null,
    }
  }

  const normalizedValue = normalizeText(value)

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

    revalidateAllRelatedPaths()

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

  revalidateAllRelatedPaths()

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

  revalidateAllRelatedPaths()

  return {
    success: true,
    error: null,
  }
}
