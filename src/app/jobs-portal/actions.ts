'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
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

export async function updatePortalJobInfoAction(
  jobId: string,
  _prevState: UpdatePortalJobInfoActionState,
  formData: FormData
): Promise<UpdatePortalJobInfoActionState> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      success: false,
      error: 'Nejsi přihlášený.',
    }
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
  const infoNote = normalizeJobInfoText(formData.get('info_note')?.toString())
  const requestedAlertEnabled = parseJobInfoAlertValue(
    formData.get('info_alert_enabled')
  )

  if (!normalizedJobId) {
    return {
      success: false,
      error: 'Chybí ID zakázky.',
    }
  }

  const { data: jobScopeRow, error: jobScopeError } = await supabase
    .from('jobs')
    .select('sales_owner')
    .eq('id', normalizedJobId)
    .maybeSingle()

  if (jobScopeError || !jobScopeRow) {
    return {
      success: false,
      error: 'Zakázka nebyla nalezena.',
    }
  }

  const jobSalesOwner = String(
    (jobScopeRow as { sales_owner?: string | null }).sales_owner ?? ''
  ).trim()

  if (
    typedProfile.role !== 'admin' &&
    jobSalesOwner &&
    typedProfile.jobs_sales_scope !== jobSalesOwner
  ) {
    return {
      success: false,
      error: 'Nemáš oprávnění upravovat tuto zakázku.',
    }
  }

  const { data: jobStateRow, error: jobStateError } = await supabase
    .from('jobs')
    .select('job_status')
    .eq('id', normalizedJobId)
    .maybeSingle()

  if (jobStateError || !jobStateRow) {
    return {
      success: false,
      error: 'Nepodařilo se ověřit stav zakázky.',
    }
  }

  let hasAttachments = false

  try {
    hasAttachments = await jobHasInfoAttachments(supabase, normalizedJobId)
  } catch {
    return {
      success: false,
      error: 'Nepodařilo se ověřit stav zakázky.',
    }
  }

  const infoAlertEnabled = getPersistedJobInfoAlert({
    requestedAlertEnabled,
    infoNote,
    hasAttachments,
    jobStatus: (jobStateRow as { job_status?: string | null }).job_status ?? null,
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

  revalidatePath('/jobs')
  revalidatePath('/jobs-portal')

  return {
    success: true,
    error: null,
  }
}

export async function updatePortalJobInfoAlertAction(
  jobId: string,
  _prevState: UpdatePortalJobInfoAlertActionState,
  formData: FormData
): Promise<UpdatePortalJobInfoAlertActionState> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      success: false,
      error: 'Nejsi přihlášený.',
    }
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
  const infoNote = normalizeJobInfoText(formData.get('info_note')?.toString())
  const requestedAlertEnabled = parseJobInfoAlertValue(
    formData.get('info_alert_enabled')
  )

  if (!normalizedJobId) {
    return {
      success: false,
      error: 'Chybí ID zakázky.',
    }
  }

  const { data: jobScopeRow, error: jobScopeError } = await supabase
    .from('jobs')
    .select('sales_owner')
    .eq('id', normalizedJobId)
    .maybeSingle()

  if (jobScopeError || !jobScopeRow) {
    return {
      success: false,
      error: 'Zakázka nebyla nalezena.',
    }
  }

  const jobSalesOwner = String(
    (jobScopeRow as { sales_owner?: string | null }).sales_owner ?? ''
  ).trim()

  if (
    typedProfile.role !== 'admin' &&
    jobSalesOwner &&
    typedProfile.jobs_sales_scope !== jobSalesOwner
  ) {
    return {
      success: false,
      error: 'Nemáš oprávnění upravovat tuto zakázku.',
    }
  }

  const { data: jobStateRow, error: jobStateError } = await supabase
    .from('jobs')
    .select('job_status')
    .eq('id', normalizedJobId)
    .maybeSingle()

  if (jobStateError || !jobStateRow) {
    return {
      success: false,
      error: 'Nepodařilo se ověřit stav zakázky.',
    }
  }

  let hasAttachments = false

  try {
    hasAttachments = await jobHasInfoAttachments(supabase, normalizedJobId)
  } catch {
    return {
      success: false,
      error: 'Nepodařilo se ověřit stav zakázky.',
    }
  }

  const infoAlertEnabled = getPersistedJobInfoAlert({
    requestedAlertEnabled,
    infoNote,
    hasAttachments,
    jobStatus: (jobStateRow as { job_status?: string | null }).job_status ?? null,
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

  revalidatePath('/jobs')
  revalidatePath('/jobs-portal')

  return {
    success: true,
    error: null,
  }
}
