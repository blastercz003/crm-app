'use server'

import { randomUUID } from 'crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { logUserActivity } from '@/lib/activity-log/logUserActivity'
import {
  getPersistedJobInfoAlert,
  normalizeJobInfoText,
} from './info-note-shared'

const JOB_INFO_MEDIA_BUCKET = 'job-info-media'
const MAX_IMAGE_SIZE_BYTES = 1 * 1024 * 1024
const MAX_ATTACHMENTS_PER_JOB = 5

type ProfileAccessRow = {
  role: string | null
  can_view_jobs: boolean | null
  can_view_jobs_portal: boolean | null
}

type AttachmentRow = {
  id: string
  job_id: string
  file_path: string
  file_name: string
  mime_type: string
  size_bytes: number
  created_at: string
}

function normalizeJobId(jobId: string) {
  return String(jobId ?? '').trim()
}

function sanitizeFileName(fileName: string) {
  const trimmed = fileName.trim()
  if (!trimmed) return 'photo.jpg'
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '_')
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

async function syncJobInfoAlertState(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
) {
  const [{ data: jobData, error: jobError }, { count, error: countError }] =
    await Promise.all([
      supabase
        .from('jobs')
        .select('info_note, info_alert_enabled')
        .eq('id', jobId)
        .maybeSingle(),
      supabase
        .from('job_info_attachments')
        .select('id', { count: 'exact', head: true })
        .eq('job_id', jobId),
    ])

  if (jobError || countError || !jobData) {
    return
  }

  const infoNote = normalizeJobInfoText(
    (jobData as { info_note?: string | null }).info_note
  )
  const infoAlertEnabled = Boolean(
    (jobData as { info_alert_enabled?: boolean | null }).info_alert_enabled
  )
  const nextAlertEnabled = getPersistedJobInfoAlert({
    requestedAlertEnabled: infoAlertEnabled,
    infoNote,
    hasAttachments: (count ?? 0) > 0,
  })

  if (nextAlertEnabled === infoAlertEnabled) {
    return
  }

  await supabase
    .from('jobs')
    .update({ info_alert_enabled: nextAlertEnabled })
    .eq('id', jobId)
}

async function requireJobsAccess() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, user: null, error: 'Nejsi přihlášený.' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, can_view_jobs, can_view_jobs_portal')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return {
      supabase,
      user: null,
      error: 'Nepodařilo se ověřit oprávnění uživatele.',
    }
  }

  const typedProfile = profile as ProfileAccessRow
  const hasAccess =
    typedProfile.role === 'admin' ||
    typedProfile.can_view_jobs === true ||
    typedProfile.can_view_jobs_portal === true

  if (!hasAccess) {
    return {
      supabase,
      user: null,
      error: 'Nemáš oprávnění upravovat zakázky.',
    }
  }

  return { supabase, user, error: null }
}

export async function getJobInfoAttachmentsAction(jobId: string) {
  const { supabase, user, error: accessError } = await requireJobsAccess()

  if (!user) {
    return { success: false, error: accessError, items: [] }
  }

  const normalizedJobId = normalizeJobId(jobId)
  if (!normalizedJobId) {
    return { success: false, error: 'Chybí ID zakázky.', items: [] }
  }

  const { data, error } = await supabase
    .from('job_info_attachments')
    .select('id, job_id, file_path, file_name, mime_type, size_bytes, created_at')
    .eq('job_id', normalizedJobId)
    .order('created_at', { ascending: false })

  if (error) {
    return { success: false, error: 'Nepodařilo se načíst fotky.', items: [] }
  }

  const rows = (data ?? []) as AttachmentRow[]

  const signedItems = await Promise.all(
    rows.map(async (row) => {
      const { data: signedData } = await supabase.storage
        .from(JOB_INFO_MEDIA_BUCKET)
        .createSignedUrl(row.file_path, 60 * 60)

      return {
        id: row.id,
        jobId: row.job_id,
        fileName: row.file_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        createdAt: row.created_at,
        signedUrl: signedData?.signedUrl ?? null,
      }
    })
  )

  return {
    success: true,
    error: null,
    items: signedItems,
  }
}

export async function uploadJobInfoAttachmentAction(jobId: string, formData: FormData) {
  const { supabase, user, error: accessError } = await requireJobsAccess()

  if (!user) {
    return { success: false, error: accessError }
  }

  const normalizedJobId = normalizeJobId(jobId)
  if (!normalizedJobId) {
    return { success: false, error: 'Chybí ID zakázky.' }
  }

  const jobNumberForLog = await getJobNumberForLog(supabase, normalizedJobId)

  const files = formData
    .getAll('photos')
    .filter((entry): entry is File => entry instanceof File)
    .filter((file) => file.size > 0)

  if (files.length === 0) {
    return { success: false, error: 'Nebyl vybrán soubor.' }
  }

  const { count, error: countError } = await supabase
    .from('job_info_attachments')
    .select('id', { count: 'exact', head: true })
    .eq('job_id', normalizedJobId)

  if (countError) {
    return { success: false, error: 'Nepodařilo se ověřit počet fotek.' }
  }

  const existingCount = count ?? 0
  if (existingCount + files.length > MAX_ATTACHMENTS_PER_JOB) {
    return {
      success: false,
      error: 'K zakázce lze nahrát maximálně 5 fotek.',
    }
  }

  for (const fileEntry of files) {
    if (!fileEntry.type.startsWith('image/')) {
      return { success: false, error: 'Povolené jsou pouze obrázky.' }
    }

    if (fileEntry.size > MAX_IMAGE_SIZE_BYTES) {
      return {
        success: false,
        error: 'Vyber správnou velikost souboru (max. 1 MB).',
      }
    }
  }

  const uploadedPaths: string[] = []

  for (const fileEntry of files) {
    const safeName = sanitizeFileName(fileEntry.name)
    const filePath = `${normalizedJobId}/${randomUUID()}-${safeName}`

    const { error: uploadError } = await supabase.storage
      .from(JOB_INFO_MEDIA_BUCKET)
      .upload(filePath, fileEntry, {
        upsert: false,
        contentType: fileEntry.type,
        cacheControl: '3600',
      })

    if (uploadError) {
      if (uploadedPaths.length > 0) {
        await supabase.storage.from(JOB_INFO_MEDIA_BUCKET).remove(uploadedPaths)
      }
      return { success: false, error: 'Nepodařilo se nahrát fotku.' }
    }

    const { error: insertError } = await supabase.from('job_info_attachments').insert({
      job_id: normalizedJobId,
      file_path: filePath,
      file_name: safeName,
      mime_type: fileEntry.type,
      size_bytes: fileEntry.size,
      uploaded_by: user.id,
    })

    if (insertError) {
      await supabase.storage.from(JOB_INFO_MEDIA_BUCKET).remove([filePath, ...uploadedPaths])
      return { success: false, error: 'Nepodařilo se uložit metadata fotky.' }
    }

    uploadedPaths.push(filePath)
  }

  await logUserActivity({
    action: `Přidal ${files.length} fotku/fotek do info zakázky ${jobNumberForLog || normalizedJobId}`,
    section: 'Zakázky',
    route: '/jobs',
    userId: user.id,
  })

  revalidatePath('/jobs')
  revalidatePath('/jobs-portal')
  revalidatePath('/dashboard')

  return { success: true, error: null }
}

export async function deleteJobInfoAttachmentAction(jobId: string, attachmentId: string) {
  const { supabase, user, error: accessError } = await requireJobsAccess()

  if (!user) {
    return { success: false, error: accessError }
  }

  const normalizedJobId = normalizeJobId(jobId)
  const normalizedAttachmentId = String(attachmentId ?? '').trim()

  if (!normalizedJobId || !normalizedAttachmentId) {
    return { success: false, error: 'Chybí identifikace souboru.' }
  }

  const jobNumberForLog = await getJobNumberForLog(supabase, normalizedJobId)

  const { data: attachment, error: loadError } = await supabase
    .from('job_info_attachments')
    .select('id, job_id, file_path, file_name')
    .eq('id', normalizedAttachmentId)
    .eq('job_id', normalizedJobId)
    .maybeSingle()

  if (loadError || !attachment) {
    return { success: false, error: 'Fotka nebyla nalezena.' }
  }

  const filePath = String((attachment as { file_path?: string }).file_path ?? '').trim()
  const fileName = String((attachment as { file_name?: string }).file_name ?? '').trim()

  if (filePath) {
    await supabase.storage.from(JOB_INFO_MEDIA_BUCKET).remove([filePath])
  }

  const { error: deleteError } = await supabase
    .from('job_info_attachments')
    .delete()
    .eq('id', normalizedAttachmentId)
    .eq('job_id', normalizedJobId)

  if (deleteError) {
    return { success: false, error: 'Fotku se nepodařilo smazat.' }
  }

  await syncJobInfoAlertState(supabase, normalizedJobId)

  await logUserActivity({
    action: `Smazal fotku z info zakázky ${jobNumberForLog || normalizedJobId}: ${fileName || normalizedAttachmentId}`,
    section: 'Zakázky',
    route: '/jobs',
    userId: user.id,
  })

  revalidatePath('/jobs')
  revalidatePath('/jobs-portal')
  revalidatePath('/dashboard')

  return { success: true, error: null }
}
