import type { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getServiceRoleClient } from '@/lib/supabase/service'
import { canViewConnectionPointsSection } from '@/lib/auth/access'
import { FolderDetailClient } from './folder-detail-client'

export const metadata: Metadata = {
  title: 'Přípojné body',
}

type ProfilePermissionRow = {
  role: string | null
  can_view_connection_points: boolean | null
  can_edit_connection_point_folders: boolean | null
}

type FolderRow = {
  id: string
  name: string
  created_at: string
  updated_at: string
}

type FolderUploadRow = {
  id: string
  folder_id: string
  uploaded_by: string | null
  created_at: string
}

type FolderPhotoRow = {
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

type FolderCommentRow = {
  id: string
  folder_id: string
  body: string
  created_by: string | null
  edited_by: string | null
  created_at: string
  updated_at: string
  edited_at: string | null
}

type ProfileNameRow = {
  id: string
  name: string | null
}

type PageParams = {
  id: string
}

function formatSignedPhotoName(value: string) {
  return String(value ?? '').trim()
}

export default async function ConnectionPointFolderPage({
  params,
}: {
  params: Promise<PageParams>
}) {
  const { id: folderId } = await params
  const normalizedFolderId = String(folderId ?? '').trim()

  if (!normalizedFolderId) {
    notFound()
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, can_view_connection_points, can_edit_connection_point_folders')
    .eq('id', user.id)
    .single()

  if (profileError) {
    throw new Error('Nepodařilo se ověřit oprávnění uživatele.')
  }

  const typedProfile = profile as ProfilePermissionRow | null
  if (!canViewConnectionPointsSection(typedProfile?.role ?? null, typedProfile)) {
    redirect('/dashboard')
  }

  const dataSupabase = getServiceRoleClient() ?? supabase

  const { data: folderData, error: folderError } = await dataSupabase
    .from('connection_point_folders')
    .select('id, name, created_at, updated_at')
    .eq('id', normalizedFolderId)
    .single()

  if (folderError || !folderData) {
    notFound()
  }

  const folder = {
    id: String((folderData as FolderRow).id),
    name: String((folderData as FolderRow).name ?? ''),
    createdAt: String((folderData as FolderRow).created_at ?? ''),
    updatedAt: String((folderData as FolderRow).updated_at ?? ''),
  }

  const { data: uploadRowsData, error: uploadRowsError } = await dataSupabase
    .from('connection_point_folder_uploads')
    .select('id, folder_id, uploaded_by, created_at')
    .eq('folder_id', normalizedFolderId)
    .order('created_at', { ascending: false })

  if (uploadRowsError) {
    throw new Error('Nepodařilo se načíst uploady složky.')
  }

  const uploads = ((uploadRowsData ?? []) as FolderUploadRow[]).map((upload) => ({
    id: String(upload.id),
    folderId: String(upload.folder_id),
    uploadedBy: upload.uploaded_by ? String(upload.uploaded_by) : null,
    createdAt: String(upload.created_at ?? ''),
  }))

  const { data: photoRowsData, error: photoRowsError } = await dataSupabase
    .from('connection_point_folder_photos')
    .select(
      'id, folder_id, upload_id, file_name, display_name, storage_bucket, storage_path, mime_type, file_size_bytes, uploaded_by, created_at'
    )
    .eq('folder_id', normalizedFolderId)
    .order('created_at', { ascending: true })

  if (photoRowsError) {
    throw new Error('Nepodařilo se načíst fotky složky.')
  }

  const photos = (photoRowsData ?? []) as FolderPhotoRow[]

  const { data: commentRowsData, error: commentRowsError } = await dataSupabase
    .from('connection_point_folder_comments')
    .select('id, folder_id, body, created_by, edited_by, created_at, updated_at, edited_at')
    .eq('folder_id', normalizedFolderId)
    .order('created_at', { ascending: false })

  if (commentRowsError) {
    throw new Error('Nepodařilo se načíst komentáře složky.')
  }

  const comments = (commentRowsData ?? []) as FolderCommentRow[]

  const profileIds = Array.from(
    new Set(
      comments
        .flatMap((comment) => [comment.created_by, comment.edited_by])
        .filter(Boolean) as string[]
    )
  )

  const profileNameMap = new Map<string, string>()
  if (profileIds.length > 0) {
    const { data: profileRowsData, error: profileRowsError } = await dataSupabase
      .from('profiles')
      .select('id, name')
      .in('id', profileIds)

    if (profileRowsError) {
      throw new Error('Nepodařilo se načíst autory komentářů.')
    }

    for (const row of (profileRowsData ?? []) as ProfileNameRow[]) {
      profileNameMap.set(String(row.id), String(row.name ?? 'Uživatel'))
    }
  }

  const photoItems = await Promise.all(
    photos.map(async (photo) => {
      const { data: signed, error: signedError } = await dataSupabase.storage
        .from(photo.storage_bucket)
        .createSignedUrl(photo.storage_path, 60 * 60)

      return {
        id: photo.id,
        uploadId: photo.upload_id,
        displayName: photo.display_name || formatSignedPhotoName(photo.file_name),
        fileName: photo.file_name,
        mimeType: photo.mime_type,
        fileSizeBytes: Number(photo.file_size_bytes) || 0,
        createdAt: photo.created_at,
        signedUrl: !signedError ? signed?.signedUrl ?? null : null,
      }
    })
  )

  const uploadGroups = uploads
    .map((upload) => ({
      ...upload,
      photos: photoItems.filter((photo) => photo.uploadId === upload.id),
    }))
    .filter((upload) => upload.photos.length > 0)

  const commentItems = comments.map((comment) => ({
    id: comment.id,
    body: comment.body,
    createdByName: comment.created_by ? profileNameMap.get(comment.created_by) ?? 'Uživatel' : 'Uživatel',
    editedByName: comment.edited_by ? profileNameMap.get(comment.edited_by) ?? 'Uživatel' : null,
    createdAt: comment.created_at,
    updatedAt: comment.updated_at,
    editedAt: comment.edited_at,
    isEdited: Boolean(comment.edited_at),
  }))

  return (
    <FolderDetailClient
      folder={folder}
      uploadGroups={uploadGroups}
      comments={commentItems}
      canEdit={Boolean(typedProfile?.role === 'admin' || typedProfile?.can_edit_connection_point_folders)}
    />
  )
}
