'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import { JobAttachmentsModalContent } from '@/components/attachments/job-attachments-modal-content'
import {
  uploadHandoverProtocolAttachmentsAction,
  type HandoverProtocolUploadJobOption,
} from '@/app/dashboard/handover-protocol-upload-actions'

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
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const fileInputRef = useRef<HTMLInputElement>(null)
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
                items={[]}
                isLoading={false}
                isPending={isPending}
                errorMessage={errorMessage}
                categoryValue="predavaci_protokol"
                categoryOptions={FILE_CATEGORY_OPTIONS}
                selectedFiles={selectedFiles}
                fileInputRef={fileInputRef}
                showCategorySelect={false}
                uploadButtonLabel="Nahrát PP"
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
                          ? 'Nemáš žádné zakázky bez nahraného PP'
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
                onOpenAttachment={() => {}}
                onDownloadAttachment={() => {}}
                onDeleteAttachment={() => {}}
              />

              {successMessage ? (
                <div className="fixed inset-0 z-[130] bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]">
                  <div className="mx-auto flex h-full w-full max-w-5xl items-center justify-center">
                    <div
                      className="relative w-full max-w-md overflow-hidden rounded-[28px] border p-5"
                      style={{
                        background:
                          'linear-gradient(168deg, var(--surface-strong) 0%, var(--surface) 45%, var(--surface-muted) 100%)',
                        color: 'var(--text-primary)',
                        borderColor: 'var(--surface-border)',
                        boxShadow:
                          'inset 0 1px 0 var(--surface-border), 0 30px 72px rgba(24,24,27,0.28)',
                      }}
                    >
                      <div className="relative flex flex-col items-center text-center">
                        <div className="inline-flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/25 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(16,185,129,0.22)]">
                          <svg
                            viewBox="0 0 24 24"
                            className="h-6 w-6"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        </div>

                        <h3 className="mt-4 text-lg font-semibold tracking-tight">
                          Hotovo
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-[color:var(--text-secondary)]">
                          {successMessage}
                        </p>

                        <button
                          type="button"
                          onClick={handleSuccessAcknowledge}
                          className="mt-5 inline-flex h-10 min-w-[116px] items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)]"
                        >
                          OK
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </>,
            document.body
          )
        : null}
    </>
  )
}
