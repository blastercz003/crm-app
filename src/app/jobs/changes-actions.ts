'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { reportActionError } from '@/lib/errors/reportActionError'
import {
  areChangeValuesEqual,
  formatChangeFieldValue,
  getChangeFieldLabel,
} from '@/lib/jobs/changes-queue'

type ProfilePermissionRow = {
  can_view_jobs: boolean | null
  role: string | null
  skryt_marny_vyjezd: boolean | null
}

type JobRelation = {
  id: string
  job_number: string | null
  company_name: string | null
  site_address: string | null
  start_at: string | null
  end_at: string | null
  generator_name: string | null
  technician_name: string | null
  evidence_status: string | null
  marny_vyjezd: boolean | null
}

type JobChangeQueueRow = {
  job_id: string
  kind: 'new_job' | 'updated_job'
  changed_fields: string[] | null
  original_values: Record<string, string | null> | null
  changed_values: Record<string, string | null> | null
  changed_fields_label: string | null
  updated_at: string
  jobs: JobRelation | JobRelation[] | null
}

function getJobRelation(value: JobChangeQueueRow['jobs']): JobRelation | null {
  if (!value) return null

  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value
}

export type ChangesNewJobItem = {
  jobId: string
  jobNumber: string
  companyName: string
  siteAddress: string
  startAt: string | null
  endAt: string | null
  generatorName: string
  technicianName: string
  evidenceStatus: 'nove' | 'zapsano'
  updatedAt: string
}

export type ChangesUpdatedJobItem = {
  jobId: string
  jobNumber: string
  changes: Array<{
    field: string
    label: string
    hasPreviousValue: boolean
    previousValue: string
    nextValue: string
  }>
  legacyDescription: string | null
  updatedAt: string
}

export type SaveJobChangesSelection = {
  acknowledgedNewJobIds: string[]
  acknowledgedUpdatedJobs: Array<{
    jobId: string
    updatedAt: string
  }>
}

export type JobChangesModalData = {
  newJobs: ChangesNewJobItem[]
  updatedJobs: ChangesUpdatedJobItem[]
  badgeCount: number
}

export type JobChangesActionResult<T> = {
  success: boolean
  error: string | null
  data?: T
}

function getPragueTodayParts() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(new Date())

  const year = Number(parts.find((part) => part.type === 'year')?.value ?? '')
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? '')
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? '')

  return { year, month, day }
}

function toDateOnly(value: Date) {
  const year = value.getUTCFullYear()
  const month = String(value.getUTCMonth() + 1).padStart(2, '0')
  const day = String(value.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function addDaysUtc(value: Date, days: number) {
  const next = new Date(value)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function getNextWorkWeekEnd() {
  const today = getPragueTodayParts()
  const pragueDateAsUtc = new Date(
    Date.UTC(today.year, today.month - 1, today.day, 12, 0, 0)
  )

  const day = pragueDateAsUtc.getUTCDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const nextMonday = addDaysUtc(pragueDateAsUtc, mondayOffset + 7)
  const nextFriday = addDaysUtc(nextMonday, 4)

  return toDateOnly(nextFriday)
}

async function requireJobsAccess() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      supabase,
      user: null,
      error: 'Nejsi přihlášený.',
      hideMarnyVyjezdy: false,
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('can_view_jobs, role, skryt_marny_vyjezd')
    .eq('id', user.id)
    .single()

  if (profileError) {
    return {
      supabase,
      user: null,
      error: 'Nepodařilo se ověřit oprávnění uživatele.',
      hideMarnyVyjezdy: false,
    }
  }

  const typedProfile = profile as ProfilePermissionRow | null
  const isAdmin = typedProfile?.role === 'admin'
  const hideMarnyVyjezdy = Boolean(typedProfile?.skryt_marny_vyjezd)

  if (!isAdmin && !typedProfile?.can_view_jobs) {
    return {
      supabase,
      user: null,
      error: 'Nemáš oprávnění pro práci se zakázkami.',
      hideMarnyVyjezdy: false,
    }
  }

  return {
    supabase,
    user,
    error: null,
    hideMarnyVyjezdy,
  }
}

function toUpdatedChanges(row: JobChangeQueueRow) {
  const fields = Array.isArray(row.changed_fields) ? row.changed_fields : []
  const originalValues = row.original_values ?? {}
  const changedValues = row.changed_values ?? {}

  return fields
    .filter(
      (field) =>
        !Object.prototype.hasOwnProperty.call(originalValues, field) ||
        !areChangeValuesEqual(field, originalValues[field], changedValues[field])
    )
    .map((field) => {
      const hasPreviousValue = Object.prototype.hasOwnProperty.call(
        originalValues,
        field
      )

      return {
        field,
        label: getChangeFieldLabel(field),
        hasPreviousValue,
        previousValue: formatChangeFieldValue(
          field,
          originalValues[field] ?? null
        ),
        nextValue: formatChangeFieldValue(field, changedValues[field] ?? null),
      }
    })
}

async function loadJobChangesData({
  supabase,
  hideMarnyVyjezdy,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  hideMarnyVyjezdy: boolean
}): Promise<JobChangesModalData> {
  const nextWorkWeekEnd = getNextWorkWeekEnd()
  const to = `${nextWorkWeekEnd}T23:59:59`
  const relationFields =
    'id, job_number, company_name, site_address, start_at, end_at, generator_name, technician_name, evidence_status, marny_vyjezd'

  const [newJobsResponse, updatedJobsResponse] = await Promise.all([
    supabase
      .from('job_changes_queue')
      .select(`job_id, kind, changed_fields, original_values, changed_values, changed_fields_label, updated_at, jobs!inner(${relationFields})`)
      .eq('kind', 'new_job')
      .lte('jobs.start_at', to),
    supabase
      .from('job_changes_queue')
      .select(`job_id, kind, changed_fields, original_values, changed_values, changed_fields_label, updated_at, jobs!inner(${relationFields})`)
      .eq('kind', 'updated_job')
      .eq('jobs.evidence_status', 'zapsano')
      .order('updated_at', { ascending: false }),
  ])

  if (newJobsResponse.error) {
    throw new Error('Nepodařilo se načíst nové zakázky pro změny.')
  }
  if (updatedJobsResponse.error) {
    throw new Error('Nepodařilo se načíst provedené změny.')
  }

  const newJobs = ((newJobsResponse.data ?? []) as unknown as JobChangeQueueRow[])
    .map((row) => ({ row, job: getJobRelation(row.jobs) }))
    .filter(
      (entry): entry is { row: JobChangeQueueRow; job: JobRelation } =>
        entry.job !== null &&
        (!hideMarnyVyjezdy || !Boolean(entry.job.marny_vyjezd))
    )
    .map(({ row, job }): ChangesNewJobItem => ({
      jobId: job.id,
      jobNumber: job.job_number?.trim() || '—',
      companyName: job.company_name?.trim() || '—',
      siteAddress: job.site_address?.trim() || '—',
      startAt: job.start_at,
      endAt: job.end_at,
      generatorName: job.generator_name?.trim() || '—',
      technicianName: job.technician_name?.trim() || '—',
      evidenceStatus: job.evidence_status === 'zapsano' ? 'zapsano' : 'nove',
      updatedAt: row.updated_at,
    }))
    .sort((first, second) => {
      const firstStart = first.startAt ? Date.parse(first.startAt) : Number.POSITIVE_INFINITY
      const secondStart = second.startAt ? Date.parse(second.startAt) : Number.POSITIVE_INFINITY
      if (firstStart !== secondStart) return firstStart - secondStart
      const firstEnd = first.endAt ? Date.parse(first.endAt) : Number.POSITIVE_INFINITY
      const secondEnd = second.endAt ? Date.parse(second.endAt) : Number.POSITIVE_INFINITY
      if (firstEnd !== secondEnd) return firstEnd - secondEnd
      return first.jobNumber.localeCompare(second.jobNumber, 'cs', { sensitivity: 'base' })
    })

  const updatedJobs = ((updatedJobsResponse.data ?? []) as unknown as JobChangeQueueRow[])
    .map((row) => ({
      row,
      job: getJobRelation(row.jobs),
      changes: toUpdatedChanges(row),
      legacyDescription: row.changed_fields_label?.trim() || null,
    }))
    .filter(
      (entry): entry is {
        row: JobChangeQueueRow
        job: JobRelation
        changes: ChangesUpdatedJobItem['changes']
        legacyDescription: string | null
      } =>
        entry.job !== null &&
        (entry.changes.length > 0 || entry.legacyDescription !== null) &&
        (!hideMarnyVyjezdy || !Boolean(entry.job.marny_vyjezd))
    )
    .map(({ row, job, changes, legacyDescription }): ChangesUpdatedJobItem => ({
      jobId: job.id,
      jobNumber: job.job_number?.trim() || '—',
      changes,
      legacyDescription: changes.length === 0 ? legacyDescription : null,
      updatedAt: row.updated_at,
    }))

  return {
    newJobs,
    updatedJobs,
    badgeCount: newJobs.length + updatedJobs.length,
  }
}

export async function getJobsChangesModalDataAction(): Promise<
  JobChangesActionResult<JobChangesModalData>
> {
  const { supabase, user, error: accessError, hideMarnyVyjezdy } =
    await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  try {
    return {
      success: true,
      error: null,
      data: await loadJobChangesData({ supabase, hideMarnyVyjezdy }),
    }
  } catch (error) {
    console.error(error)
    await reportActionError({
      error,
      action: 'getJobsChangesModalDataAction',
      section: 'jobs',
      errorType: 'JobsChangesModalDataActionError',
      userId: user.id,
    })
    return {
      success: false,
      error: 'Nepodařilo se načíst data modalu změn.',
    }
  }
}

export async function getJobsChangesBadgeCountAction(): Promise<
  JobChangesActionResult<{ badgeCount: number }>
> {
  const { supabase, user, error: accessError, hideMarnyVyjezdy } =
    await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  try {
    const data = await loadJobChangesData({ supabase, hideMarnyVyjezdy })

    return {
      success: true,
      error: null,
      data: {
        badgeCount: data.badgeCount,
      },
    }
  } catch (error) {
    console.error(error)
    await reportActionError({
      error,
      action: 'getJobsChangesBadgeCountAction',
      section: 'jobs',
      errorType: 'JobsChangesBadgeCountActionError',
      userId: user.id,
    })
    return {
      success: false,
      error: 'Nepodařilo se načíst počet změn zakázek.',
    }
  }
}

export async function saveJobChangesModalAction(
  selection: SaveJobChangesSelection
): Promise<
  JobChangesActionResult<{ removedNewJobs: number; removedUpdatedJobs: number }>
> {
  const { supabase, user, error: accessError } = await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  try {
    const requestedNewJobIds = Array.from(
      new Set((selection.acknowledgedNewJobIds ?? []).map((id) => String(id).trim()).filter(Boolean))
    )
    let removedNewJobs = 0

    if (requestedNewJobIds.length > 0) {
      const { data: writtenJobs, error: writtenJobsError } = await supabase
        .from('jobs')
        .select('id')
        .in('id', requestedNewJobIds)
        .eq('evidence_status', 'zapsano')

      if (writtenJobsError) {
        return { success: false, error: 'Nepodařilo se ověřit zapsané zakázky.' }
      }

      const writtenJobIds = (writtenJobs ?? []).map((row) => String(row.id))
      if (writtenJobIds.length > 0) {
        const { data: removedRows, error: removeNewError } = await supabase
          .from('job_changes_queue')
          .delete()
          .eq('kind', 'new_job')
          .in('job_id', writtenJobIds)
          .select('job_id')

        if (removeNewError) {
          return { success: false, error: 'Nepodařilo se odebrat zapsané zakázky z přehledu.' }
        }
        removedNewJobs = removedRows?.length ?? 0
      }
    }

    let removedUpdatedJobs = 0
    for (const item of selection.acknowledgedUpdatedJobs ?? []) {
      const jobId = String(item.jobId ?? '').trim()
      const updatedAt = String(item.updatedAt ?? '').trim()
      if (!jobId || !updatedAt) continue

      const { data: removedRows, error: removeUpdatedError } = await supabase
        .from('job_changes_queue')
        .delete()
        .eq('kind', 'updated_job')
        .eq('job_id', jobId)
        .eq('updated_at', updatedAt)
        .select('job_id')

      if (removeUpdatedError) {
        return { success: false, error: 'Nepodařilo se odebrat označené změny.' }
      }
      removedUpdatedJobs += removedRows?.length ?? 0
    }

    revalidatePath('/jobs')

    return {
      success: true,
      error: null,
      data: {
        removedNewJobs,
        removedUpdatedJobs,
      },
    }
  } catch (error) {
    console.error(error)
    await reportActionError({
      error,
      action: 'saveJobChangesModalAction',
      section: 'jobs',
      errorType: 'SaveJobChangesModalActionError',
      userId: user.id,
    })
    return {
      success: false,
      error: 'Nepodařilo se uložit stav modalu změn.',
    }
  }
}
