'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import { SuccessConfirmationModal } from '@/components/ui/success-confirmation-modal'
import { JobAttachmentsModalContent } from '@/components/attachments/job-attachments-modal-content'
import {
  downloadHandoverProtocolUploadAttachmentAction,
  getHandoverProtocolUploadAttachmentsAction,
  openHandoverProtocolUploadAttachmentAction,
  uploadHandoverProtocolAttachmentsAction,
  type HandoverProtocolUploadJobOption,
} from '@/app/dashboard/handover-protocol-upload-actions'
import type { JobAttachment } from '@/lib/job-attachments'

const FILE_CATEGORY_OPTIONS = [{ value: 'predavaci_protokol' as const, label: 'Předávací protokol' }]

type DashboardHandoverProtocolUploadLauncherProps = {
  jobs: HandoverProtocolUploadJobOption[]
}

function formatJobLabel(job: HandoverProtocolUploadJobOption | null) {
  if (!job) return 'Vyber zakázku'

  const address = job.siteAddress?.trim()
  return address
    ? `${job.jobNumber} · ${job.companyName} · ${address}`
    : `${job.jobNumber} · ${job.companyName}`
}

export function DashboardHandoverProtocolUploadLauncher({
  jobs,
}: DashboardHandoverProtocolUploadLauncherProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedJobId, setSelectedJobId] = useState<string>('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [selectedAttachments, setSelectedAttachments] = useState<JobAttachment[]>([])
  const [isAttachmentsLoading, setIsAttachmentsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const attachmentLoadSeqRef = useRef(0)
  const isMounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  )

  useBodyScrollLock(isOpen)

  useEffect(() => {
    if (!isOpen || successMessage) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPending) {
        setIsOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, isPending, successMessage])

  const availableJobs = useMemo(() => jobs, [jobs])

  const activeSelectedJobId = availableJobs.some((job) => job.id === selectedJobId)
    ? selectedJobId
    : ''

  useEffect(() => {
    if (!isOpen || !activeSelectedJobId) {
      setSelectedAttachments([])
      setIsAttachmentsLoading(false)
      return
    }

    const loadSeq = ++attachmentLoadSeqRef.current
    setIsAttachmentsLoading(true)
    setErrorMessage(null)

    startTransition(async () => {
      try {
        const result = await getHandoverProtocolUploadAttachmentsAction(
          activeSelectedJobId
        )

        if (attachmentLoadSeqRef.current !== loadSeq) {
          return
        }

        if (!result.success) {
          setSelectedAttachments([])
          setErrorMessage(result.error ?? 'Přílohy se nepodařilo načíst.')
          return
        }

        setSelectedAttachments(result.data.items)
      } finally {
        if (attachmentLoadSeqRef.current === loadSeq) {
          setIsAttachmentsLoading(false)
        }
      }
    })
  }, [activeSelectedJobId, isOpen])

  function closeModal() {
    setSuccessMessage(null)

    if (selectedFiles.length > 0) {
      const confirmed = window.confirm('Máš rozpracované změny. Opravdu chceš modal zavřít?')
      if (!confirmed) return
    }

    setIsOpen(false)
  }

  function handleFilesChange(files: File[]) {
    setErrorMessage(null)
    setSuccessMessage(null)
    setSelectedFiles(files)
  }

  function handleJobChange(nextJobId: string) {
    setErrorMessage(null)
    setSuccessMessage(null)
    setSelectedFiles([])
    setSelectedAttachments([])
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
    setSelectedJobId(nextJobId)
  }

  function handleUpload() {
    if (!activeSelectedJobId) {
      setErrorMessage('Vyber zakázku, ke které chceš nahrát Předávací protokol.')
      return
    }

    if (selectedFiles.length === 0) {
      setErrorMessage('Vyber alespoň jeden soubor.')
      return
    }

    setErrorMessage(null)
    setSuccessMessage(null)

    startTransition(async () => {
      try {
        const formData = new FormData()
        for (const file of selectedFiles) {
          formData.append('files', file)
        }

        const result = await uploadHandoverProtocolAttachmentsAction(activeSelectedJobId, formData)

        if (!result.success) {
          setErrorMessage(result.error ?? 'Soubor se nepodařilo nahrát.')
          return
        }

        setSelectedFiles([])
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
        setSuccessMessage('Předávací protokol byl úspěšně nahrán.')
      } catch (caughtError) {
        const message = caughtError instanceof Error ? caughtError.message : 'Neznámá chyba.'
        setErrorMessage(`Soubor se nepodařilo nahrát (${message}).`)
      }
    })
  }

  function handleSuccessAcknowledge() {
    setSuccessMessage(null)
    setIsOpen(false)
  }

  function handleOpenAttachment(attachmentId: string) {
    startTransition(async () => {
      const result = await openHandoverProtocolUploadAttachmentAction(attachmentId)

      if (!result.success || !result.signedUrl) {
        setErrorMessage(result.error ?? 'Nepodařilo se otevřít přílohu.')
        return
      }

      window.open(result.signedUrl, '_blank', 'noopener,noreferrer')
    })
  }

  function handleDownloadAttachment(attachmentId: string) {
    startTransition(async () => {
      const result = await downloadHandoverProtocolUploadAttachmentAction(
        attachmentId
      )

      if (!result.success || !result.signedUrl) {
        setErrorMessage(result.error ?? 'Nepodařilo se stáhnout přílohu.')
        return
      }

      window.open(result.signedUrl, '_blank', 'noopener,noreferrer')
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="dashboard-section-link group relative flex min-h-[112px] min-w-0 flex-col items-center justify-center gap-2.5 overflow-visible rounded-2xl px-2 py-3 text-center text-[#0b1d2c] transition lg:w-[170px]"
      >
        <span className="dashboard-section-link__icon relative inline-flex h-[74px] w-[74px] items-center justify-center rounded-[18px] border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.35),0_10px_22px_rgba(9,48,82,0.28)] backdrop-blur-xl transition-all duration-200 ease-out lg:h-[82px] lg:w-[82px] lg:group-hover:-translate-y-[2px]">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v9" />
            <path d="m8.5 8.5 3.5-3.5 3.5 3.5" />
            <path d="M5 15.5V19a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3.5" />
          </svg>
        </span>
        <span className="dashboard-section-link__label truncate text-[13px] font-semibold uppercase tracking-[0.01em] leading-tight lg:text-[15px]">
          NAHRÁT PP
        </span>
      </button>

      {isMounted && isOpen
        ? createPortal(
            <>
              <JobAttachmentsModalContent
                title="NAHRÁT PP"
                jobNumber="—"
                showJobBadge={false}
                items={selectedAttachments}
                isLoading={isAttachmentsLoading}
                isPending={isPending}
                errorMessage={errorMessage}
                categoryValue="predavaci_protokol"
                categoryOptions={FILE_CATEGORY_OPTIONS}
                selectedFiles={selectedFiles}
                fileInputRef={fileInputRef}
                showCategorySelect={false}
                uploadButtonLabel="Nahrát PP"
                showDeleteAttachment={false}
                topContent={
                  <div className="jobs-page__info-modal__upload rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                    <label className="jobs-page__info-modal__handover-job-label mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                      Zakázka
                    </label>
                    <select
                      value={activeSelectedJobId}
                      onChange={(event) => handleJobChange(event.target.value)}
                      disabled={isPending || availableJobs.length === 0}
                      data-placeholder={!activeSelectedJobId}
                      className="jobs-page__info-modal__handover-job-select jobs-page__info-modal__category-select h-10 w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] outline-none transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                      <option value="" disabled>
                        {availableJobs.length === 0
                          ? 'Žádné zakázky dostupné pro nahrání PP'
                          : 'Vyber zakázku'}
                      </option>

                      {availableJobs.map((job) => (
                        <option key={job.id} value={job.id}>
                          {formatJobLabel(job)}
                        </option>
                      ))}
                    </select>
                  </div>
                }
                onCategoryChange={() => {}}
                onFilesChange={handleFilesChange}
                onClose={closeModal}
                onUpload={handleUpload}
                onOpenAttachment={handleOpenAttachment}
                onDownloadAttachment={handleDownloadAttachment}
                onDeleteAttachment={() => {}}
              />
            </>,
            document.body
          )
        : null}

      <SuccessConfirmationModal
        isOpen={Boolean(successMessage)}
        section="Dashboard"
        message={successMessage ?? ''}
        onConfirm={handleSuccessAcknowledge}
      />
    </>
  )
}
