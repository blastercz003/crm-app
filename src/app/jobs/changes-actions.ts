'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { reportActionError } from '@/lib/errors/reportActionError'

type ProfilePermissionRow = {
  can_view_jobs: boolean | null
  role: string | null
}

type JobChangeStateRow = {
  cleared_at: string | null
}

type NewJobRow = {
  id: string
  job_number: string | null
  company_name: string | null
  site_address: string | null
  start_at: string | null
  end_at: string | null
  generator_name: string | null
  technician_name: string | null
  evidence_status: string | null
  updated_at: string
}

type UpdatedJobQueueRow = {
  job_id: string
  changed_fields_label: string | null
  updated_at: string
  jobs:
    | {
        id: string
        job_number: string | null
        evidence_status: string | null
      }
    | Array<{
        id: string
        job_number: string | null
        evidence_status: string | null
      }>
    | null
}

type UpdatedJobRelation = {
  id: string
  job_number: string | null
  evidence_status: string | null
}

function getUpdatedJobRelation(value: UpdatedJobQueueRow['jobs']): UpdatedJobRelation | null {
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
  changedFieldsLabel: string
  updatedAt: string
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

function getWorkWeekRange(offsetWeeks = 0) {
  const today = getPragueTodayParts()
  const pragueDateAsUtc = new Date(
    Date.UTC(today.year, today.month - 1, today.day, 12, 0, 0)
  )

  const day = pragueDateAsUtc.getUTCDay()
  const mondayOffset = day === 0 ? -6 : 1 - day
  const monday = addDaysUtc(pragueDateAsUtc, mondayOffset + offsetWeeks * 7)
  const friday = addDaysUtc(monday, 4)

  return {
    from: toDateOnly(monday),
    to: toDateOnly(friday),
  }
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
    }
  }

  const typedProfile = profile as ProfilePermissionRow | null
  const isAdmin = typedProfile?.role === 'admin'

  if (!isAdmin && !typedProfile?.can_view_jobs) {
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

async function getClearedAt(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data, error } = await supabase
    .from('job_changes_state')
    .select('cleared_at')
    .eq('id', true)
    .single()

  if (error || !data) {
    throw new Error('Nepodařilo se načíst stav vyčištění změn.')
  }

  const state = data as JobChangeStateRow
  return state.cleared_at ?? '1970-01-01T00:00:00.000Z'
}

export async function getJobsChangesModalDataAction(): Promise<
  JobChangesActionResult<JobChangesModalData>
> {
  const { supabase, user, error: accessError } = await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  try {
    const clearedAt = await getClearedAt(supabase)

    const currentWeek = getWorkWeekRange(0)
    const nextWeek = getWorkWeekRange(1)

    const from = `${currentWeek.from}T00:00:00`
    const to = `${nextWeek.to}T23:59:59`

    const [newJobsResponse, updatedJobsResponse] = await Promise.all([
      supabase
        .from('jobs')
        .select(
          'id, job_number, company_name, site_address, start_at, end_at, generator_name, technician_name, evidence_status, updated_at'
        )
        .eq('evidence_status', 'nove')
        .gte('start_at', from)
        .lte('start_at', to)
        .order('start_at', { ascending: true })
        .order('end_at', { ascending: true })
        .order('job_number', { ascending: true }),
      supabase
        .from('job_changes_queue')
        .select(
          'job_id, changed_fields_label, updated_at, jobs!inner(id, job_number, evidence_status)'
        )
        .eq('kind', 'updated_job')
        .gt('updated_at', clearedAt)
        .eq('jobs.evidence_status', 'zapsano')
        .order('updated_at', { ascending: false }),
    ])

    if (newJobsResponse.error) {
      return {
        success: false,
        error: 'Nepodařilo se načíst nové zakázky pro změny.',
      }
    }

    if (updatedJobsResponse.error) {
      return {
        success: false,
        error: 'Nepodařilo se načíst provedené změny.',
      }
    }

    const newJobs: ChangesNewJobItem[] = ((newJobsResponse.data ?? []) as NewJobRow[])
      .map((row) => ({
        evidenceStatus:
          row.evidence_status === 'zapsano' ? ('zapsano' as const) : ('nove' as const),
        jobId: row.id,
        jobNumber: row.job_number?.trim() || '—',
        companyName: row.company_name?.trim() || '—',
        siteAddress: row.site_address?.trim() || '—',
        startAt: row.start_at ?? null,
        endAt: row.end_at ?? null,
        generatorName: row.generator_name?.trim() || '—',
        technicianName: row.technician_name?.trim() || '—',
        updatedAt: row.updated_at,
      }))

    const updatedJobs = ((updatedJobsResponse.data ?? []) as UpdatedJobQueueRow[])
      .map((row) => ({
        row,
        jobRelation: getUpdatedJobRelation(row.jobs),
      }))
      .filter((entry) => entry.jobRelation !== null)
      .map((row) => ({
        jobId: row.row.job_id,
        jobNumber: row.jobRelation?.job_number?.trim() || '—',
        changedFieldsLabel: row.row.changed_fields_label?.trim() || 'Bez detailu',
        updatedAt: row.row.updated_at,
      }))

    return {
      success: true,
      error: null,
      data: {
        newJobs,
        updatedJobs,
        badgeCount: newJobs.length + updatedJobs.length,
      },
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

export async function acknowledgeAllJobChangesAction(): Promise<
  JobChangesActionResult<{ acknowledged: true }>
> {
  const { supabase, user, error: accessError } = await requireJobsAccess()

  if (!user) {
    return {
      success: false,
      error: accessError,
    }
  }

  try {
    const currentWeek = getWorkWeekRange(0)
    const nextWeek = getWorkWeekRange(1)

    const from = `${currentWeek.from}T00:00:00`
    const to = `${nextWeek.to}T23:59:59`

    const { data: newJobsRows, error: newJobsError } = await supabase
      .from('jobs')
      .select('id')
      .eq('evidence_status', 'nove')
      .gte('start_at', from)
      .lte('start_at', to)

    if (newJobsError) {
      return {
        success: false,
        error: 'Nepodařilo se načíst nové zakázky pro zaevidování.',
      }
    }

    const newJobIds = (newJobsRows ?? [])
      .map((row) => String((row as { id: string }).id ?? '').trim())
      .filter(Boolean)

    if (newJobIds.length > 0) {
      const { error: updateEvidenceError } = await supabase
        .from('jobs')
        .update({
          evidence_status: 'zapsano',
        })
        .in('id', newJobIds)

      if (updateEvidenceError) {
        return {
          success: false,
          error: 'Nepodařilo se hromadně přepnout nové zakázky na ZAPSANO.',
        }
      }
    }

    const now = new Date().toISOString()

    const { error: clearError } = await supabase
      .from('job_changes_state')
      .update({
        cleared_at: now,
        cleared_by: user.id,
        updated_at: now,
      })
      .eq('id', true)

    if (clearError) {
      return {
        success: false,
        error: 'Nepodařilo se vyčistit seznam změn.',
      }
    }

    revalidatePath('/jobs')

    return {
      success: true,
      error: null,
      data: {
        acknowledged: true,
      },
    }
  } catch (error) {
    console.error(error)
    await reportActionError({
      error,
      action: 'acknowledgeAllJobChangesAction',
      section: 'jobs',
      errorType: 'AcknowledgeAllJobChangesActionError',
      userId: user.id,
    })
    return {
      success: false,
      error: 'Nepodařilo se potvrdit zaevidování změn.',
    }
  }
}
