'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { ChangesButton } from './changes-button'
import {
  acknowledgeAllJobChangesAction,
  getJobsChangesModalDataAction,
  type ChangesNewJobItem,
  type ChangesUpdatedJobItem,
} from './changes-actions'
import { updateJobEvidenceStatusAction } from './actions'

type ChangesLauncherProps = {
  initialCount: number
  className?: string
}

type ChangesModalData = {
  newJobs: ChangesNewJobItem[]
  updatedJobs: ChangesUpdatedJobItem[]
  badgeCount: number
}

const INITIAL_DATA: ChangesModalData = {
  newJobs: [],
  updatedJobs: [],
  badgeCount: 0,
}

export function ChangesLauncher({
  initialCount,
  className,
}: ChangesLauncherProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isLoading, startLoading] = useTransition()
  const [isSaving, startSaving] = useTransition()
  const [data, setData] = useState<ChangesModalData>({
    ...INITIAL_DATA,
    badgeCount: initialCount,
  })
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)
  const [pinnedNewJobs, setPinnedNewJobs] = useState<Record<string, ChangesNewJobItem>>({})
  const [error, setError] = useState<string | null>(null)

  async function reloadData(pinnedSnapshot?: Record<string, ChangesNewJobItem>) {
    let result: Awaited<ReturnType<typeof getJobsChangesModalDataAction>>

    try {
      result = await getJobsChangesModalDataAction()
    } catch (requestError) {
      console.error('Nepodařilo se načíst data změn.', requestError)
      setError('Nepodařilo se načíst data modalu změn.')
      return
    }

    if (!result.success || !result.data) {
      setError(result.error ?? 'Nepodařilo se načíst změny.')
      return
    }

    const serverData = result.data

    const mergedNewJobsMap = new Map<string, ChangesNewJobItem>()
    serverData.newJobs.forEach((item) => {
      mergedNewJobsMap.set(item.jobId, item)
    })

    const pinnedSource = pinnedSnapshot ?? pinnedNewJobs

    Object.values(pinnedSource).forEach((item) => {
      if (!mergedNewJobsMap.has(item.jobId)) {
        mergedNewJobsMap.set(item.jobId, item)
      }
    })

    const mergedNewJobs = Array.from(mergedNewJobsMap.values()).sort((a, b) => {
      const aStart = a.startAt ? Date.parse(a.startAt) : Number.POSITIVE_INFINITY
      const bStart = b.startAt ? Date.parse(b.startAt) : Number.POSITIVE_INFINITY

      if (aStart !== bStart) return aStart - bStart

      const aEnd = a.endAt ? Date.parse(a.endAt) : Number.POSITIVE_INFINITY
      const bEnd = b.endAt ? Date.parse(b.endAt) : Number.POSITIVE_INFINITY

      if (aEnd !== bEnd) return aEnd - bEnd

      return a.jobNumber.localeCompare(b.jobNumber, 'cs', { sensitivity: 'base' })
    })

    setData({
      ...serverData,
      newJobs: mergedNewJobs,
      badgeCount: mergedNewJobs.length + serverData.updatedJobs.length,
    })
    setError(null)
  }

  function openModal() {
    setIsOpen(true)
    startLoading(async () => {
      await reloadData()
    })
  }

  function closeModal() {
    setIsOpen(false)
  }

  useEffect(() => {
    if (!isOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isOpen])

  async function handleEvidenceToggle(job: ChangesNewJobItem) {
    startSaving(async () => {
      const nextStatus = job.evidenceStatus === 'nove' ? 'zapsano' : 'nove'
      const formData = new FormData()
      formData.set('evidence_status', nextStatus)

      const result = await updateJobEvidenceStatusAction(
        job.jobId,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        setError(result.error ?? 'Stav evidence se nepodařilo uložit.')
        return
      }

      let nextPinnedState: Record<string, ChangesNewJobItem>
      if (nextStatus === 'zapsano') {
        nextPinnedState = {
          ...pinnedNewJobs,
          [job.jobId]: {
            ...job,
            evidenceStatus: 'zapsano',
            updatedAt: new Date().toISOString(),
          },
        }
      } else {
        nextPinnedState = { ...pinnedNewJobs }
        delete nextPinnedState[job.jobId]
      }

      setPinnedNewJobs(nextPinnedState)
      await reloadData(nextPinnedState)
    })
  }

  async function handleAcknowledgeAll() {
    startSaving(async () => {
      let result: Awaited<ReturnType<typeof acknowledgeAllJobChangesAction>>

      try {
        result = await acknowledgeAllJobChangesAction()
      } catch (requestError) {
        console.error('Nepodařilo se potvrdit zaevidování změn.', requestError)
        setError('Nepodařilo se potvrdit zaevidování změn.')
        return
      }

      if (!result.success) {
        setError(result.error ?? 'Nepodařilo se potvrdit zaevidování změn.')
        return
      }

      setPinnedNewJobs({})

      try {
        await reloadData()
      } catch (requestError) {
        console.error('Nepodařilo se obnovit data modalu změn.', requestError)
        setError('Potvrzení proběhlo, ale nepodařilo se obnovit data modalu změn.')
        return
      }

      setIsOpen(false)
    })
  }

  const badgeCount = data.badgeCount
  const hasItems = data.newJobs.length > 0 || data.updatedJobs.length > 0
  const pending = isLoading || isSaving

  const modalContent = isOpen ? (
    <div
      className="fixed inset-0 z-[160] overflow-y-auto bg-zinc-950/38 p-4 backdrop-blur-[5px] lg:backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeModal()
        }
      }}
    >
      <div
        className="flex min-h-full items-start justify-center py-4 sm:items-center sm:py-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
      >
        <div
          className="jobs-page__modal-shell relative flex w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]"
          style={{
            maxHeight:
              'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
          }}
        >
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-4 py-3 sm:px-5 sm:py-4">
                <div className="min-w-0">
                  <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                    Aktuální změny:
                  </h2>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {hasItems || pending ? (
                      <div className="inline-flex items-center rounded-full border border-orange-400/85 bg-[linear-gradient(155deg,#ff8b2b_0%,#ff6a00_100%)] px-3 py-1 text-xs font-bold tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(249,115,22,0.24)]">
                        POČET: {data.badgeCount}
                      </div>
                    ) : (
                      <div className="inline-flex items-center rounded-full border border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] px-3 py-1 text-xs font-bold tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(16,185,129,0.22)]">
                        VŠE ZAPSÁNO
                      </div>
                    )}
                  </div>
                </div>

            <button
              type="button"
              onClick={closeModal}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_14px_28px_rgba(39,39,42,0.18)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
            <div className="grid gap-4">
                  <section className="jobs-page__changes-section rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_20px_rgba(15,23,42,0.08)]">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.04em] text-gray-900">
                    NOVÉ ZAKÁZKY
                  </h3>
                </div>

                {data.newJobs.length === 0 ? (
                  <p className="text-sm text-gray-500">Žádné nové zakázky.</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.newJobs.map((job) => (
                      <div
                        key={job.jobId}
                        className="jobs-page__changes-row grid grid-cols-[minmax(0,1fr)_98px] min-[340px]:grid-cols-[minmax(0,1fr)_108px] sm:grid-cols-[minmax(0,1fr)_108px] items-center gap-1.5 rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-2 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
                      >
                        <div className="min-w-0">
                          <div
                            className="min-w-0 truncate whitespace-nowrap text-[10px] min-[340px]:text-[11px] font-medium text-gray-900 sm:hidden"
                            title={`${job.jobNumber} · ${formatDateRange(job.startAt, job.endAt)}`}
                          >
                            <span className="font-bold">{job.jobNumber}</span> · <span className="font-bold">{formatDateRange(job.startAt, job.endAt)}</span>
                          </div>
                          <div
                            className="mt-0.5 min-w-0 truncate whitespace-nowrap text-[10px] min-[340px]:text-[11px] font-medium text-gray-700 sm:hidden"
                            title={job.companyName}
                          >
                            {job.companyName}
                          </div>
                          <div
                            className="mt-0.5 min-w-0 truncate whitespace-nowrap text-[10px] min-[340px]:text-[11px] font-medium text-gray-700 sm:hidden"
                            title={getCityFromAddress(job.siteAddress)}
                          >
                            {getCityFromAddress(job.siteAddress)}
                          </div>
                          <div
                            className="mt-0.5 min-w-0 truncate whitespace-nowrap text-[10px] min-[340px]:text-[11px] font-medium text-gray-700 sm:hidden"
                            title={`${job.technicianName} · ${job.generatorName}`}
                          >
                            {job.technicianName} · {job.generatorName}
                          </div>

                          <div
                            className="hidden min-w-0 truncate whitespace-nowrap text-[13px] font-medium text-gray-900 sm:block"
                            title={`${job.jobNumber} · ${formatDateRange(job.startAt, job.endAt)} · ${job.companyName} · ${getCityFromAddress(job.siteAddress)} · ${job.technicianName} · ${job.generatorName}`}
                          >
                            <span className="font-bold">{job.jobNumber}</span> · {formatDateRange(job.startAt, job.endAt)} · {job.companyName} · {getCityFromAddress(job.siteAddress)} · {job.technicianName} · {job.generatorName}
                          </div>
                        </div>

                        <button
                          type="button"
                          disabled={pending}
                          onClick={() => handleEvidenceToggle(job)}
                          className={`inline-flex h-7 min-w-[84px] min-[340px]:h-8 min-[340px]:min-w-[98px] sm:min-w-[108px] items-center justify-center rounded-xl px-2 text-[10px] min-[340px]:text-[11px] font-bold uppercase transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60 ${
                            job.evidenceStatus === 'nove'
                              ? 'border border-[#7fb2d6] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_6px_12px_rgba(41,128,185,0.16)]'
                              : 'border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_12px_rgba(15,23,42,0.06)]'
                          }`}
                        >
                          {job.evidenceStatus === 'nove' ? 'ZAPSAT' : 'ZAPSANO'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

                  <section className="jobs-page__changes-section rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_20px_rgba(15,23,42,0.08)]">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold uppercase tracking-[0.04em] text-gray-900">
                    Provedené změny
                  </h3>
                </div>

                {data.updatedJobs.length === 0 ? (
                  <p className="text-sm text-gray-500">Žádné provedené změny.</p>
                ) : (
                  <div className="space-y-1.5">
                    {data.updatedJobs.map((item) => (
                      <div
                        key={item.jobId}
                        className="jobs-page__changes-row rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-2 py-2 text-[10px] leading-5 min-[340px]:px-2.5 min-[340px]:text-[11px] sm:text-[13px] font-medium text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
                        title={`${item.jobNumber} · Změny: ${item.changedFieldsLabel}`}
                      >
                        <span className="font-bold">{item.jobNumber}</span> · Změny: {item.changedFieldsLabel}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  {error}
                </div>
              ) : null}

            </div>
          </div>

          <div className="jobs-page__changes-footer flex shrink-0 items-center justify-between gap-2 border-t border-[rgba(148,163,184,0.14)] px-4 py-3 sm:px-5">
            <button
              type="button"
              onClick={closeModal}
              className="jobs-page__changes-modal-cancel inline-flex h-10 min-w-[104px] items-center justify-center rounded-xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-3 text-sm font-medium uppercase text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(185,28,28,0.2)]"
            >
              ZRUŠIT
            </button>

            <button
              type="button"
              disabled={pending}
              onClick={() => setIsConfirmOpen(true)}
              className="jobs-page__changes-modal-confirm inline-flex h-10 min-w-[116px] items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span className="sm:hidden">{pending ? 'UKLÁDÁM…' : 'ULOŽIT'}</span>
              <span className="hidden sm:inline">{pending ? 'ZPRACOVÁVÁM…' : 'ZAPSÁNO - ULOŽIT'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  ) : null

  return (
    <>
      <ChangesButton count={badgeCount} className={className} onClick={openModal} />

      {modalContent && typeof document !== 'undefined'
        ? createPortal(modalContent, document.body)
        : null}
      {isConfirmOpen && typeof document !== 'undefined'
        ? createPortal(
            <div
              className="fixed inset-0 z-[170] flex items-center justify-center bg-zinc-950/42 p-4 backdrop-blur-[4px]"
              role="dialog"
              aria-modal="true"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) {
                  setIsConfirmOpen(false)
                }
              }}
            >
              <div className="w-full max-w-sm rounded-2xl border border-zinc-200/90 bg-[linear-gradient(168deg,rgba(255,255,255,0.92)_0%,rgba(249,250,251,0.86)_50%,rgba(244,244,245,0.8)_100%)] p-4 shadow-[0_24px_56px_rgba(24,24,27,0.28)] sm:p-5">
                <div className="text-base font-semibold text-gray-900">Potvrzení</div>
                <p className="mt-2 text-sm text-gray-700">
                  Opravdu máš zapsané všechny nové zakázky?
                </p>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => setIsConfirmOpen(false)}
                    className="jobs-page__changes-modal-cancel inline-flex h-10 min-w-[104px] items-center justify-center rounded-xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-3 text-sm font-medium uppercase text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(185,28,28,0.2)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    ZRUŠIT
                  </button>
                  <button
                    type="button"
                    disabled={isSaving}
                    onClick={() => {
                      setIsConfirmOpen(false)
                      void handleAcknowledgeAll()
                    }}
                    className="jobs-page__changes-modal-confirm inline-flex h-10 min-w-[116px] items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving ? 'UKLÁDÁM…' : 'POTVRDIT'}
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  )
}

function formatDateRange(startAt: string | null, endAt: string | null) {
  if (!startAt) return '—'

  const start = new Date(startAt)
  if (Number.isNaN(start.getTime())) return '—'

  const startDay = getDayMonth(start)

  if (!endAt) return startDay

  const end = new Date(endAt)
  if (Number.isNaN(end.getTime())) return startDay

  const sameDay =
    start.getUTCFullYear() === end.getUTCFullYear() &&
    start.getUTCMonth() === end.getUTCMonth() &&
    start.getUTCDate() === end.getUTCDate()

  if (sameDay) {
    return startDay
  }

  return `${getDayOnly(start)} - ${getDayMonth(end)}`
}

function getCityFromAddress(address: string | null) {
  const value = String(address ?? '').trim()
  if (!value) return '—'

  const firstPart = value.split(',')[0]?.trim()
  return firstPart || value
}

function getDayMonth(value: Date) {
  const parts = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
  }).formatToParts(value)

  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''

  return day && month ? `${day}.${month}.` : '—'
}

function getDayOnly(value: Date) {
  const parts = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
  }).formatToParts(value)

  const day = parts.find((part) => part.type === 'day')?.value ?? ''

  return day ? `${day}.` : '—'
}
