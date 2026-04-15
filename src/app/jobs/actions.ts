'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type CreateJobActionState = {
  success: boolean
  error: string | null
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

type ProfilePermissionRow = {
  can_view_jobs: boolean | null
}

const SALES_OWNER_VALUES = ['JIŘÍ', 'MICHAL', 'LÍDA', 'NONAME'] as const
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

type InlineEditableField = (typeof INLINE_EDITABLE_FIELDS)[number]

function normalizeText(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()
  return text.length > 0 ? text : null
}

function normalizeRequiredText(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

function normalizeSalesOwner(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim()

  return SALES_OWNER_VALUES.includes(
    text as (typeof SALES_OWNER_VALUES)[number]
  )
    ? text
    : 'NONAME'
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

function isInlineEditableField(value: string): value is InlineEditableField {
  return INLINE_EDITABLE_FIELDS.includes(value as InlineEditableField)
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
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('can_view_jobs')
    .eq('id', user.id)
    .single()

  if (profileError) {
    return {
      supabase,
      user: null,
      error: 'Nepodařilo se ověřit oprávnění uživatele.',
    }
  }

  const typedProfile = profile as ProfilePermissionRow | null

  if (!typedProfile?.can_view_jobs) {
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

function revalidateJobPaths(jobId: string) {
  revalidatePath('/jobs')
  revalidatePath(`/jobs/${jobId}`)
}

function getJobPayload(formData: FormData) {
  const companyName = normalizeRequiredText(formData.get('company_name'))
  const contactPerson = normalizeText(formData.get('contact_person'))
  const salesOwner = normalizeSalesOwner(formData.get('sales_owner'))
  const startAt = parseDateTimeLocalAsPrague(formData.get('start_at'))
  const endAt = parseDateTimeLocalAsPrague(formData.get('end_at'))
  const siteAddress = normalizeText(formData.get('site_address'))
  const storeNumber = normalizeText(formData.get('store_number'))
  const technicianName = normalizeText(formData.get('technician_name'))
  const generatorName = normalizeText(formData.get('generator_name'))
  const powerAndCablesNote = normalizeText(
    formData.get('power_and_cables_note')
  )
  const infoNote = normalizeText(formData.get('info_note'))
  const jobStatus = normalizeJobStatus(formData.get('job_status'))
  const invoiceStatus = normalizeInvoiceStatus(formData.get('invoice_status'))

  if (!companyName) {
    return {
      error: 'Vyplň firmu.',
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
      company_name: companyName,
      contact_person: contactPerson,
      sales_owner: salesOwner,
      start_at: startAt,
      end_at: endAt,
      site_address: siteAddress,
      store_number: storeNumber,
      technician_name: technicianName,
      generator_name: generatorName,
      power_and_cables_note: powerAndCablesNote,
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
  const { supabase, user, error: accessError } = await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  const { error: validationError, payload } = getJobPayload(formData)

  if (validationError || !payload) {
    return {
      success: false,
      error: validationError ?? 'Zakázku se nepodařilo připravit.',
    }
  }

  const { error } = await supabase.from('jobs').insert(payload)

  if (error) {
    return {
      success: false,
      error: 'Zakázku se nepodařilo uložit.',
    }
  }

  revalidatePath('/jobs')

  return {
    success: true,
    error: null,
  }
}

export async function updateJobAction(
  jobId: string,
  _prevState: UpdateJobActionState,
  formData: FormData
): Promise<UpdateJobActionState> {
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

  const { error: validationError, payload } = getJobPayload(formData)

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

  revalidateJobPaths(normalizedJobId)

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

  revalidateJobPaths(normalizedJobId)

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

  revalidateJobPaths(normalizedJobId)

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

  revalidateJobPaths(normalizedJobId)

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

  revalidateJobPaths(normalizedJobId)

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

  const field = String(formData.get('field') ?? '').trim()
  const value = formData.get('value')

  if (!isInlineEditableField(field)) {
    return {
      success: false,
      error: 'Neplatné pole pro editaci.',
    }
  }

  if (field === 'company_name') {
    const companyName = normalizeRequiredText(value)

    if (!companyName) {
      return {
        success: false,
        error: 'Firma nesmí být prázdná.',
      }
    }

    const { error } = await supabase
      .from('jobs')
      .update({
        company_name: companyName,
      })
      .eq('id', normalizedJobId)

    if (error) {
      return {
        success: false,
        error: 'Firmu se nepodařilo uložit.',
      }
    }

    revalidateJobPaths(normalizedJobId)

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

    revalidateJobPaths(normalizedJobId)

    return {
      success: true,
      error: null,
    }
  }

  const normalizedValue = normalizeText(value)

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

  revalidateJobPaths(normalizedJobId)

  return {
    success: true,
    error: null,
  }
}