'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getJobPpNotRequiredSet, isJobPpRequired } from '@/lib/jobs/pp-requirements'
import { createNotificationsForAdmins } from '@/lib/notifications/createNotification'
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  buildAttachmentStoragePath,
  mapJobAttachmentRow,
  JOB_ATTACHMENTS_BUCKET,
  MAX_ATTACHMENT_FILE_SIZE_BYTES,
  type JobAttachment,
} from '@/lib/job-attachments'
import { optimizeUploadFile } from '@/lib/uploads/optimize-upload-file'

type ProfileAccessRow = {
  name: string | null
  role: string | null
  can_view_handover_protocol_upload: boolean | null
  can_view_all_technician_handover_uploads: boolean | null
}

type JobAssignmentRow = {
  job_id: string
}

type HandoverProtocolAttachmentJobRow = {
  job_id: string
  created_at: string
}

type HandoverProtocolAttachmentRow = {
  id: string
  job_id: string
  file_name: string
  display_name: string
  storage_bucket: string
  storage_path: string
  mime_type: string | null
  file_size_bytes: number
  category: 'predavaci_protokol' | 'foto' | 'jine'
  note: string | null
  uploaded_by: string | null
  created_at: string
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

export type HandoverProtocolUploadAttachmentListState = ActionResult<{
  items: JobAttachment[]
}>

export type HandoverProtocolUploadAttachmentUrlState =
  | {
      success: true
      error: null
      signedUrl: string
    }
  | {
      success: false
      error: string
      signedUrl: null
    }

type HandoverProtocolJobRow = {
  id: string
  job_number: string
  company_name: string
  site_address: string | null
  start_at: string | null
  end_at: string | null
  show_in_handover_protocol_upload: boolean | null
}

type HandoverProtocolNotificationJobRow = {
  job_number: string
  site_address: string | null
}

const HANDOVER_PROTOCOL_UPLOAD_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000

function normalizeFiles(formData: FormData) {
  return formData.getAll('files').filter((file): file is File => file instanceof File)
}

function getJobAddressLabel(siteAddress: string | null | undefined) {
  return String(siteAddress ?? '')
    .split(',')
    .at(0)
    ?.trim() || 'bez adresy'
}

function formatPragueDateYmd(value: string | Date | null | undefined) {
  if (!value) return null

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Prague',
  }).format(date)
}

function parseDateTime(value: string | null | undefined) {
  if (!value) return null

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function getFirstAttachmentUploadAt(
  attachmentRows: HandoverProtocolAttachmentJobRow[]
) {
  const firstAttachmentAtByJobId = new Map<string, string>()

  for (const row of attachmentRows) {
    const jobId = String(row.job_id ?? '').trim()
    const createdAt = String(row.created_at ?? '').trim()
    if (!jobId || !createdAt) continue

    const existing = firstAttachmentAtByJobId.get(jobId)
    if (!existing) {
      firstAttachmentAtByJobId.set(jobId, createdAt)
      continue
    }

    const existingDate = parseDateTime(existing)
    const nextDate = parseDateTime(createdAt)

    if (!existingDate || !nextDate) continue

    if (nextDate.getTime() < existingDate.getTime()) {
      firstAttachmentAtByJobId.set(jobId, createdAt)
    }
  }

  return firstAttachmentAtByJobId
}

function isHandoverProtocolJobVisible(
  job: HandoverProtocolJobRow,
  firstAttachmentAt: string | null | undefined,
  todayYmd: string,
  now: Date
) {
  if (!job.show_in_handover_protocol_upload) {
    return false
  }

  const jobStartYmd = formatPragueDateYmd(job.start_at)
  if (!jobStartYmd || jobStartYmd > todayYmd) {
    return false
  }

  const firstUploadDate = parseDateTime(firstAttachmentAt)
  if (!firstUploadDate) {
    return true
  }

  const jobEndYmd = formatPragueDateYmd(job.end_at)
  if (!jobEndYmd) {
    return true
  }

  const uploadWindowClosed = now.getTime() >= firstUploadDate.getTime() + HANDOVER_PROTOCOL_UPLOAD_GRACE_PERIOD_MS
  const endDatePassed = todayYmd > jobEndYmd

  return !(uploadWindowClosed && endDatePassed)
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
    .select('name, role, can_view_handover_protocol_upload, can_view_all_technician_handover_uploads')
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
    Boolean(typedProfile?.can_view_handover_protocol_upload) ||
    Boolean(typedProfile?.can_view_all_technician_handover_uploads)

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
    profile: typedProfile,
    error: null,
  }
}

async function getVisibleJobIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  includeAllTechnicians: boolean
) {
  const query = supabase.from('job_technicians').select('job_id')
  const { data, error } = includeAllTechnicians
    ? await query
    : await query.eq('technician_id', userId)

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
  const ppRequired = await isJobPpRequired(supabase, jobId)
  if (!ppRequired) {
    return false
  }

  const { data, error } = await supabase
    .from('jobs')
    .select('show_in_handover_protocol_upload, start_at, end_at')
    .eq('id', jobId)
    .single()

  if (error) {
    throw new Error(`Nepodařilo se ověřit zakázku: ${error.message}`)
  }

  const row = data as HandoverProtocolJobRow | null
  if (!row) {
    return false
  }

  const todayYmd = formatPragueDateYmd(new Date())
  if (!todayYmd) return false

  const { data: attachmentRows, error: attachmentError } = await supabase
    .from('job_attachments')
    .select('job_id, created_at')
    .eq('job_id', jobId)

  if (attachmentError) {
    throw new Error(`Nepodařilo se ověřit existující přílohy: ${attachmentError.message}`)
  }

  const firstAttachmentAtByJobId = getFirstAttachmentUploadAt(
    (attachmentRows ?? []) as HandoverProtocolAttachmentJobRow[]
  )

  return isHandoverProtocolJobVisible(
    row,
    firstAttachmentAtByJobId.get(jobId),
    todayYmd,
    new Date()
  )
}

async function getHandoverProtocolNotificationJob(
  supabase: Awaited<ReturnType<typeof createClient>>,
  jobId: string
) {
  const { data, error } = await supabase
    .from('jobs')
    .select('job_number, site_address')
    .eq('id', jobId)
    .single()

  if (error) {
    throw new Error(`Nepodařilo se načíst údaje zakázky pro notifikaci: ${error.message}`)
  }

  return data as HandoverProtocolNotificationJobRow | null
}

export async function uploadHandoverProtocolAttachmentsAction(
  jobId: string,
  formData: FormData
): Promise<ActionResult<{ uploadedCount: number }>> {
  try {
    const { supabase, user, profile, error } = await requireHandoverProtocolUploadAccess()

    if (!user) {
      return { success: false, error: error ?? 'Neautorizovaný přístup.', data: null }
    }

    const normalizedJobId = String(jobId ?? '').trim()
    if (!normalizedJobId) {
      return { success: false, error: 'Vyber zakázku.', data: null }
    }

    const visibleJobIds = await getVisibleJobIds(
      supabase,
      user.id,
      Boolean(profile?.can_view_all_technician_handover_uploads)
    )
    if (!visibleJobIds.includes(normalizedJobId)) {
      return {
        success: false,
        error: 'K této zakázce nemáš oprávnění nahrávat Předávací protokol.',
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

    const notificationJob = await getHandoverProtocolNotificationJob(supabase, normalizedJobId)
    if (!notificationJob) {
      return {
        success: false,
        error: 'Nepodařilo se načíst údaje zakázky pro notifikaci.',
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

      const { data: insertedRow, error: insertError } = await supabase
        .from('job_attachments')
        .insert({
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
        .select('id')
        .single()

      if (insertError) {
        await supabase.storage.from(JOB_ATTACHMENTS_BUCKET).remove([storagePath])
        return {
          success: false,
          error: `Metadata souboru "${file.name}" se nepodařilo uložit.`,
          data: null,
        }
      }

      if (profile?.role === 'TECHNIK') {
        try {
          const jobNumber = String(notificationJob.job_number ?? '').trim() || '—'
          const addressLabel = getJobAddressLabel(notificationJob.site_address)
          const uploaderName = String(profile?.name ?? '').trim() || 'technik'
          const attachmentId = String((insertedRow as { id?: string } | null)?.id ?? '').trim()

          await createNotificationsForAdmins({
            supabase,
            actorUserId: user.id,
            category: 'jobs',
            type: 'job_handover_protocol_uploaded',
            title: 'NAHRANÝ PP',
            message: `Technik ${uploaderName} nahrál nový PP k zakázce ${jobNumber} ${addressLabel}.`,
            entityType: 'job_attachment',
            entityId: attachmentId || null,
            href: '/faktury',
            priority: 'normal',
            dedupeKey: `job_handover_protocol_uploaded:${attachmentId || storagePath}`,
            skipSelfNotification: false,
          })
        } catch (notificationError) {
          console.error('Nepodařilo se odeslat notifikaci o nahraném PP.', notificationError)
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

export async function getMyHandoverProtocolUploadJobOptionsAction(): Promise<
  HandoverProtocolUploadJobOption[]
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Uživatel není přihlášen.')
  }

  return getHandoverProtocolUploadJobOptions(user.id)
}

export async function getHandoverProtocolUploadJobOptions(
  userId: string
): Promise<HandoverProtocolUploadJobOption[]> {
  const supabase = await createClient()
  const todayYmd = formatPragueDateYmd(new Date())
  const now = new Date()

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, can_view_handover_protocol_upload, can_view_all_technician_handover_uploads')
    .eq('id', userId)
    .single()

  if (profileError) {
    throw new Error(`Nepodařilo se ověřit oprávnění pro nahrávání PP: ${profileError.message}`)
  }

  const typedProfile = profile as ProfileAccessRow | null
  const includeAllTechnicians = Boolean(typedProfile?.can_view_all_technician_handover_uploads)

  const visibleJobIds = await getVisibleJobIds(supabase, userId, includeAllTechnicians)
  if (visibleJobIds.length === 0) {
    return []
  }

  const { data: jobsData, error: jobsError } = await supabase
    .from('jobs')
    .select('id, job_number, company_name, site_address, start_at, end_at, show_in_handover_protocol_upload')
    .in('id', visibleJobIds)
    .order('job_number', { ascending: false })

  if (jobsError) {
    throw new Error(`Nepodařilo se načíst zakázky pro nahrávání PP: ${jobsError.message}`)
  }

  const jobs = (jobsData ?? []) as HandoverProtocolJobRow[]
  const { data: attachmentRows, error: attachmentError } = await supabase
    .from('job_attachments')
    .select('job_id, created_at')
    .in('job_id', visibleJobIds)

  if (attachmentError) {
    throw new Error(`Nepodařilo se načíst existující přílohy: ${attachmentError.message}`)
  }

  const firstAttachmentAtByJobId = getFirstAttachmentUploadAt(
    (attachmentRows ?? []) as HandoverProtocolAttachmentJobRow[]
  )
  const jobPpNotRequiredIds = await getJobPpNotRequiredSet(supabase, visibleJobIds)

  return jobs
    .filter((job) =>
      !jobPpNotRequiredIds.has(job.id) &&
      isHandoverProtocolJobVisible(
        job,
        firstAttachmentAtByJobId.get(job.id),
        todayYmd ?? '',
        now
      )
    )
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

export async function getHandoverProtocolUploadAttachmentsAction(
  jobId: string
): Promise<HandoverProtocolUploadAttachmentListState> {
  const { supabase, user, profile, error } =
    await requireHandoverProtocolUploadAccess()

  if (!user) {
    return { success: false, error: error ?? 'Neautorizovaný přístup.', data: null }
  }

  const normalizedJobId = String(jobId ?? '').trim()
  if (!normalizedJobId) {
    return { success: false, error: 'Vyber zakázku.', data: null }
  }

  const visibleJobIds = await getVisibleJobIds(
    supabase,
    user.id,
    Boolean(profile?.can_view_all_technician_handover_uploads)
  )

  if (!visibleJobIds.includes(normalizedJobId)) {
    return {
      success: false,
      error: 'K této zakázce nemáš oprávnění nahlížet do příloh.',
      data: null,
    }
  }

  const { data, error: attachmentsError } = await supabase
    .from('job_attachments')
    .select(
      'id, job_id, file_name, display_name, storage_bucket, storage_path, mime_type, file_size_bytes, category, note, uploaded_by, created_at'
    )
    .eq('job_id', normalizedJobId)
    .order('created_at', { ascending: false })

  if (attachmentsError) {
    return {
      success: false,
      error: 'Přílohy se nepodařilo načíst.',
      data: null,
    }
  }

  return {
    success: true,
    error: null,
    data: {
      items: ((data ?? []) as HandoverProtocolAttachmentRow[]).map(
        mapJobAttachmentRow
      ),
    },
  }
}

async function getHandoverProtocolUploadAttachmentUrl(
  attachmentId: string,
  download: boolean
): Promise<HandoverProtocolUploadAttachmentUrlState> {
  const { supabase, user, profile, error } =
    await requireHandoverProtocolUploadAccess()

  if (!user) {
    return { success: false, error: error ?? 'Neautorizovaný přístup.', signedUrl: null }
  }

  const normalizedAttachmentId = String(attachmentId ?? '').trim()
  if (!normalizedAttachmentId) {
    return { success: false, error: 'Chybí ID přílohy.', signedUrl: null }
  }

  const { data: attachmentRow, error: attachmentError } = await supabase
    .from('job_attachments')
    .select('job_id, storage_bucket, storage_path, display_name')
    .eq('id', normalizedAttachmentId)
    .single()

  if (attachmentError || !attachmentRow) {
    return { success: false, error: 'Příloha nebyla nalezena.', signedUrl: null }
  }

  const typedAttachmentRow = attachmentRow as {
    job_id: string
    storage_bucket: string
    storage_path: string
    display_name: string | null
  }

  const visibleJobIds = await getVisibleJobIds(
    supabase,
    user.id,
    Boolean(profile?.can_view_all_technician_handover_uploads)
  )

  if (!visibleJobIds.includes(String(typedAttachmentRow.job_id ?? '').trim())) {
    return {
      success: false,
      error: 'K této příloze nemáš oprávnění.',
      signedUrl: null,
    }
  }

  const { data, error: signedError } = await supabase.storage
    .from(String(typedAttachmentRow.storage_bucket))
    .createSignedUrl(String(typedAttachmentRow.storage_path), 60, download
      ? {
          download: String(typedAttachmentRow.display_name ?? '').trim() || undefined,
        }
      : undefined)

  if (signedError || !data?.signedUrl) {
    return {
      success: false,
      error: download
        ? 'Nepodařilo se vytvořit odkaz pro stažení přílohy.'
        : 'Nepodařilo se vytvořit odkaz pro otevření přílohy.',
      signedUrl: null,
    }
  }

  return {
    success: true,
    error: null,
    signedUrl: data.signedUrl,
  }
}

export async function openHandoverProtocolUploadAttachmentAction(
  attachmentId: string
): Promise<HandoverProtocolUploadAttachmentUrlState> {
  return getHandoverProtocolUploadAttachmentUrl(attachmentId, false)
}

export async function downloadHandoverProtocolUploadAttachmentAction(
  attachmentId: string
): Promise<HandoverProtocolUploadAttachmentUrlState> {
  return getHandoverProtocolUploadAttachmentUrl(attachmentId, true)
}
