export type JobInfoAttachmentItem = {
  id: string
  jobId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  signedUrl: string | null
}

export function normalizeJobInfoText(value: string | null | undefined) {
  return String(value ?? '').trim()
}

export function hasJobInfoText(value: string | null | undefined) {
  return normalizeJobInfoText(value).length > 0
}

export function hasJobInfoContent({
  infoNote,
  hasAttachments = false,
  attachmentsCount,
}: {
  infoNote: string | null | undefined
  hasAttachments?: boolean
  attachmentsCount?: number
}) {
  if (hasJobInfoText(infoNote)) {
    return true
  }

  if (typeof attachmentsCount === 'number') {
    return attachmentsCount > 0
  }

  return hasAttachments
}

export function parseJobInfoAlertValue(value: FormDataEntryValue | null) {
  if (typeof value !== 'string') {
    return false
  }

  const normalized = value.trim().toLowerCase()
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'on' ||
    normalized === 'yes'
  )
}

export function getPersistedJobInfoAlert({
  requestedAlertEnabled,
  infoNote,
  hasAttachments,
}: {
  requestedAlertEnabled: boolean
  infoNote: string | null | undefined
  hasAttachments: boolean
}) {
  if (!hasJobInfoContent({ infoNote, hasAttachments })) {
    return false
  }

  return requestedAlertEnabled
}
