'use client'

import { useEffect, useState, useTransition } from 'react'
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
}

type JobsPortalTableProps = {
  jobs: PortalJobRow[]
}

const PRAGUE_TIME_ZONE = 'Europe/Prague'

export function JobsPortalTable({ jobs }: JobsPortalTableProps) {
  return (
    <>
      <section className="hidden rounded-3xl border border-gray-200 bg-white p-2 shadow-sm lg:block">
        <table className="w-full table-fixed border-separate border-spacing-y-2">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
              <th className="w-[76px] px-2 py-2">Zakázka</th>
              <th className="w-[120px] px-2 py-2">Firma</th>
              <th className="w-[94px] px-2 py-2">Osoba</th>
              <th className="w-[126px] px-2 py-2">Začátek</th>
              <th className="w-[126px] px-2 py-2">Konec</th>
              <th className="w-[144px] px-2 py-2">Adresa</th>
              <th className="w-[74px] px-2 py-2">Prodejna</th>
              <th className="w-[96px] px-2 py-2">Technik</th>
              <th className="w-[96px] px-2 py-2">Agregát</th>
              <th className="w-[86px] px-2 py-2 text-center">Info</th>
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
    <tr className="group">
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

      <td className="rounded-r-2xl border border-l-0 border-gray-200 bg-white px-2 py-2 align-middle text-center transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
        <InfoButton job={job} />
      </td>
    </tr>
  )
}

function MobileCard({ job }: { job: PortalJobRow }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight text-gray-900">
            {job.job_number}
          </p>
          <p className="mt-0.5 truncate text-sm text-gray-700">
            {job.company_name}
          </p>
        </div>

        <InfoButton job={job} compact />
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

function ReadOnlyCell({
  value,
  className = '',
}: {
  value: string | null
  className?: string
}) {
  return (
    <td
      className={`border border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70 ${className}`}
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
        className={`inline-flex h-8 items-center justify-center rounded-xl ${
          compact ? 'min-w-[78px]' : 'min-w-[78px]'
        } border px-3 text-[11px] font-medium tracking-wide transition ${
          job.info_note
            ? 'border-black bg-black text-white hover:bg-gray-800'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        {job.info_note ? 'ZOBRAZIT' : 'PŘIDAT'}
      </button>

      {isOpen ? (
        <ModalShell
          title="INFO K ZAKÁZCE"
          description={`ZAKÁZKA ${job.job_number}`}
          descriptionAsBadge
          showHeaderDivider={false}
          onClose={() => setIsOpen(false)}
        >
          <>
            <textarea
              value={draftValue}
              onChange={(event) => setDraftValue(event.target.value)}
              rows={5}
              className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
              placeholder="Doplň interní poznámku k zakázce"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                ZRUŠIT
              </button>

              <button
                type="button"
                onClick={saveInfo}
                disabled={isPending}
                className="inline-flex h-10 items-center justify-center rounded-xl bg-gray-900 px-4 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isPending ? 'UKLÁDÁM…' : 'ULOŽIT'}
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
  showHeaderDivider = true,
  onClose,
  children,
}: {
  title: string
  description?: string
  descriptionAsBadge?: boolean
  showHeaderDivider?: boolean
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

  return (
    <div
      className="fixed inset-0 z-50 bg-zinc-950/45 p-3 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-md rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl">
          <div
            className={`mb-4 flex items-start justify-between gap-4 ${
              showHeaderDivider ? 'border-b border-gray-100 pb-4' : ''
            }`}
          >
            <div className="flex flex-col items-start">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900">
                {title}
              </h2>
              {description ? (
                descriptionAsBadge ? (
                  <div className="mt-1.5 inline-flex items-center rounded-full border border-[#2980B9] bg-[#2980B9] px-3 py-1 text-xs font-bold tracking-[0.08em] text-white">
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
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          {children}
        </div>
      </div>
    </div>
  )
}

function formatDateTime(value: string | null) {
  if (!value) return '—'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: PRAGUE_TIME_ZONE,
  }).format(new Date(value))
}
