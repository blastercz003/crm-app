'use client'

import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { updatePortalJobInfoAction } from './actions'

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
  job_status: JobStatus | null
}

type JobsPortalTableProps = {
  jobs: PortalJobRow[]
}

type JobStatus = 'nova' | 'k_reseni' | 'realizace' | 'ukoncena' | 'storno'

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const STATUS_BADGE_WIDTH_CLASS = 'min-w-[100px]'
const STATUS_BADGE_COMPACT_WIDTH_CLASS = 'min-w-[88px]'
const GLASS_SECONDARY_BUTTON_CLASS =
  'rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_9px_14px_rgba(15,23,42,0.07)]'
const GLASS_DARK_BUTTON_CLASS =
  'rounded-xl border border-zinc-900 bg-zinc-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out hover:-translate-y-[1px] hover:bg-zinc-800 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.17),0_11px_16px_rgba(24,24,27,0.22)]'

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
        <JobStatusBadge status={job.job_status} />
      </td>
    </tr>
  )
}

function MobileCard({ job }: { job: PortalJobRow }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.95)_0%,rgba(242,247,252,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_24px_rgba(15,23,42,0.1)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight text-gray-900">
            {job.job_number}
          </p>
          <p className="mt-0.5 truncate text-sm text-gray-700">
            {job.company_name}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <JobStatusBadge status={job.job_status} compact />
          <InfoButton job={job} compact />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] leading-5 text-gray-600">
        <div className="min-w-0">
          <span className="font-medium text-gray-900">Osoba:</span>{' '}
          <span className="break-words">{job.contact_person || '—'}</span>
        </div>

        <div className="min-w-0">
          <span className="font-medium text-gray-900">Prodejna:</span>{' '}
          <span className="break-words">{job.store_number || '—'}</span>
        </div>

        <div className="min-w-0">
          <span className="font-medium text-gray-900">Začátek:</span>{' '}
          <span className="break-words">{formatDateTime(job.start_at)}</span>
        </div>

        <div className="min-w-0">
          <span className="font-medium text-gray-900">Konec:</span>{' '}
          <span className="break-words">{formatDateTime(job.end_at)}</span>
        </div>

        <div className="col-span-2 min-w-0">
          <span className="font-medium text-gray-900">Adresa:</span>{' '}
          <span className="break-words">{job.site_address || '—'}</span>
        </div>

        <div className="min-w-0">
          <span className="font-medium text-gray-900">Technik:</span>{' '}
          <span className="break-words">{job.technician_name || '—'}</span>
        </div>

        <div className="min-w-0">
          <span className="font-medium text-gray-900">Agregát:</span>{' '}
          <span className="break-words">{job.generator_name || '—'}</span>
        </div>
      </div>
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
  const [draftValue, setDraftValue] = useState(job.info_note ?? '')
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    setDraftValue(job.info_note ?? '')
  }, [job.info_note])

  function saveInfo() {
    startTransition(async () => {
      const formData = new FormData()
      formData.set('info_note', draftValue)

      const result = await updatePortalJobInfoAction(
        job.id,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        alert(result.error ?? 'Info k zakázce se nepodařilo uložit.')
        return
      }

      setIsOpen(false)
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`inline-flex h-8 items-center justify-center px-3 text-[11px] font-bold uppercase ${
          compact ? STATUS_BADGE_COMPACT_WIDTH_CLASS : STATUS_BADGE_WIDTH_CLASS
        } ${
          job.info_note
            ? GLASS_DARK_BUTTON_CLASS
            : GLASS_SECONDARY_BUTTON_CLASS
        }`}
      >
        {job.info_note ? 'ZOBRAZIT' : 'PŘIDAT'}
      </button>

      {isOpen ? (
        <ModalShell
          title="Info k zakázce"
          description={job.job_number}
          descriptionAsBadge
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

            <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(185,28,28,0.2)]"
              >
                ZRUŠIT
              </button>

              <button
                type="button"
                onClick={saveInfo}
                disabled={isPending}
                className="inline-flex h-10 items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? 'UKLÁDÁM…' : 'ULOŽIT INFO'}
              </button>
            </div>
          </>
        </ModalShell>
      ) : null}
    </>
  )
}

function ModalShell({
  title,
  description,
  descriptionAsBadge = false,
  onClose,
  children,
}: {
  title: string
  description?: string
  descriptionAsBadge?: boolean
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
          <div className="flex items-center justify-between border-b border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-5 py-4">
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

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_14px_28px_rgba(39,39,42,0.18)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
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
