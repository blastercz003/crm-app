'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { canViewAssetsSection } from '@/lib/majetek/access'

const ASSET_FILES_BUCKET = 'asset-files'
const MAX_UPLOAD_FILE_SIZE_BYTES = 25 * 1024 * 1024

export type AssetAttachmentUploadActionState = {
  success: boolean
  error: string | null
  uploadedCount?: number
}

export type DeleteAssetDocumentActionState = {
  success: boolean
  error: string | null
}

type ProfilePermissionRow = {
  role: string | null
  majetek: boolean | null
}

type AssetRow = {
  id: string
  category_id: string
}

type AssetCategoryRow = {
  id: string
  icon_key: string
}

function buildFailure(error: string): AssetAttachmentUploadActionState {
  return { success: false, error }
}

function buildSuccess(uploadedCount: number): AssetAttachmentUploadActionState {
  return { success: true, error: null, uploadedCount }
}

function buildDeleteDocumentFailure(error: string): DeleteAssetDocumentActionState {
  return { success: false, error }
}

function buildDeleteDocumentSuccess(): DeleteAssetDocumentActionState {
  return { success: true, error: null }
}

function normalizeText(value: FormDataEntryValue | null) {
  return String(value ?? '').trim()
}

function normalizeOptionalText(value: FormDataEntryValue | null) {
  const text = normalizeText(value)
  return text.length > 0 ? text : null
}

function sanitizeFileName(fileName: string) {
  const normalized = fileName
    .normalize('NFKD')
    .replaceAll(/[\u0300-\u036f]/g, '')

  return normalized
    .replaceAll(/[^A-Za-z0-9._-]+/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
    .slice(0, 120)
}

function stripFileExtension(fileName: string) {
  const trimmed = fileName.trim()
  return trimmed.replace(/\.[^.]+$/, '')
}

async function requireAssetsAdmin() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, majetek')
    .eq('id', user.id)
    .single()

  if (error || !profile) {
    return { supabase, error: 'Nepodařilo se ověřit oprávnění uživatele.' as const }
  }

  const typedProfile = profile as ProfilePermissionRow
  if (!canViewAssetsSection(typedProfile.role, typedProfile)) {
    return { supabase, error: 'Nemáš oprávnění spravovat majetek.' as const }
  }

  return { supabase, userId: user.id, error: null }
}

async function requireAsset(
  supabase: Awaited<ReturnType<typeof createClient>>,
  assetId: string,
) {
  const { data, error } = await supabase
    .from('assets')
    .select('id, category_id')
    .eq('id', assetId)
    .maybeSingle<AssetRow>()

  if (error) {
    throw new Error('Nepodařilo se ověřit majetek.')
  }

  if (!data) {
    throw new Error('Vybraný majetek neexistuje.')
  }

  return data
}

async function requireAssetCategory(
  supabase: Awaited<ReturnType<typeof createClient>>,
  categoryId: string,
) {
  const { data, error } = await supabase
    .from('asset_categories')
    .select('id, icon_key')
    .eq('id', categoryId)
    .maybeSingle<AssetCategoryRow>()

  if (error) {
    throw new Error('Nepodařilo se ověřit kategorii majetku.')
  }

  if (!data) {
    throw new Error('Vybraná kategorie neexistuje.')
  }

  return data
}

function buildStoragePath(params: {
  assetId: string
  kind: 'documents' | 'photos'
  fileName: string
}) {
  const safeName = sanitizeFileName(params.fileName) || 'soubor'
  return `majetek/${params.assetId}/${params.kind}/${crypto.randomUUID()}-${safeName}`
}

export async function uploadAssetDocumentsAction(
  _prevState: AssetAttachmentUploadActionState,
  formData: FormData
): Promise<AssetAttachmentUploadActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildFailure(auth.error)

  const assetId = normalizeText(formData.get('asset_id'))
  if (!assetId) return buildFailure('Chybí ID majetku.')

  const documentTypeId = normalizeText(formData.get('document_type_id'))
  if (!documentTypeId) return buildFailure('Vyber typ dokumentu.')

  const note = normalizeOptionalText(formData.get('note'))
  const files = formData.getAll('files').filter((file): file is File => file instanceof File)

  if (files.length === 0) {
    return buildFailure('Vyber alespoň jeden PDF soubor.')
  }

  try {
    const asset = await requireAsset(auth.supabase, assetId)
    const category = await requireAssetCategory(auth.supabase, asset.category_id)

    if (category.icon_key === 'car' || category.icon_key === 'cpu') {
      // documents are still allowed for all categories, just keep the type check in place
    }

    const uploadRows: Array<{ id: string; storage_path: string }> = []
    const uploadedPaths: string[] = []

    try {
      for (const file of files) {
        const mimeType = String(file.type ?? '').trim().toLowerCase()
        const isPdf = mimeType === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

        if (!isPdf) {
          throw new Error(`Soubor "${file.name}" není PDF.`)
        }

        if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
          throw new Error(`Soubor "${file.name}" je příliš velký.`)
        }

        const storagePath = buildStoragePath({
          assetId,
          kind: 'documents',
          fileName: file.name,
        })

        const contentType = mimeType || 'application/pdf'
        const buffer = Buffer.from(await file.arrayBuffer())

        const { error: uploadError } = await auth.supabase.storage
          .from(ASSET_FILES_BUCKET)
          .upload(storagePath, buffer, {
            cacheControl: '3600',
            upsert: false,
            contentType,
          })

        if (uploadError) {
          throw new Error(`Soubor "${file.name}" se nepodařilo nahrát (${uploadError.message}).`)
        }

        uploadedPaths.push(storagePath)

        const { data: inserted, error: insertError } = await auth.supabase
          .from('asset_documents')
          .insert({
            asset_id: assetId,
            document_type_id: documentTypeId,
            title: stripFileExtension(file.name) || file.name,
            file_name: file.name,
            storage_bucket: ASSET_FILES_BUCKET,
            storage_path: storagePath,
            mime_type: contentType,
            file_size_bytes: file.size,
            note,
            uploaded_by: auth.userId,
          })
          .select('id, storage_path')
          .single<{ id: string; storage_path: string }>()

        if (insertError || !inserted) {
          throw new Error(`Metadata souboru "${file.name}" se nepodařilo uložit.`)
        }

        uploadRows.push({ id: inserted.id, storage_path: inserted.storage_path })
      }
    } catch (uploadError) {
      if (uploadedPaths.length > 0) {
        await auth.supabase.storage.from(ASSET_FILES_BUCKET).remove(uploadedPaths)
      }

      if (uploadRows.length > 0) {
        await auth.supabase
          .from('asset_documents')
          .delete()
          .in('id', uploadRows.map((row) => row.id))
      }

      throw uploadError
    }
  } catch (error) {
    return buildFailure(error instanceof Error ? error.message : 'Dokumenty se nepodařilo nahrát.')
  }

  revalidatePath('/majetek')
  revalidatePath(`/majetek/${assetId}`)

  return buildSuccess(files.length)
}

export async function uploadAssetPhotosAction(
  _prevState: AssetAttachmentUploadActionState,
  formData: FormData
): Promise<AssetAttachmentUploadActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildFailure(auth.error)

  const assetId = normalizeText(formData.get('asset_id'))
  if (!assetId) return buildFailure('Chybí ID majetku.')

  const note = normalizeOptionalText(formData.get('note'))
  const files = formData.getAll('files').filter((file): file is File => file instanceof File)

  if (files.length === 0) {
    return buildFailure('Vyber alespoň jednu fotku.')
  }

  try {
    await requireAsset(auth.supabase, assetId)

    const uploadRows: Array<{ id: string; storage_path: string }> = []
    const uploadedPaths: string[] = []

    try {
      for (const file of files) {
        const mimeType = String(file.type ?? '').trim().toLowerCase()
        const isImage = mimeType.startsWith('image/')

        if (!isImage) {
          throw new Error(`Soubor "${file.name}" není obrázek.`)
        }

        if (file.size > MAX_UPLOAD_FILE_SIZE_BYTES) {
          throw new Error(`Soubor "${file.name}" je příliš velký.`)
        }

        const storagePath = buildStoragePath({
          assetId,
          kind: 'photos',
          fileName: file.name,
        })

        const contentType = mimeType || 'image/jpeg'
        const buffer = Buffer.from(await file.arrayBuffer())

        const { error: uploadError } = await auth.supabase.storage
          .from(ASSET_FILES_BUCKET)
          .upload(storagePath, buffer, {
            cacheControl: '3600',
            upsert: false,
            contentType,
          })

        if (uploadError) {
          throw new Error(`Fotka "${file.name}" se nepodařilo nahrát (${uploadError.message}).`)
        }

        uploadedPaths.push(storagePath)

        const { data: inserted, error: insertError } = await auth.supabase
          .from('asset_photos')
          .insert({
            asset_id: assetId,
            title: stripFileExtension(file.name) || file.name,
            file_name: file.name,
            storage_bucket: ASSET_FILES_BUCKET,
            storage_path: storagePath,
            mime_type: contentType,
            file_size_bytes: file.size,
            note,
            uploaded_by: auth.userId,
          })
          .select('id, storage_path')
          .single<{ id: string; storage_path: string }>()

        if (insertError || !inserted) {
          throw new Error(`Metadata fotky "${file.name}" se nepodařilo uložit.`)
        }

        uploadRows.push({ id: inserted.id, storage_path: inserted.storage_path })
      }
    } catch (uploadError) {
      if (uploadedPaths.length > 0) {
        await auth.supabase.storage.from(ASSET_FILES_BUCKET).remove(uploadedPaths)
      }

      if (uploadRows.length > 0) {
        await auth.supabase
          .from('asset_photos')
          .delete()
          .in('id', uploadRows.map((row) => row.id))
      }

      throw uploadError
    }
  } catch (error) {
    return buildFailure(error instanceof Error ? error.message : 'Fotky se nepodařilo nahrát.')
  }

  revalidatePath('/majetek')
  revalidatePath(`/majetek/${assetId}`)

  return buildSuccess(files.length)
}

export async function deleteAssetDocumentAction(
  _prevState: DeleteAssetDocumentActionState,
  formData: FormData
): Promise<DeleteAssetDocumentActionState> {
  const auth = await requireAssetsAdmin()
  if (auth.error) return buildDeleteDocumentFailure(auth.error)

  const assetId = normalizeText(formData.get('asset_id'))
  if (!assetId) return buildDeleteDocumentFailure('Chybí ID majetku.')

  const documentId = normalizeText(formData.get('document_id'))
  if (!documentId) return buildDeleteDocumentFailure('Chybí ID dokumentu.')

  try {
    await requireAsset(auth.supabase, assetId)
  } catch (error) {
    return buildDeleteDocumentFailure(error instanceof Error ? error.message : 'Majetek není dostupný.')
  }

  const { data: documentRow, error: rowError } = await auth.supabase
    .from('asset_documents')
    .select('id, asset_id, storage_bucket, storage_path')
    .eq('id', documentId)
    .eq('asset_id', assetId)
    .single()

  if (rowError || !documentRow) {
    return buildDeleteDocumentFailure('Dokument nebyl nalezen.')
  }

  const typedRow = documentRow as {
    id: string
    asset_id: string
    storage_bucket: string
    storage_path: string
  }

  const { error: storageError } = await auth.supabase.storage
    .from(String(typedRow.storage_bucket))
    .remove([String(typedRow.storage_path)])

  if (storageError) {
    return buildDeleteDocumentFailure('Soubor se nepodařilo smazat ze storage.')
  }

  const { error: deleteError } = await auth.supabase
    .from('asset_documents')
    .delete()
    .eq('id', typedRow.id)

  if (deleteError) {
    return buildDeleteDocumentFailure('Metadata dokumentu se nepodařilo smazat.')
  }

  revalidatePath('/majetek')
  revalidatePath(`/majetek/${assetId}`)

  return buildDeleteDocumentSuccess()
}
