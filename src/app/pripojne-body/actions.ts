'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { canViewConnectionPointsSection, isAdminRole } from '@/lib/auth/access'
import { reportActionError } from '@/lib/errors/reportActionError'
import { getServiceRoleClient } from '@/lib/supabase/service'
import { optimizeUploadFile } from '@/lib/uploads/optimize-upload-file'

export type ConnectionPointFolderPhotoRow = {
  id: string
  folder_id: string
  upload_id: string
  file_name: string
  display_name: string
  storage_bucket: string
  storage_path: string
  mime_type: string
  file_size_bytes: number
  uploaded_by: string | null
  created_at: string
}

export type ConnectionPointFolderCommentRow = {
  id: string
  folder_id: string
  body: string
  created_by: string | null
  edited_by: string | null
  created_at: string
  updated_at: string
  edited_at: string | null
}

const CONNECTION_POINT_ATTACHMENTS_BUCKET = 'connection-point-attachments'
const CONNECTION_POINT_FOLDER_PHOTOS_PREFIX = 'connection-point-folder'
const MAX_CONNECTION_POINT_FOLDER_PHOTOS_PER_UPLOAD = 5
const MAX_ATTACHMENT_FILE_SIZE_BYTES = 5 * 1024 * 1024
const ALLOWED_FOLDER_IMAGE_MIME_PREFIX = 'image/'

type ProfilePermissionRow = {
  role: string | null
  can_view_connection_points: boolean | null
  can_edit_connection_point_folders: boolean | null
}

function sanitizeAttachmentFileName(value: string) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ')
  const safe = normalized.replace(/[^a-zA-Z0-9._\-() ,'!*$&@=;:+?]/g, '_')
  return safe.length > 0 ? safe : 'soubor'
}

function buildFolderPhotoStoragePath(folderId: string, uploadId: string, fileName: string) {
  const safeName = sanitizeAttachmentFileName(fileName)
  return `${CONNECTION_POINT_FOLDER_PHOTOS_PREFIX}/${folderId}/${uploadId}/${crypto.randomUUID()}-${safeName}`
}

async function requireConnectionPointsAccess() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, user: null, error: 'Nejsi přihlášený.' }
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, can_view_connection_points, can_edit_connection_point_folders')
    .eq('id', user.id)
    .single()

  if (error) {
    return { supabase, user: null, error: 'Nepodařilo se ověřit oprávnění.' }
  }

  const typedProfile = profile as ProfilePermissionRow | null
  if (!canViewConnectionPointsSection(typedProfile?.role ?? null, typedProfile)) {
    return { supabase, user: null, error: 'Nemáš oprávnění pro sekci Přípojné body.' }
  }

  return { supabase, user, error: null, profile: typedProfile }
}

function getConnectionPointsDataClient() {
  return getServiceRoleClient()
}

function normalizeFolderName(value: string) {
  return String(value ?? '').trim().replace(/\s+/g, ' ')
}

async function requireFolderEditAccess() {
  const access = await requireConnectionPointsAccess()

  if (!access.user) {
    return access
  }

  if (isAdminRole(access.profile?.role ?? null) || access.profile?.can_edit_connection_point_folders) {
    return access
  }

  return {
    ...access,
    user: null,
    error: 'Nemáš oprávnění pro úpravu složek v sekci Přípojné body.',
  }
}

export async function createConnectionPointFolderAction(formData: FormData) {
  try {
    const { user, error, supabase } = await requireConnectionPointsAccess()
    if (!user) {
      return { success: false, error: error ?? 'Neautorizovaný přístup.', folderId: null }
    }

    const dataSupabase = getConnectionPointsDataClient() ?? supabase
    if (!dataSupabase) {
      return { success: false, error: 'Chybí klient pro sekci Přípojné body.', folderId: null }
    }

    const rawName = String(formData.get('name') ?? '')
    const name = normalizeFolderName(rawName)

    if (!name) {
      return { success: false, error: 'Zadej název složky.', folderId: null }
    }

    const { data: existing, error: existingError } = await dataSupabase
      .from('connection_point_folders')
      .select('id')
      .ilike('name', name)
      .limit(1)

    if (existingError) {
      return { success: false, error: 'Nepodařilo se ověřit název složky.', folderId: null }
    }

    if ((existing ?? []).length > 0) {
      return { success: false, error: 'Složka s tímto názvem už existuje.', folderId: null }
    }

    const { data: inserted, error: insertError } = await dataSupabase
      .from('connection_point_folders')
      .insert({
        name,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (insertError || !inserted) {
      const code = (insertError as { code?: string } | null | undefined)?.code
      if (code === '23505') {
        return { success: false, error: 'Složka s tímto názvem už existuje.', folderId: null }
      }

      return {
        success: false,
        error: 'Složku se nepodařilo vytvořit.',
        folderId: null,
      }
    }

    revalidatePath('/pripojne-body')
    return { success: true, error: null, folderId: String((inserted as { id: string }).id) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Neznámá chyba.'
    await reportActionError({
      error,
      action: 'createConnectionPointFolderAction',
      section: 'connection-points',
      userId: null,
      context: {
        operation: 'create-folder',
      },
    })
    return { success: false, error: `Vytvoření složky selhalo (${message}).`, folderId: null }
  }
}

export async function renameConnectionPointFolderAction(folderId: string, formData: FormData) {
  try {
    const { user, error, supabase } = await requireFolderEditAccess()
    if (!user) {
      return { success: false, error: error ?? 'Neautorizovaný přístup.' }
    }

    const dataSupabase = getConnectionPointsDataClient() ?? supabase
    if (!dataSupabase) {
      return { success: false, error: 'Chybí klient pro sekci Přípojné body.' }
    }

    const normalizedFolderId = String(folderId ?? '').trim()
    if (!normalizedFolderId) {
      return { success: false, error: 'Složka nebyla nalezena.' }
    }

    const newName = normalizeFolderName(String(formData.get('name') ?? ''))
    if (!newName) {
      return { success: false, error: 'Zadej název složky.' }
    }

    const { data: folderRow, error: folderError } = await dataSupabase
      .from('connection_point_folders')
      .select('id')
      .eq('id', normalizedFolderId)
      .single()

    if (folderError || !folderRow) {
      return { success: false, error: 'Složka nebyla nalezena.' }
    }

    const { data: existingFolders, error: existingError } = await dataSupabase
      .from('connection_point_folders')
      .select('id, name')

    if (existingError) {
      return { success: false, error: 'Nepodařilo se ověřit název složky.' }
    }

    const duplicate = (existingFolders ?? [])
      .filter((row) => String((row as { id: string }).id) !== normalizedFolderId)
      .some((row) => normalizeFolderName(String((row as { name: string }).name ?? '')).toLowerCase() === newName.toLowerCase())

    if (duplicate) {
      return { success: false, error: 'Složka s tímto názvem už existuje.' }
    }

    const { error: updateError } = await dataSupabase
      .from('connection_point_folders')
      .update({
        name: newName,
        updated_at: new Date().toISOString(),
      })
      .eq('id', normalizedFolderId)

    if (updateError) {
      const code = (updateError as { code?: string } | null | undefined)?.code
      if (code === '23505') {
        return { success: false, error: 'Složka s tímto názvem už existuje.' }
      }

      return { success: false, error: 'Složku se nepodařilo přejmenovat.' }
    }

    revalidatePath('/pripojne-body')
    revalidatePath(`/pripojne-body/${normalizedFolderId}`)
    return { success: true, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Neznámá chyba.'
    await reportActionError({
      error,
      action: 'renameConnectionPointFolderAction',
      section: 'connection-points',
      userId: null,
      context: {
        operation: 'rename-folder',
        folderId,
      },
    })
    return { success: false, error: `Přejmenování složky selhalo (${message}).` }
  }
}

export async function deleteConnectionPointFolderAction(folderId: string) {
  try {
    const { user, error, supabase } = await requireFolderEditAccess()
    if (!user) {
      return { success: false, error: error ?? 'Neautorizovaný přístup.' }
    }

    const dataSupabase = getConnectionPointsDataClient() ?? supabase
    if (!dataSupabase) {
      return { success: false, error: 'Chybí klient pro sekci Přípojné body.' }
    }

    const normalizedFolderId = String(folderId ?? '').trim()
    if (!normalizedFolderId) {
      return { success: false, error: 'Složka nebyla nalezena.' }
    }

    const { data: photoRows, error: photosError } = await dataSupabase
      .from('connection_point_folder_photos')
      .select('storage_bucket, storage_path')
      .eq('folder_id', normalizedFolderId)

    if (photosError) {
      return { success: false, error: 'Nepodařilo se načíst soubory ke smazání.' }
    }

    const storageGroups = new Map<string, string[]>()
    for (const row of (photoRows ?? []) as Array<{ storage_bucket: string; storage_path: string }>) {
      const bucket = String(row.storage_bucket ?? CONNECTION_POINT_ATTACHMENTS_BUCKET)
      const path = String(row.storage_path ?? '').trim()
      if (!path) continue
      const items = storageGroups.get(bucket) ?? []
      items.push(path)
      storageGroups.set(bucket, items)
    }

    for (const [bucket, paths] of storageGroups.entries()) {
      const { error: removeError } = await dataSupabase.storage.from(bucket).remove(paths)
      if (removeError) {
        return { success: false, error: 'Nepodařilo se smazat soubory ze storage.' }
      }
    }

    const { error: deleteError } = await dataSupabase
      .from('connection_point_folders')
      .delete()
      .eq('id', normalizedFolderId)

    if (deleteError) {
      return { success: false, error: 'Složku se nepodařilo smazat.' }
    }

    revalidatePath('/pripojne-body')
    revalidatePath(`/pripojne-body/${normalizedFolderId}`)
    return { success: true, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Neznámá chyba.'
    await reportActionError({
      error,
      action: 'deleteConnectionPointFolderAction',
      section: 'connection-points',
      userId: null,
      context: {
        operation: 'delete-folder',
        folderId,
      },
    })
    return { success: false, error: `Mazání složky selhalo (${message}).` }
  }
}

export async function uploadConnectionPointFolderPhotosAction(formData: FormData) {
  let resolvedFolderId = ''
  let resolvedFilesCount = 0

  try {
    const { user, error, supabase } = await requireConnectionPointsAccess()
    if (!user) {
      return { success: false, error: error ?? 'Neautorizovaný přístup.' }
    }

    const dataSupabase = getConnectionPointsDataClient() ?? supabase
    if (!dataSupabase) {
      return { success: false, error: 'Chybí klient pro sekci Přípojné body.' }
    }

    const folderId = String(formData.get('folder_id') ?? '').trim()
    if (!folderId) {
      return { success: false, error: 'Složka nebyla nalezena.' }
    }

    resolvedFolderId = folderId

    const { data: folderRow, error: folderError } = await dataSupabase
      .from('connection_point_folders')
      .select('id')
      .eq('id', folderId)
      .single()

    if (folderError || !folderRow) {
      return { success: false, error: 'Složka nebyla nalezena.' }
    }

    const files = formData.getAll('files').filter((file): file is File => file instanceof File)
    resolvedFilesCount = files.length
    if (files.length === 0) {
      return { success: false, error: 'Vyber alespoň jednu fotku.' }
    }

    if (files.length > MAX_CONNECTION_POINT_FOLDER_PHOTOS_PER_UPLOAD) {
      return {
        success: false,
        error: `Najednou můžeš nahrát maximálně ${MAX_CONNECTION_POINT_FOLDER_PHOTOS_PER_UPLOAD} fotek.`,
      }
    }

    const uploadId = crypto.randomUUID()

    const { error: uploadInsertError } = await dataSupabase
      .from('connection_point_folder_uploads')
      .insert({
        id: uploadId,
        folder_id: folderId,
        uploaded_by: user.id,
      })

    if (uploadInsertError) {
      return { success: false, error: 'Nepodařilo se založit upload skupinu.' }
    }

    const createdPhotoIds: string[] = []

    try {
      for (const file of files) {
        const optimizedFile = await optimizeUploadFile(file)

        if (optimizedFile.size > MAX_ATTACHMENT_FILE_SIZE_BYTES) {
          throw new Error(`Soubor "${file.name}" překračuje limit 5 MB i po optimalizaci.`)
        }

        const mimeType = String(optimizedFile.type ?? file.type ?? '').trim().toLowerCase()
        if (!mimeType || !mimeType.startsWith(ALLOWED_FOLDER_IMAGE_MIME_PREFIX)) {
          throw new Error(`Soubor "${file.name}" má nepodporovaný typ.`)
        }

        const storagePath = buildFolderPhotoStoragePath(folderId, uploadId, optimizedFile.name)
        const contentType = String(optimizedFile.type ?? '').trim() || 'application/octet-stream'
        const uploadBuffer = Buffer.from(await optimizedFile.arrayBuffer())

        const { error: uploadError } = await dataSupabase.storage
          .from(CONNECTION_POINT_ATTACHMENTS_BUCKET)
          .upload(storagePath, uploadBuffer, {
            cacheControl: '3600',
            upsert: false,
            contentType,
          })

        if (uploadError) {
          throw new Error(`Soubor "${file.name}" se nepodařilo nahrát (${uploadError.message}).`)
        }

        const { data: inserted, error: insertError } = await dataSupabase
          .from('connection_point_folder_photos')
          .insert({
            folder_id: folderId,
            upload_id: uploadId,
            file_name: optimizedFile.name,
            display_name: optimizedFile.name,
            storage_bucket: CONNECTION_POINT_ATTACHMENTS_BUCKET,
            storage_path: storagePath,
            mime_type: contentType,
            file_size_bytes: optimizedFile.size,
            uploaded_by: user.id,
          })
          .select('id')
          .single()

        if (insertError || !inserted) {
          throw new Error(`Metadata souboru "${file.name}" se nepodařilo uložit.`)
        }

        createdPhotoIds.push(String((inserted as { id: string }).id))
      }
    } catch (uploadError) {
      const { data: createdRows } = await dataSupabase
        .from('connection_point_folder_photos')
        .select('id, storage_path')
        .eq('upload_id', uploadId)

      const paths = (createdRows ?? []).map((row) => String((row as { storage_path: string }).storage_path))
      if (paths.length > 0) {
        await dataSupabase.storage.from(CONNECTION_POINT_ATTACHMENTS_BUCKET).remove(paths)
      }

      await dataSupabase
        .from('connection_point_folder_photos')
        .delete()
        .eq('upload_id', uploadId)

      await dataSupabase
        .from('connection_point_folder_uploads')
        .delete()
        .eq('id', uploadId)

      const message = uploadError instanceof Error ? uploadError.message : 'Neznámá chyba.'
      return { success: false, error: message }
    }

    revalidatePath('/pripojne-body')
    revalidatePath(`/pripojne-body/${folderId}`)
    return { success: true, error: null, uploadedCount: createdPhotoIds.length }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Neznámá chyba.'
      await reportActionError({
      error,
      action: 'uploadConnectionPointFolderPhotosAction',
      section: 'connection-points',
      userId: null,
      context: {
        operation: 'upload-photos',
        folderId: resolvedFolderId,
        filesCount: resolvedFilesCount,
      },
    })
    return { success: false, error: `Nahrávání fotek selhalo (${message}).` }
  }
}

export async function deleteConnectionPointFolderPhotoAction(photoId: string) {
  try {
    const { user, error, supabase } = await requireFolderEditAccess()
    if (!user) {
      return { success: false, error: error ?? 'Neautorizovaný přístup.' }
    }

    const dataSupabase = getConnectionPointsDataClient() ?? supabase
    if (!dataSupabase) {
      return { success: false, error: 'Chybí klient pro sekci Přípojné body.' }
    }

    const normalizedPhotoId = String(photoId ?? '').trim()
    if (!normalizedPhotoId) {
      return { success: false, error: 'Fotka nebyla nalezena.' }
    }

    const { data: photoRow, error: photoError } = await dataSupabase
      .from('connection_point_folder_photos')
      .select('id, folder_id, upload_id, storage_bucket, storage_path')
      .eq('id', normalizedPhotoId)
      .single()

    if (photoError || !photoRow) {
      return { success: false, error: 'Fotka nebyla nalezena.' }
    }

    const typedPhotoRow = photoRow as {
      folder_id: string
      upload_id: string
      storage_bucket: string
      storage_path: string
    }

    const bucket = String(typedPhotoRow.storage_bucket ?? CONNECTION_POINT_ATTACHMENTS_BUCKET)
    const storagePath = String(typedPhotoRow.storage_path ?? '').trim()
    const folderId = String(typedPhotoRow.folder_id ?? '').trim()
    const uploadId = String(typedPhotoRow.upload_id ?? '').trim()

    if (!storagePath || !folderId || !uploadId) {
      return { success: false, error: 'Fotku se nepodařilo připravit ke smazání.' }
    }

    const { error: storageError } = await dataSupabase.storage.from(bucket).remove([storagePath])
    if (storageError) {
      return { success: false, error: 'Nepodařilo se smazat fotku ze storage.' }
    }

    const { error: deleteError } = await dataSupabase
      .from('connection_point_folder_photos')
      .delete()
      .eq('id', normalizedPhotoId)

    if (deleteError) {
      return { success: false, error: 'Fotku se nepodařilo smazat.' }
    }

    const { data: remainingRows, error: remainingError } = await dataSupabase
      .from('connection_point_folder_photos')
      .select('id')
      .eq('upload_id', uploadId)
      .limit(1)

    if (remainingError) {
      return { success: false, error: 'Nepodařilo se ověřit zbývající fotky.' }
    }

    if ((remainingRows ?? []).length === 0) {
      await dataSupabase
        .from('connection_point_folder_uploads')
        .delete()
        .eq('id', uploadId)
    }

    revalidatePath('/pripojne-body')
    revalidatePath(`/pripojne-body/${folderId}`)
    return { success: true, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Neznámá chyba.'
    await reportActionError({
      error,
      action: 'deleteConnectionPointFolderPhotoAction',
      section: 'connection-points',
      userId: null,
      context: {
        operation: 'delete-photo',
        photoId,
      },
    })
    return { success: false, error: `Smazání fotky selhalo (${message}).` }
  }
}

export async function createConnectionPointFolderCommentAction(folderId: string, formData: FormData) {
  try {
    const { user, error, supabase } = await requireConnectionPointsAccess()
    if (!user) {
      return { success: false, error: error ?? 'Neautorizovaný přístup.' }
    }

    const dataSupabase = getConnectionPointsDataClient() ?? supabase
    if (!dataSupabase) {
      return { success: false, error: 'Chybí klient pro sekci Přípojné body.' }
    }

    const normalizedFolderId = String(folderId ?? '').trim()
    const body = String(formData.get('body') ?? '').trim()

    if (!normalizedFolderId) {
      return { success: false, error: 'Složka nebyla nalezena.' }
    }

    if (!body) {
      return { success: false, error: 'Komentář nesmí být prázdný.' }
    }

    if (body.length > 5000) {
      return { success: false, error: 'Komentář může mít maximálně 5000 znaků.' }
    }

    const { data: folderRow, error: folderError } = await dataSupabase
      .from('connection_point_folders')
      .select('id')
      .eq('id', normalizedFolderId)
      .single()

    if (folderError || !folderRow) {
      return { success: false, error: 'Složka nebyla nalezena.' }
    }

    const { error: insertError } = await dataSupabase
      .from('connection_point_folder_comments')
      .insert({
        folder_id: normalizedFolderId,
        body,
        created_by: user.id,
      })

    if (insertError) {
      return { success: false, error: 'Komentář se nepodařilo uložit.' }
    }

    revalidatePath('/pripojne-body')
    revalidatePath(`/pripojne-body/${normalizedFolderId}`)
    return { success: true, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Neznámá chyba.'
    await reportActionError({
      error,
      action: 'createConnectionPointFolderCommentAction',
      section: 'connection-points',
      userId: null,
      context: {
        operation: 'create-comment',
        folderId,
      },
    })
    return { success: false, error: `Vložení komentáře selhalo (${message}).` }
  }
}

export async function updateConnectionPointFolderCommentAction(commentId: string, formData: FormData) {
  try {
    const { user, error, supabase } = await requireFolderEditAccess()
    if (!user) {
      return { success: false, error: error ?? 'Neautorizovaný přístup.' }
    }

    const dataSupabase = getConnectionPointsDataClient() ?? supabase
    if (!dataSupabase) {
      return { success: false, error: 'Chybí klient pro sekci Přípojné body.' }
    }

    const normalizedCommentId = String(commentId ?? '').trim()
    const body = String(formData.get('body') ?? '').trim()

    if (!normalizedCommentId) {
      return { success: false, error: 'Komentář nebyl nalezen.' }
    }

    if (!body) {
      return { success: false, error: 'Komentář nesmí být prázdný.' }
    }

    if (body.length > 5000) {
      return { success: false, error: 'Komentář může mít maximálně 5000 znaků.' }
    }

    const { data: row, error: rowError } = await dataSupabase
      .from('connection_point_folder_comments')
      .select('folder_id')
      .eq('id', normalizedCommentId)
      .single()

    if (rowError || !row) {
      return { success: false, error: 'Komentář nebyl nalezen.' }
    }

    const now = new Date().toISOString()
    const { error: updateError } = await dataSupabase
      .from('connection_point_folder_comments')
      .update({
        body,
        updated_at: now,
        edited_at: now,
        edited_by: user.id,
      })
      .eq('id', normalizedCommentId)

    if (updateError) {
      return { success: false, error: 'Komentář se nepodařilo upravit.' }
    }

    const folderId = String((row as { folder_id: string }).folder_id)
    revalidatePath('/pripojne-body')
    revalidatePath(`/pripojne-body/${folderId}`)
    return { success: true, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Neznámá chyba.'
    await reportActionError({
      error,
      action: 'updateConnectionPointFolderCommentAction',
      section: 'connection-points',
      userId: null,
      context: {
        operation: 'update-comment',
        commentId,
      },
    })
    return { success: false, error: `Úprava komentáře selhala (${message}).` }
  }
}

export async function deleteConnectionPointFolderCommentAction(commentId: string) {
  try {
    const { user, error, supabase } = await requireFolderEditAccess()
    if (!user) {
      return { success: false, error: error ?? 'Neautorizovaný přístup.' }
    }

    const dataSupabase = getConnectionPointsDataClient() ?? supabase
    if (!dataSupabase) {
      return { success: false, error: 'Chybí klient pro sekci Přípojné body.' }
    }

    const normalizedCommentId = String(commentId ?? '').trim()
    if (!normalizedCommentId) {
      return { success: false, error: 'Komentář nebyl nalezen.' }
    }

    const { data: row, error: rowError } = await dataSupabase
      .from('connection_point_folder_comments')
      .select('folder_id')
      .eq('id', normalizedCommentId)
      .single()

    if (rowError || !row) {
      return { success: false, error: 'Komentář nebyl nalezen.' }
    }

    const { error: deleteError } = await dataSupabase
      .from('connection_point_folder_comments')
      .delete()
      .eq('id', normalizedCommentId)

    if (deleteError) {
      return { success: false, error: 'Komentář se nepodařilo smazat.' }
    }

    const folderId = String((row as { folder_id: string }).folder_id)
    revalidatePath('/pripojne-body')
    revalidatePath(`/pripojne-body/${folderId}`)
    return { success: true, error: null }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Neznámá chyba.'
    await reportActionError({
      error,
      action: 'deleteConnectionPointFolderCommentAction',
      section: 'connection-points',
      userId: null,
      context: {
        operation: 'delete-comment',
        commentId,
      },
    })
    return { success: false, error: `Smazání komentáře selhalo (${message}).` }
  }
}
