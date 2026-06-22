export type FileAccessFlags = {
  can_view_job_attachments: boolean | null
}

export function canViewFilesSection(
  role: string | null | undefined,
  flags?: Partial<FileAccessFlags> | null
) {
  return role === 'admin' || Boolean(flags?.can_view_job_attachments)
}
