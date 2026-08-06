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

type UserIdRow = {
  user_id: string
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
  pohotovost
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
      .select('user_id')
      .eq('enabled', true)
      .is('disabled_at', null),
    supabase
      .from('dispatcher_job_google_calendar_integrations')
      .select('user_id')
      .eq('enabled', true)
      .is('disabled_at', null),
  ])

  if (feedsResponse.error) {
    throw new Error(`Nepodařilo se načíst aktivní dispečerské feedy: ${feedsResponse.error.message}`)
  }
  if (googleResponse.error) {
    throw new Error(`Nepodařilo se načíst aktivní Google kalendáře: ${googleResponse.error.message}`)
  }

  return {
    feedUserIds: Array.from(
      new Set(((feedsResponse.data ?? []) as UserIdRow[]).map((row) => row.user_id))
    ),
    googleUserIds: Array.from(
      new Set(((googleResponse.data ?? []) as UserIdRow[]).map((row) => row.user_id))
    ),
  }
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
  const { feedUserIds, googleUserIds } = await getActiveDispatcherCalendarUsers()

  await settleCalendarOperations([
    ...feedUserIds.map((userId) =>
      syncDispatcherJobCalendarItem({ jobId: job.id, userId, job })
    ),
    ...googleUserIds.map((userId) =>
      syncDispatcherGoogleCalendarItem({ userId, job })
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
  const { feedUserIds, googleUserIds } = await getActiveDispatcherCalendarUsers()

  await settleCalendarOperations([
    ...feedUserIds.map((userId) =>
      cancelDispatcherJobCalendarItem({ jobId, userId })
    ),
    ...googleUserIds.map((userId) =>
      cancelDispatcherGoogleCalendarItem({ jobId, userId })
    ),
  ])
}
