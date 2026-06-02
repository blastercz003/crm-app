'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import {
  updatePortalJobInfoAction,
  updatePortalJobInfoAlertAction,
} from './actions'
import {
  deleteJobInfoAttachmentAction,
  getJobInfoAttachmentsAction,
  uploadJobInfoAttachmentAction,
} from '@/app/jobs/info-note-attachments-actions'
import {
  hasJobInfoContent,
  type JobInfoAttachmentItem,
} from '@/app/jobs/info-note-shared'

type PortalJobRow = {
  id: string
  job_number: string
  company_name: string
  contact_person: string | null
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  technician_name: string | null
  generator_name: string | null
  info_note: string | null
  info_alert_enabled?: boolean | null
  has_info_attachments?: boolean
  has_info_content?: boolean
  job_status: JobStatus | null
}

type JobsPortalTableProps = {
  jobs: PortalJobRow[]
}

type JobStatus = 'nova' | 'k_reseni' | 'realizace' | 'ukoncena' | 'storno'
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

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const STATUS_BADGE_WIDTH_CLASS = 'min-w-[100px]'
const STATUS_BADGE_COMPACT_WIDTH_CLASS = 'min-w-[88px]'
const GLASS_SECONDARY_BUTTON_CLASS =
  'rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_9px_14px_rgba(15,23,42,0.07)]'
const GLASS_DARK_BUTTON_CLASS =
  'rounded-xl border border-zinc-900 bg-zinc-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out hover:-translate-y-[1px] hover:bg-zinc-800 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.17),0_11px_16px_rgba(24,24,27,0.22)]'

function getEffectiveJobStatus(job: Pick<PortalJobRow, 'job_status' | 'end_at'>): JobStatus {
  if (job.job_status !== 'realizace' && job.job_status !== 'ukoncena') {
    return job.job_status ?? 'nova'
  }

  const endAt = new Date(job.end_at)
  if (Number.isNaN(endAt.getTime())) {
    return job.job_status ?? 'nova'
  }

  return endAt.getTime() < Date.now() ? 'ukoncena' : 'realizace'
}

export function JobsPortalTable({ jobs }: JobsPortalTableProps) {
  return (
    <>
      <section className="hidden overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:block">
        <table className="w-full table-fixed border-separate border-spacing-y-2">
          <thead className="bg-transparent shadow-[0_1px_0_0_#e5e7eb]">
            <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
              <th className="w-[74px] px-2 py-2">Zakázka</th>
              <th className="w-[112px] px-2 py-2">Firma</th>
              <th className="w-[86px] px-2 py-2">Osoba</th>
              <th className="w-[118px] px-2 py-2">Začátek</th>
              <th className="w-[118px] px-2 py-2">Konec</th>
              <th className="w-[124px] px-2 py-2">Adresa</th>
              <th className="w-[74px] px-2 py-2">Prodejna</th>
              <th className="w-[90px] px-2 py-2">Technik</th>
              <th className="w-[88px] px-2 py-2">Agregát</th>
              <th className="w-[84px] px-2 py-2 text-center">Info</th>
              <th className="w-[112px] px-2 py-2 text-center">Stav</th>
            </tr>
          </thead>

          <tbody>
            {jobs.map((job) => (
              <DesktopRow key={job.id} job={job} />
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-3 lg:hidden">
        {jobs.map((job) => (
          <MobileCard key={job.id} job={job} />
        ))}
      </section>
    </>
  )
}

function DesktopRow({ job }: { job: PortalJobRow }) {
  return (
    <tr className="group [background:linear-gradient(160deg,rgba(255,255,255,0.95)_0%,rgba(242,247,252,0.88)_100%)] transition duration-200 hover:-translate-y-[1px]">
      <ReadOnlyCell
        value={job.job_number}
        className="rounded-l-2xl border-r-0 font-semibold text-gray-900"
      />
      <ReadOnlyCell value={job.company_name} className="border-l-0 border-r-0" />
      <ReadOnlyCell value={job.contact_person} className="border-l-0 border-r-0" />
      <ReadOnlyCell value={formatDateTime(job.start_at)} className="border-l-0 border-r-0" />
      <ReadOnlyCell value={formatDateTime(job.end_at)} className="border-l-0 border-r-0" />
      <ReadOnlyCell value={job.site_address} className="border-l-0 border-r-0" />
      <ReadOnlyCell value={job.store_number} className="border-l-0 border-r-0" />
      <ReadOnlyCell value={job.technician_name} className="border-l-0 border-r-0" />
      <ReadOnlyCell value={job.generator_name} className="border-l-0 border-r-0" />

      <td className="border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-2 py-2 align-middle text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf]">
        <div className="flex items-center justify-center gap-2">
          <InfoButton job={job} />
        </div>
      </td>

      <td className="rounded-r-2xl border border-l-0 border-[#cfd8e3] bg-transparent px-2 py-2 align-middle text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf]">
        <JobStatusBadge status={getEffectiveJobStatus(job)} />
      </td>
    </tr>
  )
}

function MobileCard({ job }: { job: PortalJobRow }) {
  const [isActionsOpen, setIsActionsOpen] = useState(false)
  const showInfoAlertDot = Boolean(job.info_alert_enabled) && Boolean(job.has_info_content)

  return (
    <div className="overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.95)_0%,rgba(242,247,252,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_24px_rgba(15,23,42,0.1)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 w-0 flex-1">
          <p className="text-sm font-semibold leading-tight text-gray-900">
            {job.job_number}
          </p>
          <p className="mt-0.5 block truncate text-[12px] font-medium leading-5 text-gray-900">
            {job.company_name}
          </p>
        </div>

        <JobStatusBadge status={getEffectiveJobStatus(job)} compact />
      </div>

      <div className="mt-0 grid grid-cols-1 gap-x-2 gap-y-0 text-[12px] leading-5 text-gray-600 min-[300px]:grid-cols-[17.5ch_minmax(12ch,1fr)]">
        <div className="min-w-0 min-[300px]:col-span-2">
          <span className="font-medium text-gray-900">Adresa:</span>{' '}
          <span className="break-words">{job.site_address || '—'}</span>
        </div>

        <div className="min-w-0 mt-1">
          <span className="font-semibold text-gray-900">Začátek:</span>{' '}
          <span className="whitespace-nowrap font-semibold tabular-nums text-gray-900">
            {formatDateTimeMobile(job.start_at)}
          </span>
        </div>

        <div className="min-w-0 mt-1">
          <span className="font-semibold text-gray-900">Konec:</span>{' '}
          <span className="whitespace-nowrap font-semibold tabular-nums text-gray-900">
            {formatDateTimeMobile(job.end_at)}
          </span>
        </div>

        <div className="min-w-0 max-w-[12.5rem] flex items-baseline gap-1">
          <span className="shrink-0 font-medium text-gray-900">Technik:</span>
          <span className="min-w-0 truncate whitespace-nowrap">
            {job.technician_name || '—'}
          </span>
        </div>

        <div className="min-w-0 flex items-start justify-between gap-2">
          <div className="min-w-0 flex flex-1 items-baseline gap-1 whitespace-nowrap">
            <span className="shrink-0 font-medium text-gray-900">Agregát:</span>
            <span className="min-w-0 truncate whitespace-nowrap">
              {job.generator_name || '—'}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setIsActionsOpen((current) => !current)}
            aria-expanded={isActionsOpen}
            aria-label="Akce zakázky"
            className={`relative hidden min-[300px]:inline-flex h-8 min-w-[44px] shrink-0 self-start -translate-y-2 items-center justify-center px-3 text-[18px] font-semibold leading-none tracking-[-0.08em] text-zinc-600 ${GLASS_SECONDARY_BUTTON_CLASS}`}
          >
            {showInfoAlertDot ? (
              <span className="job-info-alert-dot absolute right-[5px] top-[5px] h-1.5 w-1.5 rounded-full bg-[#ff3b30]" />
            ) : null}
            ⋯
          </button>
        </div>

      </div>

      <div className="mt-0 flex justify-end min-[300px]:hidden">
        <button
          type="button"
          onClick={() => setIsActionsOpen((current) => !current)}
          aria-expanded={isActionsOpen}
          aria-label="Akce zakázky"
          className={`relative inline-flex h-8 min-w-[44px] items-center justify-center px-3 text-[18px] font-semibold leading-none tracking-[-0.08em] text-zinc-600 ${GLASS_SECONDARY_BUTTON_CLASS}`}
        >
          {showInfoAlertDot ? (
            <span className="job-info-alert-dot absolute right-[5px] top-[5px] h-1.5 w-1.5 rounded-full bg-[#ff3b30]" />
          ) : null}
          ⋯
        </button>
      </div>

      {isActionsOpen ? (
        <div className="mt-0 flex justify-end">
          <InfoButton job={job} compact />
        </div>
      ) : null}
    </div>
  )
}

function JobStatusBadge({
  status,
  compact = false,
}: {
  status: JobStatus | null
  compact?: boolean
}) {
  const meta = getJobStatusMeta(status ?? 'nova')
  const widthClass = compact
    ? STATUS_BADGE_COMPACT_WIDTH_CLASS
    : STATUS_BADGE_WIDTH_CLASS

  return (
    <span
      className={`inline-flex h-8 items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase ${widthClass} ${meta.className}`}
    >
      <span className="truncate whitespace-nowrap">{meta.label}</span>
    </span>
  )
}

function getJobStatusMeta(status: JobStatus) {
  switch (status) {
    case 'nova':
      return {
        value: 'nova' as JobStatus,
        label: 'NOVÁ',
        className:
          'border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_10px_20px_rgba(24,78,129,0.28)]',
      }
    case 'k_reseni':
      return {
        value: 'k_reseni' as JobStatus,
        label: 'V ŘEŠENÍ',
        className:
          'border border-[#ff9d5c] bg-[linear-gradient(155deg,#ff8a1f_0%,#ff7a00_60%,#f06b00_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_20px_rgba(240,107,0,0.26)]',
      }
    case 'realizace':
      return {
        value: 'realizace' as JobStatus,
        label: 'REALIZACE',
        className:
          'border border-[#2ed7a3] bg-[linear-gradient(155deg,#14b87a_0%,#08a768_55%,#079a60_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(8,167,104,0.28)]',
      }
    case 'ukoncena':
      return {
        value: 'ukoncena' as JobStatus,
        label: 'UKONČENÁ',
        className:
          'border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]',
      }
    case 'storno':
      return {
        value: 'storno' as JobStatus,
        label: 'STORNO',
        className:
          'border border-[#ff5d5d] bg-[linear-gradient(155deg,#ff4747_0%,#f03434_58%,#d62828_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(214,40,40,0.28)]',
      }
  }
}

function ReadOnlyCell({
  value,
  className = '',
}: {
  value: string | null
  className?: string
}) {
  return (
    <td
      className={`border border-[#cfd8e3] bg-transparent px-2 py-2 align-middle shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf] ${className}`}
    >
      <div className="block w-full rounded-lg px-1 py-1 text-left text-[12px] text-gray-700">
        <span className="block truncate">{value || '—'}</span>
      </div>
    </td>
  )
}

function InfoButton({
  job,
  compact = false,
}: {
  job: PortalJobRow
  compact?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [persistedInfoNote, setPersistedInfoNote] = useState(job.info_note)
  const [persistedHasAttachments, setPersistedHasAttachments] = useState(
    Boolean(job.has_info_attachments)
  )
  const [persistedAlertEnabled, setPersistedAlertEnabled] = useState(
    Boolean(job.info_alert_enabled)
  )
  const [draftValue, setDraftValue] = useState(job.info_note ?? '')
  const [isPending, startTransition] = useTransition()
  const [attachments, setAttachments] = useState<JobInfoAttachmentItem[]>([])
  const [attachmentsLoading, setAttachmentsLoading] = useState(false)
  const [attachmentsError, setAttachmentsError] = useState<string | null>(null)
  const [isUploading, setIsUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [previewAttachment, setPreviewAttachment] =
    useState<JobInfoAttachmentItem | null>(null)
  const [isAlertEnabled, setIsAlertEnabled] = useState(
    Boolean(job.info_alert_enabled)
  )

  const currentHasInfoContent = hasJobInfoContent({
    infoNote: persistedInfoNote,
    hasAttachments: persistedHasAttachments,
  })
  const modalHasInfoContent = hasJobInfoContent({
    infoNote: draftValue,
    attachmentsCount: attachments.length,
  })
  const effectiveAlertEnabled = modalHasInfoContent && isAlertEnabled

  useEffect(() => {
    setPersistedInfoNote(job.info_note)
    setDraftValue(job.info_note ?? '')
  }, [job.info_note])

  useEffect(() => {
    setPersistedHasAttachments(Boolean(job.has_info_attachments))
  }, [job.has_info_attachments])

  useEffect(() => {
    setPersistedAlertEnabled(Boolean(job.info_alert_enabled))
    setIsAlertEnabled(Boolean(job.info_alert_enabled))
  }, [job.info_alert_enabled])

  useEffect(() => {
    if (!modalHasInfoContent && isAlertEnabled) {
      setIsAlertEnabled(false)
    }
  }, [isAlertEnabled, modalHasInfoContent])

  useEffect(() => {
    if (!isOpen) {
      setDraftValue(persistedInfoNote ?? '')
      setIsAlertEnabled(persistedAlertEnabled)
    }
  }, [isOpen, persistedAlertEnabled, persistedInfoNote])

  useEffect(() => {
    if (!isOpen) return
    void reloadAttachments()
    // bound to modal open only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  async function reloadAttachments() {
    setAttachmentsLoading(true)
    setAttachmentsError(null)

    const result = await getJobInfoAttachmentsAction(job.id)
    if (!result.success) {
      setAttachments([])
      setAttachmentsError(result.error ?? 'Nepodařilo se načíst fotky.')
      setAttachmentsLoading(false)
      return
    }

    const nextAttachments = (result.items ?? []) as JobInfoAttachmentItem[]
    setAttachments(nextAttachments)
    setPersistedHasAttachments(nextAttachments.length > 0)
    if (
      !hasJobInfoContent({
        infoNote: persistedInfoNote,
        hasAttachments: nextAttachments.length > 0,
      })
    ) {
      setPersistedAlertEnabled(false)
    }
    setAttachmentsLoading(false)
  }

  async function handleUpload(files: File[]) {
    if (files.length === 0) return

    setIsUploading(true)
    setAttachmentsError(null)

    const uploadFormData = new FormData()
    for (const file of files) {
      uploadFormData.append('photos', file)
    }

    const result = await uploadJobInfoAttachmentAction(job.id, uploadFormData)
    setIsUploading(false)

    if (!result.success) {
      setAttachmentsError(result.error ?? 'Fotku se nepodařilo nahrát.')
      return
    }

    await reloadAttachments()
    setPersistedHasAttachments(true)
  }

  async function handleDelete(attachmentId: string) {
    setDeletingId(attachmentId)
    setAttachmentsError(null)

    const result = await deleteJobInfoAttachmentAction(job.id, attachmentId)
    setDeletingId(null)

    if (!result.success) {
      setAttachmentsError(result.error ?? 'Fotku se nepodařilo smazat.')
      return
    }

    await reloadAttachments()

    const nextHasAttachments = attachments.some((item) => item.id !== attachmentId)
    setPersistedHasAttachments(nextHasAttachments)
    if (
      !hasJobInfoContent({
        infoNote: draftValue,
        hasAttachments: nextHasAttachments,
      })
    ) {
      setPersistedAlertEnabled(false)
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
    if (!modalHasInfoContent || isPending) return

    const nextAlertEnabled = !effectiveAlertEnabled
    const nextInfoNote = draftValue.trim() || null

    setIsAlertEnabled(nextAlertEnabled)

    startTransition(async () => {
      const formData = new FormData()
      formData.set('info_note', draftValue)
      formData.set('info_alert_enabled', nextAlertEnabled ? '1' : '0')

      const result = await updatePortalJobInfoAlertAction(
        job.id,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        setIsAlertEnabled(effectiveAlertEnabled)
        setAttachmentsError(
          result.error ?? 'Alert info zakázky se nepodařilo uložit.'
        )
        return
      }

      setPersistedInfoNote(nextInfoNote)
      setPersistedHasAttachments(attachments.length > 0)
      setPersistedAlertEnabled(nextAlertEnabled)
      setAttachmentsError(null)
    })
  }

  function saveInfo() {
    startTransition(async () => {
      const formData = new FormData()
      formData.set('info_note', draftValue)
      formData.set('info_alert_enabled', effectiveAlertEnabled ? '1' : '0')

      const result = await updatePortalJobInfoAction(
        job.id,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        alert(result.error ?? 'Info k zakázce se nepodařilo uložit.')
        return
      }

      setPersistedInfoNote(draftValue.trim() || null)
      setPersistedAlertEnabled(effectiveAlertEnabled)
      setIsOpen(false)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`relative inline-flex h-8 items-center justify-center px-3 text-[11px] font-bold uppercase ${
          compact ? STATUS_BADGE_COMPACT_WIDTH_CLASS : STATUS_BADGE_WIDTH_CLASS
        } ${
          currentHasInfoContent
            ? GLASS_DARK_BUTTON_CLASS
            : GLASS_SECONDARY_BUTTON_CLASS
        }`}
      >
        {currentHasInfoContent && persistedAlertEnabled ? (
          <span className="job-info-alert-dot absolute right-[5px] top-[5px] h-1.5 w-1.5 rounded-full bg-[#ff3b30]" />
        ) : null}
        {currentHasInfoContent ? 'ZOBRAZIT' : 'PŘIDAT'}
      </button>

      {isOpen ? (
        <ModalShell
          title="Info k zakázce"
          description={job.job_number}
          descriptionAsBadge
          headerActions={
            <div className="flex items-center gap-2">
              <span
                className={`text-xs font-bold tracking-[0.14em] ${
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
                disabled={!modalHasInfoContent || isPending}
                onClick={handleAlertToggle}
                className={`relative inline-flex h-7 w-12 items-center rounded-full border px-0.5 transition duration-200 ${
                  effectiveAlertEnabled
                    ? 'border-[#76a9d3]/85 bg-[linear-gradient(135deg,#1f7fe4_0%,#49a8ff_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_18px_rgba(24,78,129,0.22)]'
                    : 'border-white/85 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(226,232,240,0.82)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_16px_rgba(15,23,42,0.08)]'
                } ${!modalHasInfoContent || isPending ? 'cursor-not-allowed opacity-55' : 'hover:-translate-y-[1px]'}`}
              >
                <span
                  className={`pointer-events-none inline-block h-[22px] w-[22px] rounded-full bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(246,248,251,0.96)_100%)] shadow-[0_2px_8px_rgba(15,23,42,0.18)] transition duration-200 ${
                    effectiveAlertEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          }
          onClose={() => setIsOpen(false)}
        >
          <>
            <textarea
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              rows={6}
              className="w-full resize-y rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-4 py-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
              placeholder="Sem napiš libovolný delší text k zakázce"
            />

            <div className="mt-4 rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.82)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <label className="inline-flex h-8 cursor-pointer items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60">
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

              <div className="mt-3 max-h-40 overflow-y-auto pr-1">
                {attachmentsLoading ? (
                  <div className="rounded-xl border border-white/75 bg-white/70 px-3 py-2 text-sm text-zinc-500">
                    Načítám fotky…
                  </div>
                ) : attachments.length === 0 ? (
                  <div className="rounded-xl border border-white/75 bg-white/70 px-3 py-2 text-sm text-zinc-500">
                    Zatím bez fotek, přidej max. 5 fotek, 1 MB / ks.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {attachments.map((item) => (
                      <div
                        key={item.id}
                        className="overflow-hidden rounded-xl border border-white/75 bg-white/80"
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
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {attachmentsError ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {attachmentsError}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-2xl border border-red-400/85 bg-[linear-gradient(155deg,#ef4444_0%,#dc2626_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_18px_rgba(185,28,28,0.24)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_12px_22px_rgba(185,28,28,0.3)]"
              >
                ZRUŠIT
              </button>

              <button
                type="button"
                onClick={saveInfo}
                disabled={isPending}
                className="inline-flex h-10 items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? 'UKLÁDÁM…' : 'ULOŽIT'}
              </button>
            </div>
          </>
        </ModalShell>
      ) : null}

      {previewAttachment && previewAttachment.signedUrl ? (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 px-4 py-6 backdrop-blur-[2px]">
          <button
            type="button"
            aria-label="Zavřít náhled fotky"
            className="absolute inset-0"
            onClick={() => setPreviewAttachment(null)}
          />

          <div className="relative z-[131] w-full max-w-4xl overflow-hidden rounded-2xl border border-white/30 bg-zinc-950/70 shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
            <div className="flex items-center justify-between gap-3 border-b border-white/15 px-4 py-3">
              <div className="min-w-0 truncate text-sm font-medium text-white" title={previewAttachment.fileName}>
                {previewAttachment.fileName}
              </div>
              <button
                type="button"
                onClick={() => setPreviewAttachment(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/25 bg-white/10 text-white transition hover:bg-white/20"
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

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/15 px-4 py-3">
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
    </>
  )
}

function ModalShell({
  title,
  description,
  descriptionAsBadge = false,
  headerActions,
  onClose,
  children,
}: {
  title: string
  description?: string
  descriptionAsBadge?: boolean
  headerActions?: React.ReactNode
  onClose: () => void
  children: React.ReactNode
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const modalContent = (
    <div
      className="fixed inset-0 z-[120] bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex h-full items-center justify-center">
        <div className="relative w-full max-w-xl overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]">
          <div className="flex items-center justify-between gap-4 border-b border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                {title}
              </h2>
              {description ? (
                descriptionAsBadge ? (
                  <div className="mt-2 inline-flex items-center rounded-full border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-1.5 text-xs font-bold tracking-[0.12em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.28)]">
                    {description}
                  </div>
                ) : (
                  <p className="mt-1 text-sm text-gray-500">{description}</p>
                )
              ) : null}
            </div>
            <div className="flex items-center gap-3">
              {headerActions}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_14px_28px_rgba(39,39,42,0.18)]"
                aria-label="Zavřít"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="px-5 py-4">{children}</div>
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}

function formatDateTime(value: string | null) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: PRAGUE_TIME_ZONE,
  }).format(new Date(value))
}

function formatDateTimeMobile(value: string | null) {
  if (!value) return '—'

  const parts = new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: PRAGUE_TIME_ZONE,
  }).formatToParts(new Date(value))

  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const hour = parts.find((part) => part.type === 'hour')?.value ?? ''
  const minute = parts.find((part) => part.type === 'minute')?.value ?? ''

  if (!day || !month || !hour || !minute) return '—'

  return `${day}.${month}. ${hour}:${minute}`
}
