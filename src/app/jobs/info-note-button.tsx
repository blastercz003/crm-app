'use client'

import { useActionState, useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useFormStatus } from 'react-dom'
import {
  updateJobInfoAlertAction,
  updateJobInfoAction,
  type UpdateJobInfoAlertActionState,
  type UpdateJobInfoActionState,
} from './actions'
import {
  deleteJobInfoAttachmentAction,
  getJobInfoAttachmentsAction,
  uploadJobInfoAttachmentAction,
} from './info-note-attachments-actions'
import {
  isJobCompletedStatus,
  hasJobInfoContent,
  type JobInfoAttachmentItem,
} from './info-note-shared'

type InfoNoteButtonProps = {
  jobId: string
  jobNumber: string
  infoNote: string | null
  hasInfoAttachments?: boolean
  infoAlertEnabled?: boolean
  jobStatus?: string | null
  readOnly?: boolean
  variant?: 'table' | 'mobile'
  compact?: boolean
  className?: string
  updateInfoAction?: InfoNoteUpdateAction
  updateInfoAlertAction?: InfoNoteAlertAction
  getAttachmentsAction?: InfoNoteGetAttachmentsAction
  uploadAttachmentAction?: InfoNoteUploadAction
  deleteAttachmentAction?: InfoNoteDeleteAction
}

type InfoNoteUpdateAction = (
  jobId: string,
  prevState: UpdateJobInfoActionState,
  formData: FormData
) => Promise<UpdateJobInfoActionState>

type InfoNoteAlertAction = (
  jobId: string,
  prevState: UpdateJobInfoAlertActionState,
  formData: FormData
) => Promise<UpdateJobInfoAlertActionState>

type InfoNoteGetAttachmentsResult = {
  success: boolean
  error: string | null
  items: JobInfoAttachmentItem[]
}

type InfoNoteGetAttachmentsAction = (
  jobId: string
) => Promise<InfoNoteGetAttachmentsResult>

type InfoNoteUploadAction = (
  jobId: string,
  formData: FormData
) => Promise<{ success: boolean; error: string | null }>

type InfoNoteDeleteAction = (
  jobId: string,
  attachmentId: string
) => Promise<{ success: boolean; error: string | null }>

const initialState: UpdateJobInfoActionState = {
  success: false,
  error: null,
}

const initialAlertState: UpdateJobInfoAlertActionState = {
  success: false,
  error: null,
}

async function forceDownloadFile(url: string, fileName: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('Nepodařilo se stáhnout soubor.')
  }

  const blob = await response.blob()
  const objectUrl = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = objectUrl
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(objectUrl)
}

export function InfoNoteButton({
  jobId,
  jobNumber,
  infoNote,
  hasInfoAttachments = false,
  infoAlertEnabled = false,
  jobStatus = null,
  readOnly = false,
  variant = 'table',
  compact = false,
  className = '',
  updateInfoAction = updateJobInfoAction,
  updateInfoAlertAction = updateJobInfoAlertAction,
  getAttachmentsAction = getJobInfoAttachmentsAction,
  uploadAttachmentAction = uploadJobInfoAttachmentAction,
  deleteAttachmentAction = deleteJobInfoAttachmentAction,
}: InfoNoteButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [persistedInfoNote, setPersistedInfoNote] = useState(infoNote)
  const [persistedHasAttachments, setPersistedHasAttachments] = useState(
    hasInfoAttachments
  )
  const [persistedAlertEnabled, setPersistedAlertEnabled] = useState(
    infoAlertEnabled
  )

  useEffect(() => {
    setPersistedInfoNote(infoNote)
  }, [infoNote])

  useEffect(() => {
    setPersistedHasAttachments(hasInfoAttachments)
  }, [hasInfoAttachments])

  useEffect(() => {
    setPersistedAlertEnabled(infoAlertEnabled)
  }, [infoAlertEnabled])

  const isCompletedJob = isJobCompletedStatus(jobStatus)
  const currentHasInfoContent = hasJobInfoContent({
    infoNote: persistedInfoNote,
    hasAttachments: persistedHasAttachments,
  })
  const effectiveAlertEnabled = !isCompletedJob && persistedAlertEnabled
  const shouldShowAlertDot = !readOnly && currentHasInfoContent && effectiveAlertEnabled
  const handlePersistedStateChange = useCallback(
    ({
      infoNote: nextInfoNote,
      hasAttachments,
    }: {
      infoNote: string | null
      hasAttachments: boolean
    }) => {
      setPersistedInfoNote(nextInfoNote)
      setPersistedHasAttachments(hasAttachments)

      if (!hasJobInfoContent({ infoNote: nextInfoNote, hasAttachments })) {
        setPersistedAlertEnabled(false)
      }
    },
    []
  )
  const handleSaveSuccess = useCallback(
    ({
      infoNote: nextInfoNote,
      hasAttachments,
      infoAlertEnabled: nextAlertEnabled,
    }: {
      infoNote: string | null
      hasAttachments: boolean
      infoAlertEnabled: boolean
    }) => {
      setPersistedInfoNote(nextInfoNote)
      setPersistedHasAttachments(hasAttachments)
      setPersistedAlertEnabled(nextAlertEnabled)
    },
    []
  )

  function openModal() {
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  function closeModal() {
    setIsOpen(false)
  }

  const buttonLabel = currentHasInfoContent ? 'ZOBRAZIT' : 'PŘIDAT'
  const mobileButtonLabel = currentHasInfoContent ? 'ZOBRAZIT' : 'PŘIDAT'
  const stateClassName = currentHasInfoContent
    ? 'jobs-page__info-button--filled'
    : 'jobs-page__info-button--empty'
  const filledLightClass =
    'border border-zinc-900 bg-zinc-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] hover:-translate-y-[1px] hover:bg-zinc-800'
  const emptyLightClass =
    'border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]'

  const resolvedClassName =
    variant === 'mobile'
      ? `inline-flex items-center justify-center rounded-xl font-medium transition duration-200 ${
          compact ? 'h-8 min-w-0 w-full px-2 text-[11px]' : 'min-w-[88px] px-3 py-2 text-xs'
        } ${
          currentHasInfoContent
            ? `jobs-page__info-button--filled ${filledLightClass}`
            : `jobs-page__info-button--empty ${emptyLightClass}`
        } ${className}`
      : `inline-flex min-w-[88px] items-center justify-center rounded-xl px-3 py-2 text-xs font-medium transition duration-200 ${
          currentHasInfoContent
            ? `jobs-page__info-button--filled ${filledLightClass}`
            : `jobs-page__info-button--empty ${emptyLightClass}`
        } ${className}`

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={`relative ${stateClassName} ${resolvedClassName}`}
      >
        {shouldShowAlertDot ? (
          <span className="job-info-alert-dot absolute right-[5px] top-[5px] h-1.5 w-1.5 rounded-full bg-[#ff3b30]" />
        ) : null}
        {variant === 'mobile' ? mobileButtonLabel : buttonLabel}
      </button>

      {isOpen ? (
        <InfoNoteModal
          key={formKey}
          jobId={jobId}
          jobNumber={jobNumber}
          jobStatus={jobStatus}
          initialValue={persistedInfoNote}
          initialHasAttachments={persistedHasAttachments}
          initialAlertEnabled={persistedAlertEnabled}
          readOnly={readOnly}
          onPersistedStateChange={handlePersistedStateChange}
          onSaveSuccess={handleSaveSuccess}
          onClose={closeModal}
          updateInfoAction={updateInfoAction}
          updateInfoAlertAction={updateInfoAlertAction}
          getAttachmentsAction={getAttachmentsAction}
          uploadAttachmentAction={uploadAttachmentAction}
          deleteAttachmentAction={deleteAttachmentAction}
        />
      ) : null}
    </>
  )
}

function InfoNoteModal({
  jobId,
  jobNumber,
  jobStatus,
  initialValue,
  initialHasAttachments,
  initialAlertEnabled,
  readOnly,
  onPersistedStateChange,
  onSaveSuccess,
  onClose,
  updateInfoAction,
  updateInfoAlertAction,
  getAttachmentsAction,
  uploadAttachmentAction,
  deleteAttachmentAction,
}: {
  jobId: string
  jobNumber: string
  jobStatus?: string | null
  initialValue: string | null
  initialHasAttachments: boolean
  initialAlertEnabled: boolean
  readOnly: boolean
  onPersistedStateChange: (state: {
    infoNote: string | null
    hasAttachments: boolean
  }) => void
  onSaveSuccess: (state: {
    infoNote: string | null
    hasAttachments: boolean
    infoAlertEnabled: boolean
  }) => void
  onClose: () => void
  updateInfoAction: InfoNoteUpdateAction
  updateInfoAlertAction: InfoNoteAlertAction
  getAttachmentsAction: InfoNoteGetAttachmentsAction
  uploadAttachmentAction: InfoNoteUploadAction
  deleteAttachmentAction: InfoNoteDeleteAction
}) {
  const boundAction = useMemo(
    () => updateInfoAction.bind(null, jobId),
    [jobId, updateInfoAction]
  )

  const [state, formAction] = useActionState(boundAction, initialState)
  const [attachments, setAttachments] = useState<JobInfoAttachmentItem[]>([])
  const [attachmentsLoading, setAttachmentsLoading] = useState(true)
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [previewAttachment, setPreviewAttachment] =
    useState<JobInfoAttachmentItem | null>(null)
  const [draftValue, setDraftValue] = useState(initialValue ?? '')
  const [isAlertEnabled, setIsAlertEnabled] = useState(initialAlertEnabled)
  const [isAlertPending, startAlertTransition] = useTransition()
  const isCompletedJob = isJobCompletedStatus(jobStatus)

  const modalHasInfoContent = hasJobInfoContent({
    infoNote: draftValue,
    attachmentsCount: attachments.length,
  })
  const effectiveAlertEnabled =
    modalHasInfoContent && isAlertEnabled && !isCompletedJob

  useEffect(() => {
    if (readOnly) return

    if (state.success) {
      onSaveSuccess({
        infoNote: draftValue.trim() || null,
        hasAttachments: attachments.length > 0,
        infoAlertEnabled: effectiveAlertEnabled,
      })
      onClose()
    }
  }, [
    attachments.length,
    draftValue,
    effectiveAlertEnabled,
    onClose,
    onSaveSuccess,
    readOnly,
    state.success,
  ])

  useEffect(() => {
    let cancelled = false

    const loadAttachments = async () => {
      setAttachmentsLoading(true)
      setAttachmentsError(null)

      const result = await getAttachmentsAction(jobId)

      if (cancelled) return

      if (!result.success) {
        setAttachments([])
        setAttachmentsError(result.error ?? 'Nepodařilo se načíst fotky.')
        setAttachmentsLoading(false)
        return
      }

      const nextAttachments = (result.items ?? []) as JobInfoAttachmentItem[]
      setAttachments(nextAttachments)
      if ((nextAttachments.length > 0) !== initialHasAttachments) {
        onPersistedStateChange({
          infoNote: initialValue,
          hasAttachments: nextAttachments.length > 0,
        })
      }
      setAttachmentsLoading(false)
    }

    void loadAttachments()

    return () => {
      cancelled = true
    }
  }, [
    getAttachmentsAction,
    initialHasAttachments,
    initialValue,
    jobId,
    onPersistedStateChange,
  ])

  async function reloadAttachments() {
    setAttachmentsLoading(true)
    setAttachmentsError(null)

    const result = await getAttachmentsAction(jobId)
    if (!result.success) {
      setAttachments([])
      setAttachmentsError(result.error ?? 'Nepodařilo se načíst fotky.')
      setAttachmentsLoading(false)
      return
    }

    setAttachments((result.items ?? []) as JobInfoAttachmentItem[])
    setAttachmentsLoading(false)
  }

  async function handleUpload(files: File[]) {
    if (readOnly) return

    if (files.length === 0) return

    setIsUploading(true)
    setAttachmentsError(null)

    const uploadFormData = new FormData()
    for (const file of files) {
      uploadFormData.append('photos', file)
    }
    const result = await uploadAttachmentAction(jobId, uploadFormData)

    setIsUploading(false)

    if (!result.success) {
      setAttachmentsError(result.error ?? 'Fotku se nepodařilo nahrát.')
      return
    }

    await reloadAttachments()
    const hasAttachments = attachments.length + files.length > 0
    onPersistedStateChange({
      infoNote: initialValue,
      hasAttachments,
    })
  }

  async function handleDelete(attachmentId: string) {
    if (readOnly) return

    setDeletingId(attachmentId)
    setAttachmentsError(null)

    const result = await deleteAttachmentAction(jobId, attachmentId)
    setDeletingId(null)

    if (!result.success) {
      setAttachmentsError(result.error ?? 'Fotku se nepodařilo smazat.')
      return
    }

    await reloadAttachments()

    const nextHasAttachments = attachments.some((item) => item.id !== attachmentId)
    onPersistedStateChange({
      infoNote: initialValue,
      hasAttachments: nextHasAttachments,
    })

    if (!hasJobInfoContent({ infoNote: draftValue, hasAttachments: nextHasAttachments })) {
      setIsAlertEnabled(false)
    }
  }

  async function handleDownload(item: JobInfoAttachmentItem) {
    if (!item.signedUrl) {
      setAttachmentsError('Fotku se nepodařilo stáhnout.')
      return
    }

    try {
      await forceDownloadFile(item.signedUrl, item.fileName)
    } catch {
      window.open(item.signedUrl, '_blank', 'noopener,noreferrer')
    }
  }

  function handleAlertToggle() {
    if (readOnly) return

    if (!modalHasInfoContent || isAlertPending || isCompletedJob) return

    const nextAlertEnabled = !effectiveAlertEnabled
    const nextInfoNote = draftValue.trim() || null

    setIsAlertEnabled(nextAlertEnabled)

    startAlertTransition(async () => {
      const formData = new FormData()
      formData.set('info_note', draftValue)
      formData.set('info_alert_enabled', nextAlertEnabled ? '1' : '0')

      const result = await updateInfoAlertAction(jobId, initialAlertState, formData)

      if (!result.success) {
        setIsAlertEnabled(effectiveAlertEnabled)
        setAttachmentsError(result.error ?? 'Alert info zakázky se nepodařilo uložit.')
        return
      }

      onPersistedStateChange({
        infoNote: nextInfoNote,
        hasAttachments: attachments.length > 0,
      })
      onSaveSuccess({
        infoNote: nextInfoNote,
        hasAttachments: attachments.length > 0,
        infoAlertEnabled: nextAlertEnabled,
      })
      setAttachmentsError(null)
    })
  }

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/38 px-4 py-6 backdrop-blur-[5px] lg:backdrop-blur-[6px]">
      <div className="jobs-page__modal-shell jobs-page__info-modal relative w-full max-w-xl overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]">
        <div className="jobs-page__info-modal__header flex items-center justify-between border-b border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-5 py-4">
          <div>
            <h2 className="jobs-page__info-modal__title text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
              Info k zakázce
            </h2>
            <div className="mt-2 inline-flex items-center rounded-full border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-1.5 text-xs font-bold tracking-[0.12em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.28)]">
              {jobNumber}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span
                data-active={effectiveAlertEnabled ? 'true' : 'false'}
                className={`jobs-page__info-modal__alert-state text-xs font-bold tracking-[0.14em] ${
                  effectiveAlertEnabled ? 'text-[#2f8fd4]' : 'text-zinc-900'
                }`}
              >
                {effectiveAlertEnabled ? 'ALERT ON' : 'ALERT OFF'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={effectiveAlertEnabled}
                aria-label={
                  effectiveAlertEnabled ? 'Vypnout alert info zakázky' : 'Zapnout alert info zakázky'
                }
                disabled={!modalHasInfoContent || isAlertPending || isCompletedJob}
                data-active={effectiveAlertEnabled ? 'true' : 'false'}
                onClick={handleAlertToggle}
                className={`jobs-page__info-modal__alert-switch relative inline-flex h-7 w-12 items-center rounded-full border px-0.5 transition duration-200 ${
                  effectiveAlertEnabled
                    ? 'border-[#76a9d3]/85 bg-[linear-gradient(135deg,#1f7fe4_0%,#49a8ff_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_18px_rgba(24,78,129,0.22)]'
                    : 'border-white/85 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(226,232,240,0.82)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_16px_rgba(15,23,42,0.08)]'
                } ${!modalHasInfoContent || isAlertPending || isCompletedJob ? 'cursor-not-allowed opacity-55' : 'hover:-translate-y-[1px]'}`}
              >
                <span
                  className={`pointer-events-none inline-block h-[22px] w-[22px] rounded-full bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(246,248,251,0.96)_100%)] shadow-[0_2px_8px_rgba(15,23,42,0.18)] transition duration-200 ${
                    effectiveAlertEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="jobs-page__info-modal__close inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_14px_28px_rgba(39,39,42,0.18)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>
        </div>

        <form action={readOnly ? undefined : formAction} className="flex flex-col">
          <div className="jobs-page__info-modal__body px-5 py-4">
              <textarea
                id="job-info-note"
                name="info_note"
                rows={6}
                value={draftValue}
                onChange={(event) => {
                  if (readOnly) return

                  const nextValue = event.target.value
                  setDraftValue(nextValue)

                  if (
                    !hasJobInfoContent({
                      infoNote: nextValue,
                      attachmentsCount: attachments.length,
                    })
                  ) {
                    setIsAlertEnabled(false)
                  }
                }}
                placeholder="Sem napiš libovolný delší text k zakázce"
                readOnly={readOnly}
                className="jobs-page__info-modal__textarea w-full resize-y rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-4 py-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
              />
              {readOnly ? null : (
                <input
                  type="hidden"
                  name="info_alert_enabled"
                  value={effectiveAlertEnabled ? '1' : '0'}
                />
              )}

            <div className="jobs-page__info-modal__attachments-shell mt-4 rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.82)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
              {readOnly ? null : (
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <label className="jobs-page__info-modal__upload inline-flex h-8 cursor-pointer items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60">
                    {isUploading ? 'Nahrávám…' : 'Přidat fotku'}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={isUploading}
                      className="hidden"
                      onChange={(event) => {
                        const files = Array.from(event.target.files ?? [])
                        event.currentTarget.value = ''
                        void handleUpload(files)
                      }}
                    />
                  </label>
                </div>
              )}

              <div className="mt-3 max-h-40 overflow-y-auto pr-1">
                {attachmentsLoading ? (
                  <div className="jobs-page__info-modal__empty-state rounded-xl border border-white/75 bg-white/70 px-3 py-2 text-sm text-zinc-500">
                    Načítám fotky…
                  </div>
                ) : attachments.length === 0 ? (
                  <div className="jobs-page__info-modal__empty-state rounded-xl border border-white/75 bg-white/70 px-3 py-2 text-sm text-zinc-500">
                    Zatím bez fotek, přidej max. 5 fotek, 1 MB / ks.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {attachments.map((item) => (
                      <div
                        key={item.id}
                        className="jobs-page__info-modal__attachment-card overflow-hidden rounded-xl border border-white/75 bg-white/80"
                      >
                        <button
                          type="button"
                          onClick={() => setPreviewAttachment(item)}
                          className="block w-full"
                        >
                          {item.signedUrl ? (
                            <img
                              src={item.signedUrl}
                              alt={item.fileName}
                              className="h-20 w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-20 items-center justify-center bg-zinc-100 text-xs text-zinc-500">
                              Náhled
                            </div>
                          )}
                        </button>
                        <div className="flex items-center justify-end gap-2 px-2 py-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              void handleDownload(item)
                            }}
                            className="inline-flex h-6 items-center justify-center rounded-lg border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_14px_rgba(24,78,129,0.24)] transition hover:-translate-y-[1px] disabled:pointer-events-none disabled:opacity-60"
                            >
                              STÁHNOUT
                          </button>
                          {readOnly ? null : (
                            <button
                              type="button"
                              disabled={deletingId === item.id}
                              onClick={() => {
                                void handleDelete(item.id)
                              }}
                              className="inline-flex h-6 items-center justify-center rounded-lg border border-red-200/90 px-2 text-[10px] font-semibold uppercase tracking-[0.04em] text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.72),0_6px_12px_rgba(220,38,38,0.12)] transition hover:-translate-y-[1px] hover:bg-red-50 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.78),0_8px_14px_rgba(220,38,38,0.16)] disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {deletingId === item.id ? '…' : 'Smazat'}
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {state.error ? (
              <div className="jobs-page__info-modal__error mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {state.error}
              </div>
            ) : null}

            {attachmentsError ? (
              <div className="jobs-page__info-modal__error mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {attachmentsError}
              </div>
            ) : null}
          </div>

          <div className="jobs-page__info-modal__footer flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.68)_100%)] px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="jobs-page__info-modal__cancel inline-flex h-10 items-center justify-center rounded-2xl border border-red-400/85 bg-[linear-gradient(155deg,#ef4444_0%,#dc2626_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_18px_rgba(185,28,28,0.24)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_22px_rgba(185,28,28,0.3)]"
            >
              ZAVŘÍT
            </button>

            {readOnly ? null : <SaveButton />}
          </div>
        </form>
      </div>

      {previewAttachment && previewAttachment.signedUrl ? (
        <div className="jobs-page__info-modal__preview fixed inset-0 z-[130] flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-[2px]">
          <button
            type="button"
            aria-label="Zavřít náhled fotky"
            className="absolute inset-0"
            onClick={() => setPreviewAttachment(null)}
          />

          <div className="jobs-page__info-modal__preview-card relative z-[131] w-full max-w-4xl overflow-hidden rounded-2xl border border-white/30 bg-zinc-950/70 shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
            <div className="jobs-page__info-modal__preview-header flex items-center justify-between gap-3 border-b border-white/15 px-4 py-3">
              <div className="min-w-0 truncate text-sm font-medium text-white" title={previewAttachment.fileName}>
                {previewAttachment.fileName}
              </div>
              <button
                type="button"
                onClick={() => setPreviewAttachment(null)}
                className="jobs-page__info-modal__preview-close inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/25 bg-white/10 text-white transition hover:bg-white/20"
                aria-label="Zavřít"
              >
                ✕
              </button>
            </div>

            <div className="flex max-h-[70vh] items-center justify-center bg-black/30 p-3">
              <img
                src={previewAttachment.signedUrl}
                alt={previewAttachment.fileName}
                className="max-h-[66vh] w-auto max-w-full rounded-lg object-contain"
              />
            </div>

            <div className="jobs-page__info-modal__preview-actions flex flex-wrap items-center justify-end gap-2 border-t border-white/15 px-4 py-3">
              <a
                href={previewAttachment.signedUrl}
                download={previewAttachment.fileName}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 text-xs font-semibold uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.28)] transition hover:-translate-y-[1px]"
              >
                STÁHNOUT
              </a>
              <a
                href={previewAttachment.signedUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center justify-center rounded-xl border border-white/30 bg-white/10 px-3 text-xs font-semibold uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(0,0,0,0.24)] transition hover:-translate-y-[1px] hover:bg-white/20 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_22px_rgba(0,0,0,0.3)]"
              >
                OTEVŘÍT ORIGINÁL
              </a>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
}

function SaveButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      className="jobs-page__info-modal__save inline-flex h-10 items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={pending}
    >
      {pending ? 'UKLÁDÁM…' : 'ULOŽIT'}
    </button>
  )
}
