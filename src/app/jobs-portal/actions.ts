'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { syncDispatcherCalendarsForJobId } from '@/lib/jobs/dispatcher-calendar-sync'
import {
  getPersistedJobInfoAlert,
  normalizeJobInfoText,
  parseJobInfoAlertValue,
} from '@/app/jobs/info-note-shared'

export type UpdatePortalJobInfoActionState = {
  success: boolean
  error: string | null
}

export type UpdatePortalJobInfoAlertActionState = {
  success: boolean
  error: string | null
}

type ProfilePermissionRow = {
  can_view_jobs_portal: boolean | null
  jobs_sales_scope: string | null
  role: string | null
}

type PortalJobStateRow = {
  sales_owner: string | null
  job_status: string | null
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

async function persistPortalJobInfo({
  jobId,
  formData,
  saveError,
}: {
  jobId: string
  formData: FormData
  saveError: string
}): Promise<UpdatePortalJobInfoActionState> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Nejsi přihlášený.' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('can_view_jobs_portal, jobs_sales_scope, role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return {
      success: false,
      error: 'Nepodařilo se ověřit oprávnění uživatele.',
    }
  }

  const typedProfile = profile as ProfilePermissionRow
  if (!(typedProfile.role === 'admin' || typedProfile.can_view_jobs_portal === true)) {
    return {
      success: false,
      error: 'Nemáš oprávnění upravovat info zakázky.',
    }
  }

  const normalizedJobId = String(jobId ?? '').trim()
  if (!normalizedJobId) {
    return { success: false, error: 'Chybí ID zakázky.' }
  }

  const infoNote = normalizeJobInfoText(formData.get('info_note')?.toString())
  const requestedAlertEnabled = parseJobInfoAlertValue(
    formData.get('info_alert_enabled')
  )

  const [jobStateResponse, attachmentsResponse] = await Promise.all([
    supabase
      .from('jobs')
      .select('sales_owner, job_status')
      .eq('id', normalizedJobId)
      .maybeSingle(),
    jobHasInfoAttachments(supabase, normalizedJobId)
      .then((hasAttachments) => ({ hasAttachments, error: null }))
      .catch(() => ({ hasAttachments: false, error: true })),
  ])

  if (jobStateResponse.error || !jobStateResponse.data) {
    return { success: false, error: 'Zakázka nebyla nalezena.' }
  }

  if (attachmentsResponse.error) {
    return {
      success: false,
      error: 'Nepodařilo se ověřit stav zakázky.',
    }
  }

  const jobState = jobStateResponse.data as PortalJobStateRow
  const jobSalesOwner = String(jobState.sales_owner ?? '').trim()

  if (
    typedProfile.role !== 'admin' &&
    typedProfile.jobs_sales_scope !== jobSalesOwner
  ) {
    return {
      success: false,
      error: 'Nemáš oprávnění upravovat tuto zakázku.',
    }
  }

  const infoAlertEnabled = getPersistedJobInfoAlert({
    requestedAlertEnabled,
    infoNote,
    hasAttachments: attachmentsResponse.hasAttachments,
    jobStatus: jobState.job_status,
  })

  const { error } = await supabase
    .from('jobs')
    .update({
      info_note: infoNote,
      info_alert_enabled: infoAlertEnabled,
    })
    .eq('id', normalizedJobId)

  if (error) {
    return { success: false, error: saveError }
  }

  try {
    await syncDispatcherCalendarsForJobId(normalizedJobId)
  } catch (calendarError) {
    console.error('Synchronizace dispečerského kalendáře z portálu selhala.', calendarError)
  }

  revalidatePath('/jobs')
  revalidatePath('/jobs-portal')

  return { success: true, error: null }
}

export async function updatePortalJobInfoAction(
  jobId: string,
  _prevState: UpdatePortalJobInfoActionState,
  formData: FormData
): Promise<UpdatePortalJobInfoActionState> {
  return persistPortalJobInfo({
    jobId,
    formData,
    saveError: 'Info k zakázce se nepodařilo uložit.',
  })
}

export async function updatePortalJobInfoAlertAction(
  jobId: string,
  _prevState: UpdatePortalJobInfoAlertActionState,
  formData: FormData
): Promise<UpdatePortalJobInfoAlertActionState> {
  return persistPortalJobInfo({
    jobId,
    formData,
    saveError: 'Alert info zakázky se nepodařilo uložit.',
  })
}
