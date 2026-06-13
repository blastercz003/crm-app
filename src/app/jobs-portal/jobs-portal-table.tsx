'use client'

import { useState } from 'react'
import {
  updatePortalJobInfoAction,
  updatePortalJobInfoAlertAction,
} from './actions'
import { InfoNoteButton } from '@/app/jobs/info-note-button'
import { GLASS_SECONDARY_BUTTON_CLASS } from '@/components/ui/glass-secondary-button'

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

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const STATUS_BADGE_WIDTH_CLASS = 'min-w-[100px]'
const STATUS_BADGE_COMPACT_WIDTH_CLASS = 'min-w-[88px]'

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
      <section className="jobs-page__table-shell jobs-portal-page__table-shell hidden overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:block">
        <table className="jobs-page__table w-full table-fixed border-separate border-spacing-y-2">
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

          <tbody className="jobs-page__table-body">
            {jobs.map((job) => (
              <DesktopRow key={job.id} job={job} />
            ))}
          </tbody>
        </table>
      </section>

      <section className="jobs-portal-page__mobile-shell grid gap-3 lg:hidden">
        {jobs.map((job) => (
          <MobileCard key={job.id} job={job} />
        ))}
      </section>
    </>
  )
}

function DesktopRow({ job }: { job: PortalJobRow }) {
  return (
    <tr className="jobs-page__table-row group [background:linear-gradient(160deg,rgba(255,255,255,0.95)_0%,rgba(242,247,252,0.88)_100%)] transition duration-200 hover:-translate-y-[1px]">
      <ReadOnlyCell
        value={job.job_number}
        className="rounded-l-2xl border-r-0 font-semibold text-gray-900"
        variant="primary"
      />
      <ReadOnlyCell value={job.company_name} className="border-l-0 border-r-0" variant="primary" />
      <ReadOnlyCell value={job.contact_person} className="border-l-0 border-r-0" variant="primary" />
      <ReadOnlyCell value={formatDateTime(job.start_at)} className="border-l-0 border-r-0" />
      <ReadOnlyCell value={formatDateTime(job.end_at)} className="border-l-0 border-r-0" />
      <ReadOnlyCell value={job.site_address} className="border-l-0 border-r-0" />
      <ReadOnlyCell value={job.store_number} className="border-l-0 border-r-0" />
      <ReadOnlyCell value={job.technician_name} className="border-l-0 border-r-0" />
      <ReadOnlyCell value={job.generator_name} className="border-l-0 border-r-0" />

      <td className="jobs-page__table-row border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-2 py-2 align-middle text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf]">
        <div className="flex items-center justify-center gap-2">
          <InfoNoteButton
            jobId={job.id}
            jobNumber={job.job_number}
            infoNote={job.info_note}
            hasInfoAttachments={Boolean(job.has_info_attachments)}
            infoAlertEnabled={Boolean(job.info_alert_enabled)}
            jobStatus={job.job_status}
            updateInfoAction={updatePortalJobInfoAction}
            updateInfoAlertAction={updatePortalJobInfoAlertAction}
          />
        </div>
      </td>

      <td className="jobs-page__table-row rounded-r-2xl border border-l-0 border-[#cfd8e3] bg-transparent px-2 py-2 align-middle text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf]">
        <JobStatusBadge status={getEffectiveJobStatus(job)} />
      </td>
    </tr>
  )
}

function MobileCard({ job }: { job: PortalJobRow }) {
  const [isActionsOpen, setIsActionsOpen] = useState(false)
  const showInfoAlertDot = Boolean(job.info_alert_enabled) && Boolean(job.has_info_content)

  return (
    <div className="jobs-page__mobile-card jobs-portal-page__mobile-card overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.95)_0%,rgba(242,247,252,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_24px_rgba(15,23,42,0.1)]">
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
          <InfoNoteButton
            jobId={job.id}
            jobNumber={job.job_number}
            infoNote={job.info_note}
            hasInfoAttachments={Boolean(job.has_info_attachments)}
            infoAlertEnabled={Boolean(job.info_alert_enabled)}
            jobStatus={job.job_status}
            variant="mobile"
            compact
            updateInfoAction={updatePortalJobInfoAction}
            updateInfoAlertAction={updatePortalJobInfoAlertAction}
          />
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
      data-status={meta.value}
      className={`jobs-page__job-status-button inline-flex h-8 items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase ${widthClass} ${meta.className}`}
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
  variant = 'generic',
}: {
  value: string | null
  className?: string
  variant?: 'generic' | 'company' | 'primary'
}) {
  const valueClassName =
    variant === 'primary'
      ? 'jobs-page__portal-primary-cell-value block w-full rounded-lg px-1 py-1 text-left text-[12px] text-gray-700 print:px-0 print:py-0 print:text-[11px]'
      : variant === 'company'
      ? 'jobs-page__company-cell-value block w-full rounded-lg px-1 py-1 text-left text-[12px] text-gray-700 print:px-0 print:py-0 print:text-[11px]'
      : 'jobs-page__table-cell-value block w-full rounded-lg px-1 py-1 text-left text-[12px] text-gray-700 print:px-0 print:py-0 print:text-[11px]'

  return (
    <td
      className={`border border-[#cfd8e3] bg-transparent px-2 py-2 align-middle shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf] ${className}`}
    >
      <div className={valueClassName}>
        <span className="block truncate">{value || '—'}</span>
      </div>
    </td>
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
