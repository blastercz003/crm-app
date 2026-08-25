import {
  cancelDispatcherJobCalendarItem,
  syncDispatcherJobCalendarItem,
  type DispatcherCalendarJobRow,
} from './dispatcher-calendar-feed'
import {
  cancelDispatcherGoogleCalendarItem,
  syncDispatcherGoogleCalendarItem,
} from './dispatcher-google-calendar'
import { getServiceRoleClient } from '@/lib/supabase/service'
import {
  isDispatcherCalendarSalesOwner,
  type DispatcherCalendarScope,
} from './dispatcher-calendar-scope'

type CalendarUserRow = {
  user_id: string
  calendar_scope: DispatcherCalendarScope
}

type CalendarProfileRow = {
  id: string
  role: string | null
  can_view_jobs: boolean | null
  can_view_jobs_portal: boolean | null
  jobs_sales_scope: string | null
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

function getServiceClient() {
  const client = getServiceRoleClient()

  if (!client) {
    throw new Error('Chybí Supabase service role client pro synchronizaci kalendářů.')
  }

  return client
}

async function getActiveDispatcherCalendarUsers() {
  const supabase = getServiceClient()
  const [feedsResponse, googleResponse] = await Promise.all([
    supabase
      .from('dispatcher_job_calendar_feeds')
      .select('user_id, calendar_scope')
      .eq('enabled', true)
      .is('disabled_at', null),
    supabase
      .from('dispatcher_job_google_calendar_integrations')
      .select('user_id, calendar_scope')
      .eq('enabled', true)
      .is('disabled_at', null),
  ])

  if (feedsResponse.error) {
    throw new Error(`Nepodařilo se načíst aktivní dispečerské feedy: ${feedsResponse.error.message}`)
  }
  if (googleResponse.error) {
    throw new Error(`Nepodařilo se načíst aktivní Google kalendáře: ${googleResponse.error.message}`)
  }

  const feedRows = (feedsResponse.data ?? []) as CalendarUserRow[]
  const googleRows = (googleResponse.data ?? []) as CalendarUserRow[]
  const userIds = Array.from(
    new Set([...feedRows, ...googleRows].map((row) => row.user_id))
  )
  const { data: profiles, error: profilesError } = userIds.length
    ? await supabase
        .from('profiles')
        .select('id, role, can_view_jobs, can_view_jobs_portal, jobs_sales_scope')
        .in('id', userIds)
    : { data: [], error: null }

  if (profilesError) {
    throw new Error(`Nepodařilo se načíst rozsahy kalendářů: ${profilesError.message}`)
  }

  const profilesById = new Map(
    ((profiles ?? []) as CalendarProfileRow[]).map((profile) => [profile.id, profile])
  )

  const enrich = (row: CalendarUserRow) => ({
    ...row,
    profile: profilesById.get(row.user_id) ?? null,
  })

  return {
    feedUsers: feedRows.map(enrich),
    googleUsers: googleRows.map(enrich),
  }
}

function shouldSyncJob(
  target: CalendarUserRow & { profile: CalendarProfileRow | null },
  job: DispatcherCalendarJobRow
) {
  if (target.calendar_scope === 'all_jobs') {
    const hasAccess =
      target.profile?.role === 'admin' || target.profile?.can_view_jobs === true
    return hasAccess && !job.marny_vyjezd
  }

  return (
    target.profile?.role !== 'admin' &&
    target.profile?.can_view_jobs_portal === true &&
    isDispatcherCalendarSalesOwner(target.profile.jobs_sales_scope) &&
    job.sales_owner === target.profile.jobs_sales_scope
  )
}

async function settleCalendarOperations(operations: Promise<unknown>[]) {
  const results = await Promise.allSettled(operations)
  const errors = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason)

  if (errors.length > 0) {
    throw new AggregateError(errors, 'Některé dispečerské kalendáře se nepodařilo synchronizovat.')
  }
}

export async function syncDispatcherCalendarsForJob(job: DispatcherCalendarJobRow) {
  const { feedUsers, googleUsers } = await getActiveDispatcherCalendarUsers()

  await settleCalendarOperations([
    ...feedUsers.map((target) =>
      shouldSyncJob(target, job)
        ? syncDispatcherJobCalendarItem({
            jobId: job.id,
            userId: target.user_id,
            job,
            calendarScope: target.calendar_scope,
          })
        : cancelDispatcherJobCalendarItem({ jobId: job.id, userId: target.user_id })
    ),
    ...googleUsers.map((target) =>
      shouldSyncJob(target, job)
        ? syncDispatcherGoogleCalendarItem({ userId: target.user_id, job })
        : cancelDispatcherGoogleCalendarItem({ userId: target.user_id, jobId: job.id })
    ),
  ])
}

export async function syncDispatcherCalendarsForJobId(jobId: string) {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('jobs')
    .select(JOB_SELECT)
    .eq('id', jobId)
    .single()

  if (error || !data) {
    throw new Error(
      `Nepodařilo se načíst zakázku pro dispečerské kalendáře: ${error?.message ?? 'Neznámá chyba'}`
    )
  }

  return syncDispatcherCalendarsForJob(data as DispatcherCalendarJobRow)
}

export async function cancelDispatcherCalendarsForJob(jobId: string) {
  const { feedUsers, googleUsers } = await getActiveDispatcherCalendarUsers()

  await settleCalendarOperations([
    ...feedUsers.map((target) =>
      cancelDispatcherJobCalendarItem({ jobId, userId: target.user_id })
    ),
    ...googleUsers.map((target) =>
      cancelDispatcherGoogleCalendarItem({ jobId, userId: target.user_id })
    ),
  ])
}
