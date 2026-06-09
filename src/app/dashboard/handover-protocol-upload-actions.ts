'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  buildAttachmentStoragePath,
  JOB_ATTACHMENTS_BUCKET,
  MAX_ATTACHMENT_FILE_SIZE_BYTES,
} from '@/lib/job-attachments'
import { optimizeUploadFile } from '@/lib/uploads/optimize-upload-file'

type ProfileAccessRow = {
  role: string | null
  can_view_handover_protocol_upload: boolean | null
}

type JobAssignmentRow = {
  job_id: string
}

type HandoverProtocolAttachmentJobRow = {
  job_id: string
}

type ActionResult<T> =
  | {
      success: true
      error: null
      data: T
    }
  | {
      success: false
      error: string
      data: null
    }

type HandoverProtocolJobRow = {
  id: string
  job_number: string
  company_name: string
  site_address: string | null
  start_at: string | null
  show_in_handover_protocol_upload: boolean | null
}

type HandoverProtocolUploadFlagRow = {
  show_in_handover_protocol_upload: boolean | null
}

function normalizeFiles(formData: FormData) {
  return formData.getAll('files').filter((file): file is File => file instanceof File)
}

function formatPragueDateYmd(value: string | null | undefined) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Prague',
  }).format(date)
}

async function requireHandoverProtocolUploadAccess() {
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

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, can_view_handover_protocol_upload')
    .eq('id', user.id)
    .single()

  if (error) {
    return {
      supabase,
      user: null,
      error: 'Nepodařilo se ověřit oprávnění.',
    }
  }

  const typedProfile = profile as ProfileAccessRow | null
  const canAccess =
    typedProfile?.role === 'TECHNIK' ||
    Boolean(typedProfile?.can_view_handover_protocol_upload)

  if (!canAccess) {
    return {
      supabase,
      user: null,
      error: 'Nemáš oprávnění pro nahrávání Předávacího protokolu.',
    }
  }

  return {
    supabase,
    user,
    error: null,
  }
}

async function getAssignedJobIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string
) {
  const { data, error } = await supabase
    .from('job_technicians')
    .select('job_id')
    .eq('technician_id', userId)

  if (error) {
    throw new Error(`Nepodařilo se načíst přiřazené zakázky: ${error.message}`)
  }

  return Array.from(
    new Set(
      ((data ?? []) as JobAssignmentRow[])
        .map((row) => String(row.job_id ?? '').trim())
        .filter((jobId) => Boolean(jobId))
    )
  )
}

async function isUploadAllowedForJob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
) {
  const { data, error } = await supabase
    .from('jobs')
    .select('show_in_handover_protocol_upload')
    .eq('id', jobId)
    .single()

  if (error) {
    throw new Error(`Nepodařilo se ověřit zakázku: ${error.message}`)
  }

  return Boolean((data as HandoverProtocolUploadFlagRow | null)?.show_in_handover_protocol_upload)
}

async function hasHandoverProtocolAttachment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
) {
  const { data, error } = await supabase
    .from('job_attachments')
    .select('job_id')
    .eq('job_id', jobId)
    .eq('category', 'predavaci_protokol')
    .limit(1)

  if (error) {
    throw new Error(`Nepodařilo se ověřit existující Předávací protokol: ${error.message}`)
  }

  return (data ?? []).length > 0
}

export async function uploadHandoverProtocolAttachmentsAction(
  jobId: string,
  formData: FormData
): Promise<ActionResult<{ uploadedCount: number }>> {
  try {
    const { supabase, user, error } = await requireHandoverProtocolUploadAccess()

    if (!user) {
      return { success: false, error: error ?? 'Neautorizovaný přístup.', data: null }
    }

    const normalizedJobId = String(jobId ?? '').trim()
    if (!normalizedJobId) {
      return { success: false, error: 'Vyber zakázku.', data: null }
    }

    const assignedJobIds = await getAssignedJobIds(supabase, user.id)
    if (!assignedJobIds.includes(normalizedJobId)) {
      return {
        success: false,
        error: 'Tato zakázka není přiřazená k tvému účtu.',
        data: null,
      }
    }

    const isAllowed = await isUploadAllowedForJob(supabase, normalizedJobId)
    if (!isAllowed) {
      return {
        success: false,
        error: 'Tato zakázka už není určená pro nahrávání Předávacího protokolu.',
        data: null,
      }
    }

    const alreadyHasAttachment = await hasHandoverProtocolAttachment(supabase, normalizedJobId)
    if (alreadyHasAttachment) {
      return {
        success: false,
        error: 'Tato zakázka už má nahraný Předávací protokol.',
        data: null,
      }
    }

    const files = normalizeFiles(formData)

    if (files.length === 0) {
      return { success: false, error: 'Vyber alespoň jeden soubor.', data: null }
    }

    const createdPaths: string[] = []

    for (const file of files) {
      const optimizedFile = await optimizeUploadFile(file)

      if (optimizedFile.size > MAX_ATTACHMENT_FILE_SIZE_BYTES) {
        return {
          success: false,
          error: `Soubor "${file.name}" překračuje limit 5 MB i po optimalizaci.`,
          data: null,
        }
      }

      const mimeType = String(optimizedFile.type ?? file.type ?? '').trim().toLowerCase()
      if (!mimeType || !ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
        return {
          success: false,
          error: `Soubor "${file.name}" má nepodporovaný typ.`,
          data: null,
        }
      }

      const storagePath = buildAttachmentStoragePath(normalizedJobId, optimizedFile.name)
      const contentType = String(optimizedFile.type ?? '').trim() || 'application/octet-stream'
      const uploadBuffer = Buffer.from(await optimizedFile.arrayBuffer())

      const { error: uploadError } = await supabase.storage
        .from(JOB_ATTACHMENTS_BUCKET)
        .upload(storagePath, uploadBuffer, {
          cacheControl: '3600',
          upsert: false,
          contentType,
        })

      if (uploadError) {
        return {
          success: false,
          error: `Soubor "${file.name}" se nepodařilo nahrát (${uploadError.message}).`,
          data: null,
        }
      }

      const { error: insertError } = await supabase.from('job_attachments').insert({
        job_id: normalizedJobId,
        file_name: optimizedFile.name,
        display_name: optimizedFile.name,
        storage_bucket: JOB_ATTACHMENTS_BUCKET,
        storage_path: storagePath,
        mime_type: contentType,
        file_size_bytes: optimizedFile.size,
        category: 'predavaci_protokol',
        note: null,
        uploaded_by: user.id,
      })

      if (insertError) {
        await supabase.storage.from(JOB_ATTACHMENTS_BUCKET).remove([storagePath])
        return {
          success: false,
          error: `Metadata souboru "${file.name}" se nepodařilo uložit.`,
          data: null,
        }
      }

      createdPaths.push(storagePath)
    }

    revalidatePath('/dashboard')
    revalidatePath('/faktury')
    revalidatePath('/soubory')

    return {
      success: true,
      error: null,
      data: { uploadedCount: createdPaths.length },
    }
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : 'Neznámá chyba.'
    return {
      success: false,
      error: `Nahrávání selhalo (${message}).`,
      data: null,
    }
  }
}

export type HandoverProtocolUploadJobOption = {
  id: string
  jobNumber: string
  companyName: string
  siteAddress: string | null
  startAt: string | null
  showInHandoverProtocolUpload: boolean
}

export async function getHandoverProtocolUploadJobOptions(
  userId: string
): Promise<HandoverProtocolUploadJobOption[]> {
  const supabase = await createClient()
  const todayYmd = formatPragueDateYmd(new Date().toISOString())

  const assignedJobIds = await getAssignedJobIds(supabase, userId)
  if (assignedJobIds.length === 0) {
    return []
  }

  const { data: jobsData, error: jobsError } = await supabase
    .from('jobs')
    .select('id, job_number, company_name, site_address, start_at, show_in_handover_protocol_upload')
    .in('id', assignedJobIds)
    .order('job_number', { ascending: false })

  if (jobsError) {
    throw new Error(`Nepodařilo se načíst zakázky pro nahrávání PP: ${jobsError.message}`)
  }

  const jobs = (jobsData ?? []) as HandoverProtocolJobRow[]
  const { data: attachmentRows, error: attachmentError } = await supabase
    .from('job_attachments')
    .select('job_id')
    .eq('category', 'predavaci_protokol')
    .in('job_id', assignedJobIds)

  if (attachmentError) {
    throw new Error(`Nepodařilo se načíst existující Předávací protokoly: ${attachmentError.message}`)
  }

  const attachedJobIds = new Set(
    ((attachmentRows ?? []) as HandoverProtocolAttachmentJobRow[]).map((row) =>
      String(row.job_id ?? '').trim()
    )
  )

  return jobs
    .filter((job) => Boolean(job.show_in_handover_protocol_upload))
    .filter((job) => !attachedJobIds.has(job.id))
    .filter((job) => {
      const jobDateYmd = formatPragueDateYmd(job.start_at)
      if (!jobDateYmd || !todayYmd) return false
      return jobDateYmd <= todayYmd
    })
    .map((job) => ({
      id: String(job.id),
      jobNumber: String(job.job_number ?? '').trim(),
      companyName: String(job.company_name ?? '').trim(),
      siteAddress: job.site_address,
      startAt: job.start_at,
      showInHandoverProtocolUpload: Boolean(job.show_in_handover_protocol_upload),
    }))
    .filter((job) => Boolean(job.id) && Boolean(job.jobNumber) && Boolean(job.companyName))
}
