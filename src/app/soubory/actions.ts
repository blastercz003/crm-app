'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canViewFilesSection } from '@/lib/files/access'

export type JobAttachmentCategory = 'predavaci_protokol' | 'foto' | 'jine'

const JOB_ATTACHMENTS_BUCKET = 'job-attachments'
const MAX_ATTACHMENT_FILE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])
const JOB_ATTACHMENT_CATEGORIES: JobAttachmentCategory[] = [
  'predavaci_protokol',
  'foto',
  'jine',
]

type ProfileRoleRow = { role: string | null }
type ProfileFileAccessRow = ProfileRoleRow & {
  can_view_job_attachments: boolean | null
}

function sanitizeAttachmentFileName(value: string) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ')
  const safe = normalized.replace(/[^a-zA-Z0-9._\-() ,'!*$&@=;:+?]/g, '_')
  return safe.length > 0 ? safe : 'soubor'
}

function buildAttachmentStoragePath(jobId: string, fileName: string) {
  const safeName = sanitizeAttachmentFileName(fileName)
  return `job/${jobId}/${crypto.randomUUID()}-${safeName}`
}

function isJobAttachmentCategory(value: unknown): value is JobAttachmentCategory {
  return JOB_ATTACHMENT_CATEGORIES.includes(value as JobAttachmentCategory)
}

async function requireFilesAccess() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, user: null, error: 'Nejsi přihlášený.' }
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, can_view_job_attachments')
    .eq('id', user.id)
    .single()

  if (error) {
    return { supabase, user: null, error: 'Nepodařilo se ověřit oprávnění.' }
  }

  const typed = profile as ProfileFileAccessRow | null
  if (!canViewFilesSection(typed?.role, typed)) {
    return { supabase, user: null, error: 'Nemáš oprávnění pro sekci Soubory.' }
  }

  return { supabase, user, profile: typed, error: null }
}

export async function uploadFilesToJobAction(formData: FormData) {
  try {
    const { supabase, user, error } = await requireFilesAccess()
    if (!user) {
      return { success: false, error: error ?? 'Neautorizovaný přístup.' }
    }

    const jobId = String(formData.get('job_id') ?? '').trim()
    if (!jobId) {
      return { success: false, error: 'Vyber zakázku (složku).' }
    }

    const categoryValue = String(formData.get('category') ?? '').trim()
    const category: JobAttachmentCategory = isJobAttachmentCategory(categoryValue)
      ? categoryValue
      : 'predavaci_protokol'

    const noteValue = String(formData.get('note') ?? '').trim()
    const note = noteValue.length > 0 ? noteValue : null

    const { data: jobRow, error: jobError } = await supabase
      .from('jobs')
      .select('id')
      .eq('id', jobId)
      .single()

    if (jobError || !jobRow) {
      return { success: false, error: 'Zakázka neexistuje.' }
    }

    const files = formData.getAll('files').filter((file): file is File => file instanceof File)
    if (files.length === 0) {
      return { success: false, error: 'Vyber alespoň jeden soubor.' }
    }

    const createdRows: Array<{ id: string; storagePath: string }> = []

    for (const file of files) {
      if (file.size > MAX_ATTACHMENT_FILE_SIZE_BYTES) {
        return { success: false, error: `Soubor \"${file.name}\" překračuje limit 5 MB.` }
      }
      const mimeType = String(file.type ?? '').trim().toLowerCase()
      if (!mimeType || !ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
        return { success: false, error: `Soubor \"${file.name}\" má nepodporovaný typ.` }
      }

      const storagePath = buildAttachmentStoragePath(jobId, file.name)
      const contentType = String(file.type ?? '').trim() || 'application/octet-stream'

      const { error: uploadError } = await supabase.storage
        .from(JOB_ATTACHMENTS_BUCKET)
        .upload(storagePath, file, {
          cacheControl: '3600',
          upsert: false,
          contentType,
        })

      if (uploadError) {
        return { success: false, error: `Soubor \"${file.name}\" se nepodařilo nahrát (${uploadError.message}).` }
      }

      const { data: inserted, error: insertError } = await supabase
        .from('job_attachments')
        .insert({
          job_id: jobId,
          file_name: file.name,
          display_name: file.name,
          storage_bucket: JOB_ATTACHMENTS_BUCKET,
          storage_path: storagePath,
          mime_type: contentType,
          file_size_bytes: file.size,
          category,
          note,
          uploaded_by: user.id,
        })
        .select('id')
        .single()

      if (insertError || !inserted) {
        await supabase.storage.from(JOB_ATTACHMENTS_BUCKET).remove([storagePath])
        return { success: false, error: `Metadata souboru \"${file.name}\" se nepodařilo uložit.` }
      }

      createdRows.push({ id: String((inserted as { id: string }).id), storagePath })
    }

    revalidatePath('/soubory')
    revalidatePath('/faktury')

    return { success: true, error: null, uploadedCount: createdRows.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Neznámá chyba.'
    return { success: false, error: `Nahrávání selhalo (${message}).` }
  }
}

export async function getAttachmentPreviewUrlAction(attachmentId: string) {
  const { supabase, user, error } = await requireFilesAccess()
  if (!user) {
    return { success: false, error: error ?? 'Neautorizovaný přístup.', signedUrl: null }
  }

  const { data: row, error: rowError } = await supabase
    .from('job_attachments')
    .select('id, storage_bucket, storage_path')
    .eq('id', String(attachmentId ?? '').trim())
    .single()

  if (rowError || !row) {
    return { success: false, error: 'Soubor nebyl nalezen.', signedUrl: null }
  }

  const { data: signed, error: signedError } = await supabase.storage
    .from(String((row as { storage_bucket: string }).storage_bucket))
    .createSignedUrl(String((row as { storage_path: string }).storage_path), 60 * 10)

  if (signedError || !signed?.signedUrl) {
    return { success: false, error: 'Nepodařilo se získat náhled.', signedUrl: null }
  }

  return { success: true, error: null, signedUrl: signed.signedUrl }
}

export async function getAttachmentDownloadLinksAction(attachmentIds: string[]) {
  const { supabase, user, error } = await requireFilesAccess()
  if (!user) {
    return { success: false, error: error ?? 'Neautorizovaný přístup.', items: [] as Array<{ id: string; name: string; url: string }> }
  }

  const normalizedIds = Array.from(new Set((attachmentIds ?? []).map((id) => String(id).trim()).filter(Boolean)))
  if (normalizedIds.length === 0) {
    return { success: false, error: 'Nebyly vybrány žádné soubory.', items: [] as Array<{ id: string; name: string; url: string }> }
  }

  const { data, error: rowsError } = await supabase
    .from('job_attachments')
    .select('id, display_name, storage_bucket, storage_path')
    .in('id', normalizedIds)

  if (rowsError) {
    return { success: false, error: 'Nepodařilo se načíst soubory ke stažení.', items: [] as Array<{ id: string; name: string; url: string }> }
  }

  const items: Array<{ id: string; name: string; url: string }> = []

  for (const rawRow of (data ?? []) as Array<{ id: string; display_name: string; storage_bucket: string; storage_path: string }>) {
    const { data: signed, error: signedError } = await supabase.storage
      .from(String(rawRow.storage_bucket))
      .createSignedUrl(String(rawRow.storage_path), 60 * 10)

    if (!signedError && signed?.signedUrl) {
      items.push({
        id: String(rawRow.id),
        name: String(rawRow.display_name ?? 'soubor'),
        url: signed.signedUrl,
      })
    }
  }

  if (items.length === 0) {
    return { success: false, error: 'Nepodařilo se získat odkazy ke stažení.', items }
  }

  return { success: true, error: null, items }
}

export async function deleteAttachmentsAction(attachmentIds: string[]) {
  const { supabase, user, error } = await requireFilesAccess()
  if (!user) {
    return { success: false, error: error ?? 'Neautorizovaný přístup.' }
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: string | null }>()

  if (profile?.role !== 'admin') {
    return { success: false, error: 'Nemáš oprávnění mazat soubory.' }
  }

  const normalizedIds = Array.from(new Set((attachmentIds ?? []).map((id) => String(id).trim()).filter(Boolean)))
  if (normalizedIds.length === 0) {
    return { success: false, error: 'Nebyly vybrány žádné soubory.' }
  }

  const { data, error: rowsError } = await supabase
    .from('job_attachments')
    .select('id, storage_bucket, storage_path')
    .in('id', normalizedIds)

  if (rowsError) {
    return { success: false, error: 'Nepodařilo se načíst soubory ke smazání.' }
  }

  const rows = (data ?? []) as Array<{ id: string; storage_bucket: string; storage_path: string }>

  for (const row of rows) {
    await supabase.storage.from(String(row.storage_bucket)).remove([String(row.storage_path)])
  }

  const { error: deleteError } = await supabase.from('job_attachments').delete().in('id', rows.map((row) => row.id))
  if (deleteError) {
    return { success: false, error: 'Nepodařilo se smazat metadata souborů.' }
  }

  revalidatePath('/soubory')
  revalidatePath('/faktury')

  return { success: true, error: null }
}
