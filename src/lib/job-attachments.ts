export type JobAttachmentCategory = 'predavaci_protokol' | 'foto' | 'jine'

export type JobAttachmentRow = {
  id: string
  job_id: string
  file_name: string
  display_name: string
  storage_bucket: string
  storage_path: string
  mime_type: string | null
  file_size_bytes: number
  category: JobAttachmentCategory
  note: string | null
  uploaded_by: string | null
  created_at: string
}

export type JobAttachment = {
  id: string
  jobId: string
  fileName: string
  displayName: string
  storageBucket: string
  storagePath: string
  mimeType: string | null
  fileSizeBytes: number
  category: JobAttachmentCategory
  note: string | null
  uploadedBy: string | null
  createdAt: string
}

export const JOB_ATTACHMENTS_BUCKET = 'job-attachments'
export const MAX_ATTACHMENT_FILE_SIZE_BYTES = 5 * 1024 * 1024
export const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

export const JOB_ATTACHMENT_CATEGORIES: JobAttachmentCategory[] = [
  'predavaci_protokol',
  'foto',
  'jine',
]

export function isJobAttachmentCategory(value: unknown): value is JobAttachmentCategory {
  return JOB_ATTACHMENT_CATEGORIES.includes(value as JobAttachmentCategory)
}

export function sanitizeAttachmentFileName(value: string) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ')
  const safe = normalized.replace(/[^a-zA-Z0-9._\-() ,'!*$&@=;:+?]/g, '_')
  return safe.length > 0 ? safe : 'soubor'
}

export function buildAttachmentStoragePath(jobId: string, fileName: string) {
  const safeName = sanitizeAttachmentFileName(fileName)
  return `job/${jobId}/${crypto.randomUUID()}-${safeName}`
}

export function mapJobAttachmentRow(row: JobAttachmentRow): JobAttachment {
  return {
    id: String(row.id),
    jobId: String(row.job_id),
    fileName: String(row.file_name ?? ''),
    displayName: String(row.display_name ?? row.file_name ?? ''),
    storageBucket: String(row.storage_bucket ?? ''),
    storagePath: String(row.storage_path ?? ''),
    mimeType: row.mime_type,
    fileSizeBytes: Number(row.file_size_bytes) || 0,
    category: row.category,
    note: row.note,
    uploadedBy: row.uploaded_by,
    createdAt: String(row.created_at ?? ''),
  }
}
