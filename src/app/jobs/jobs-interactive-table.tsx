'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import {
  updateJobEvidenceStatusAction,
  updateJobInlineFieldAction,
  updateJobStatusAction,
} from './actions'
import { EditJobButton } from './edit-job-button'
import { HandoverProtocolButton } from './handover-protocol-button'
import { InfoNoteButton } from './info-note-button'
import { TechnicianNamesInput } from './technician-names-input'
import { finalizeTechnicianInputValue } from '@/lib/jobs/technicians'
import { GLASS_SECONDARY_BUTTON_CLASS } from '@/components/ui/glass-secondary-button'
import { SuccessConfirmationModal } from '@/components/ui/success-confirmation-modal'

type JobStatus =
  | 'nova'
  | 'k_reseni'
  | 'realizace'
  | 'ukoncena'
  | 'storno'

type EvidenceStatus = 'nove' | 'zapsano'
type SalesOwner = 'JIŘÍ' | 'MICHAL' | 'LÍDA'

type ClientOption = {
  id: string
  name: string
}

type ClientContactOption = {
  id: string
  client_id: string
  name: string
  is_primary: boolean
}

type OfferOption = {
  id: string
  client_id: string
  offer_number: string
  title: string
}

type JobRow = {
  id: string
  job_number: string
  company_name: string
  client_id?: string | null
  offer_id?: string | null
  client_contact_id?: string | null
  contact_person: string | null
  sales_owner: SalesOwner
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  technician_name: string | null
  generator_name: string | null
  info_note: string | null
  pp_required?: boolean
  info_alert_enabled?: boolean | null
  has_info_attachments?: boolean
  has_info_content?: boolean
  handover_protocol_is_sent?: boolean | null
  job_status: JobStatus
  evidence_status: EvidenceStatus
  invoice_status: 'bez_faktury' | 'k_fakturaci' | 'vyfakturovano'
}

type InlineEditableField =
  | 'company_name'
  | 'contact_person'
  | 'start_at'
  | 'end_at'
  | 'site_address'
  | 'store_number'
  | 'technician_name'
  | 'generator_name'

type JobsInteractiveTableProps = {
  jobs: JobRow[]
  clientSuggestions: ClientOption[]
  clientContacts: ClientContactOption[]
  offerSuggestions: OfferOption[]
  jobOfferSuggestions: OfferOption[]
  technicianSuggestions?: string[]
  isAdmin: boolean
  allowEditing?: boolean
  showReadOnlyInfo?: boolean
  showEvidenceColumn?: boolean
  showHandoverProtocolPdfColumn?: boolean
  collapseReadOnlyMobileActions?: boolean
}

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const STATUS_BUTTON_WIDTH_CLASS = 'min-w-[108px]'
const EVIDENCE_BUTTON_WIDTH_CLASS = 'min-w-[108px]'
function getEffectiveJobStatus(job: JobRow): JobStatus {
  if (job.job_status !== 'realizace' && job.job_status !== 'ukoncena') {
    return job.job_status
  }

  const endAt = new Date(job.end_at)

  if (Number.isNaN(endAt.getTime())) {
    return job.job_status
  }

  return endAt.getTime() < Date.now() ? 'ukoncena' : 'realizace'
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('cs')
}

export function JobsInteractiveTable({
  jobs,
  clientSuggestions,
  clientContacts,
  offerSuggestions,
  jobOfferSuggestions,
  technicianSuggestions = [],
  isAdmin,
  allowEditing = true,
  showReadOnlyInfo = false,
  showEvidenceColumn = true,
  showHandoverProtocolPdfColumn = false,
  collapseReadOnlyMobileActions = false,
}: JobsInteractiveTableProps) {
  const [visibleJobs, setVisibleJobs] = useState(jobs)

  useEffect(() => {
    setVisibleJobs(jobs)
  }, [jobs])

  function updateVisibleJob(jobId: string, nextValues: Partial<JobRow>) {
    setVisibleJobs((currentJobs) =>
      currentJobs.map((job) =>
        job.id === jobId
          ? {
              ...job,
              ...nextValues,
            }
          : job
      )
    )
  }

  return (
    <>
      <section className="print-header print:block hidden overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:block">
        <div className="print:max-h-none print:overflow-visible">
        <table className="jobs-page__table w-full table-fixed border-separate border-spacing-y-2 print:border-collapse print:border-spacing-y-0">
          <thead className="bg-transparent shadow-[0_1px_0_0_#e5e7eb]">
            <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 print:text-[9px]">
              <th className="w-[76px] px-2 py-2 print:w-[70px] print:px-1.5 print:py-1.5">
                Zakázka
              </th>
              {showEvidenceColumn ? (
                <th className="w-[112px] px-2 py-2 text-center print:hidden">
                  Evidence
                </th>
              ) : null}
              <th className="w-[120px] px-2 py-2 print:w-[130px] print:px-1.5 print:py-1.5">
                Firma
              </th>
              <th className="w-[94px] px-2 py-2 print:hidden">Osoba</th>
              <th className="w-[126px] px-2 py-2 print:w-[118px] print:px-1.5 print:py-1.5">
                Začátek
              </th>
              <th className="w-[126px] px-2 py-2 print:w-[118px] print:px-1.5 print:py-1.5">
                Konec
              </th>
              <th className="w-[144px] px-2 py-2 print:w-[150px] print:px-1.5 print:py-1.5">
                Adresa
              </th>
              <th className="w-[74px] px-2 py-2 print:hidden">Prodejna</th>
              <th className="w-[96px] px-2 py-2 print:w-[88px] print:px-1.5 print:py-1.5">
                Technik
              </th>
              <th className="w-[96px] px-2 py-2 print:w-[88px] print:px-1.5 print:py-1.5">
                Agregát
              </th>
              <th className="w-[128px] px-2 py-2 text-center print:hidden">
                Info
              </th>
              {showHandoverProtocolPdfColumn ? (
                <th className="w-[64px] px-2 py-2 text-center print:hidden">
                  PP
                </th>
              ) : null}
              <th className="w-[112px] px-2 py-2 text-center print:w-[108px] print:px-1.5 print:py-1.5">
                Stav
              </th>
            </tr>
          </thead>

          <tbody className="jobs-page__table-body">
            {visibleJobs.map((job) => (
              <DesktopRow
                key={job.id}
                job={job}
                clientSuggestions={clientSuggestions}
                clientContacts={clientContacts}
                offerSuggestions={offerSuggestions}
                jobOfferSuggestions={jobOfferSuggestions}
                technicianSuggestions={technicianSuggestions}
                isAdmin={isAdmin}
                allowEditing={allowEditing}
                showReadOnlyInfo={showReadOnlyInfo}
                showEvidenceColumn={showEvidenceColumn}
                showHandoverProtocolPdfColumn={showHandoverProtocolPdfColumn}
              />
            ))}
          </tbody>
        </table>
        </div>
      </section>

      <section className="grid gap-3 print:hidden lg:hidden">
            {visibleJobs.map((job) => (
              <MobileCard
                key={job.id}
                job={job}
                clientSuggestions={clientSuggestions}
                clientContacts={clientContacts}
                offerSuggestions={offerSuggestions}
                jobOfferSuggestions={jobOfferSuggestions}
                technicianSuggestions={technicianSuggestions}
                isAdmin={isAdmin}
                allowEditing={allowEditing}
                showReadOnlyInfo={showReadOnlyInfo}
                showHandoverProtocolPdfColumn={showHandoverProtocolPdfColumn}
                collapseReadOnlyMobileActions={collapseReadOnlyMobileActions}
                onJobUpdate={updateVisibleJob}
              />
            ))}
          </section>
    </>
  )
}

function DesktopRow({
  job,
  clientSuggestions,
  clientContacts,
  offerSuggestions,
  jobOfferSuggestions,
  technicianSuggestions,
  isAdmin,
  allowEditing,
  showReadOnlyInfo,
  showEvidenceColumn,
  showHandoverProtocolPdfColumn,
}: {
  job: JobRow
  clientSuggestions: ClientOption[]
  clientContacts: ClientContactOption[]
  offerSuggestions: OfferOption[]
  jobOfferSuggestions: OfferOption[]
  technicianSuggestions: string[]
  isAdmin: boolean
  allowEditing: boolean
  showReadOnlyInfo: boolean
  showEvidenceColumn: boolean
  showHandoverProtocolPdfColumn: boolean
}) {
  return (
    <tr className="jobs-page__table-row group [background:linear-gradient(160deg,rgba(255,255,255,0.95)_0%,rgba(242,247,252,0.88)_100%)] transition duration-200 hover:-translate-y-[1px]">
      <td className="rounded-l-2xl border border-r-0 border-[#cfd8e3] bg-transparent px-2 py-2 align-middle shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf] print:rounded-none print:border print:px-1.5 print:py-1.5">
        <EditJobButton
          job={job}
          clientSuggestions={clientSuggestions}
          clientContacts={clientContacts}
          offerSuggestions={offerSuggestions}
          jobOfferSuggestions={jobOfferSuggestions}
          technicianSuggestions={technicianSuggestions}
          isAdmin={isAdmin}
          className="jobs-page__job-edit-button jobs-page__job-number-button inline-flex items-center justify-start px-1 py-1 text-[12px] font-bold leading-tight"
        >
          <span className="block truncate print:text-[11px]">
            {job.job_number}
          </span>
        </EditJobButton>
      </td>

      {showEvidenceColumn ? (
        <td className="border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-2 py-2 align-middle text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf] print:hidden">
          <EvidenceStatusButton job={job} canEdit={allowEditing} />
        </td>
      ) : null}

      <EditableCell
        job={job}
        field="company_name"
        value={job.company_name}
        canEdit={allowEditing && isAdmin}
        clientSuggestions={clientSuggestions}
        technicianSuggestions={technicianSuggestions}
      />
      <EditableCell
        job={job}
        field="contact_person"
        value={job.contact_person}
        printHidden
        canEdit={allowEditing && isAdmin}
        technicianSuggestions={technicianSuggestions}
      />
      <EditableCell
        job={job}
        field="start_at"
        value={job.start_at}
        type="datetime"
        canEdit={allowEditing && isAdmin}
        technicianSuggestions={technicianSuggestions}
      />
      <EditableCell
        job={job}
        field="end_at"
        value={job.end_at}
        type="datetime"
        canEdit={allowEditing && isAdmin}
        technicianSuggestions={technicianSuggestions}
      />
      <EditableCell
        job={job}
        field="site_address"
        value={job.site_address}
        canEdit={allowEditing && isAdmin}
        technicianSuggestions={technicianSuggestions}
      />
      <EditableCell
        job={job}
        field="store_number"
        value={job.store_number}
        printHidden
        canEdit={allowEditing && isAdmin}
        technicianSuggestions={technicianSuggestions}
      />
      <EditableCell
        job={job}
        field="technician_name"
        value={job.technician_name}
        canEdit={allowEditing}
        technicianSuggestions={technicianSuggestions}
      />
      <EditableCell
        job={job}
        field="generator_name"
        value={job.generator_name}
        canEdit={allowEditing}
        technicianSuggestions={technicianSuggestions}
      />

      <td className="border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-2 py-2 align-middle text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf] print:hidden">
        <div className="flex items-center justify-center gap-2">
          {allowEditing ? (
            <>
              <HandoverProtocolButton
                job={job}
                className="jobs-page__handover-button"
              />
              <InfoNoteButton
                jobId={job.id}
                jobNumber={job.job_number}
                infoNote={job.info_note}
                hasInfoAttachments={job.has_info_attachments}
                infoAlertEnabled={Boolean(job.info_alert_enabled)}
                jobStatus={job.job_status}
                className="jobs-page__info-button"
              />
            </>
          ) : (
            <>
              {showReadOnlyInfo && job.has_info_content ? (
                <InfoNoteButton
                  jobId={job.id}
                  jobNumber={job.job_number}
                  infoNote={job.info_note}
                  hasInfoAttachments={job.has_info_attachments}
                  infoAlertEnabled={Boolean(job.info_alert_enabled)}
                  jobStatus={job.job_status}
                  readOnly
                  className="jobs-page__info-button"
                />
              ) : showReadOnlyInfo ? (
                <DisabledInfoButton />
              ) : null}
            </>
          )}
        </div>
      </td>

      {showHandoverProtocolPdfColumn ? (
        <td className="border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-2 py-2 align-middle text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf] print:hidden">
          {job.handover_protocol_is_sent ? (
            <ProtocolPdfButton jobId={job.id} />
          ) : (
            <DisabledProtocolPdfButton />
          )}
        </td>
      ) : null}

      <td className="rounded-r-2xl border border-l-0 border-[#cfd8e3] bg-transparent px-2 py-2 align-middle text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf] print:rounded-none print:border print:px-1.5 print:py-1.5">
        <JobStatusButton job={job} canEdit={allowEditing} />
      </td>
    </tr>
  )
}

function MobileCard({
  job,
  clientSuggestions,
  clientContacts,
  offerSuggestions,
  jobOfferSuggestions,
  technicianSuggestions,
  isAdmin,
  allowEditing,
  showReadOnlyInfo,
  showHandoverProtocolPdfColumn,
  collapseReadOnlyMobileActions,
  onJobUpdate,
}: {
  job: JobRow
  clientSuggestions: ClientOption[]
  clientContacts: ClientContactOption[]
  offerSuggestions: OfferOption[]
  jobOfferSuggestions: OfferOption[]
  technicianSuggestions: string[]
  isAdmin: boolean
  allowEditing: boolean
  showReadOnlyInfo: boolean
  showHandoverProtocolPdfColumn: boolean
  collapseReadOnlyMobileActions: boolean
  onJobUpdate: (jobId: string, nextValues: Partial<JobRow>) => void
}) {
  const [isActionsOpen, setIsActionsOpen] = useState(false)
  const showInfoAlertDot = Boolean(job.info_alert_enabled) && Boolean(job.has_info_content)
  const showProtocolPdfButton =
    showHandoverProtocolPdfColumn && Boolean(job.handover_protocol_is_sent)
  const showInfoButton = showReadOnlyInfo && Boolean(job.has_info_content)
  const startWeekdayLabel = formatJobStartWeekday(job.start_at)
  const showCollapsedReadOnlyActions =
    !allowEditing &&
    collapseReadOnlyMobileActions &&
    (showReadOnlyInfo || showHandoverProtocolPdfColumn)
  return (
    <div className="jobs-page__mobile-card overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.95)_0%,rgba(242,247,252,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_24px_rgba(15,23,42,0.1)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <EditJobButton
              job={job}
              clientSuggestions={clientSuggestions}
              clientContacts={clientContacts}
              offerSuggestions={offerSuggestions}
              jobOfferSuggestions={jobOfferSuggestions}
              className="jobs-page__job-edit-button text-sm font-semibold leading-tight text-gray-900 hover:underline"
              isAdmin={isAdmin}
            >
              {job.job_number}
            </EditJobButton>
            <span
              aria-hidden="true"
              className="text-sm font-semibold leading-none text-gray-900"
            >
              •
            </span>
            {startWeekdayLabel ? (
              <span
                className="jobs-page__job-day-badge inline-flex shrink-0 items-center justify-center rounded-sm border border-current bg-transparent px-2 py-[2px] text-[10px] font-medium leading-none uppercase tracking-[0.01em] whitespace-nowrap text-gray-900"
                aria-label={`Začíná v den ${startWeekdayLabel}`}
                title={`Začíná v den ${startWeekdayLabel}`}
              >
                {startWeekdayLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 block truncate text-[12px] font-medium leading-5 text-gray-900">
            {job.company_name}
          </p>
        </div>

        <JobStatusButton job={job} canEdit={allowEditing} />
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

          {allowEditing ? (
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
          ) : showCollapsedReadOnlyActions ? (
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
          ) : showReadOnlyInfo || showHandoverProtocolPdfColumn ? (
            <div className="flex items-center gap-2">
              {showProtocolPdfButton ? (
                <ProtocolPdfButton jobId={job.id} compact variant="mobile" />
              ) : showHandoverProtocolPdfColumn ? (
                <DisabledProtocolPdfButton compact variant="mobile" />
              ) : null}
              {showInfoButton ? (
                <InfoNoteButton
                  jobId={job.id}
                  jobNumber={job.job_number}
                  infoNote={job.info_note}
                  hasInfoAttachments={job.has_info_attachments}
                  infoAlertEnabled={Boolean(job.info_alert_enabled)}
                  jobStatus={job.job_status}
                  readOnly
                  variant="mobile"
                  compact
                  className="jobs-page__info-button"
                />
              ) : showReadOnlyInfo ? (
                <DisabledInfoButton compact variant="mobile" />
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {allowEditing ? (
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
      ) : showCollapsedReadOnlyActions ? (
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
      ) : null}

      {isActionsOpen && allowEditing ? (
        <div className="mt-0 grid grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5 min-[420px]:gap-2">
          <HandoverProtocolButton
            job={job}
            className="jobs-page__handover-button"
          />
          <InfoNoteButton
            jobId={job.id}
            jobNumber={job.job_number}
            infoNote={job.info_note}
            hasInfoAttachments={job.has_info_attachments}
            infoAlertEnabled={Boolean(job.info_alert_enabled)}
            jobStatus={job.job_status}
            variant="mobile"
            compact
            className="jobs-page__info-button"
          />
          <EvidenceStatusButton
            job={job}
            compact
            compactClassName="min-w-0 w-full px-2 text-[11px]"
            canEdit={allowEditing}
          />
          <MobileAssignmentButton
            job={job}
            canEdit
            compact
            technicianSuggestions={technicianSuggestions}
            onJobUpdate={onJobUpdate}
          />
        </div>
      ) : isActionsOpen && showCollapsedReadOnlyActions ? (
        <div
          className={`mt-0 grid items-center gap-1.5 min-[420px]:gap-2 ${
            showReadOnlyInfo && showHandoverProtocolPdfColumn
              ? 'grid-cols-2'
              : 'grid-cols-1'
          }`}
        >
          {showProtocolPdfButton ? (
            <ProtocolPdfButton jobId={job.id} compact variant="mobile" />
          ) : showHandoverProtocolPdfColumn ? (
            <DisabledProtocolPdfButton compact variant="mobile" />
          ) : null}
          {showInfoButton ? (
            <InfoNoteButton
              jobId={job.id}
              jobNumber={job.job_number}
              infoNote={job.info_note}
              hasInfoAttachments={job.has_info_attachments}
              infoAlertEnabled={Boolean(job.info_alert_enabled)}
              jobStatus={job.job_status}
              readOnly
              variant="mobile"
              compact
              className="jobs-page__info-button"
            />
          ) : showReadOnlyInfo ? (
            <DisabledInfoButton compact variant="mobile" />
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ProtocolPdfButton({
  jobId,
  compact = false,
  variant = 'table',
}: {
  jobId: string
  compact?: boolean
  variant?: 'table' | 'mobile'
}) {
  return (
    <Link
      href={`/jobs/${jobId}/pp?standalone=1&print=1`}
      target="_blank"
      rel="noreferrer"
      title="Předávací protokol"
      aria-label="Předávací protokol"
      className={`inline-flex items-center justify-center rounded-xl border border-[#6fa9d1] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_16px_rgba(41,128,185,0.22)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_22px_rgba(41,128,185,0.3)] ${
        variant === 'mobile'
          ? compact
            ? 'h-8 min-w-[44px] px-2 bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-[11px] font-semibold'
            : 'h-8 min-w-[56px] px-3 bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-xs font-semibold'
          : 'h-8 min-w-[56px] px-3 bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-xs font-semibold'
      }`}
    >
      PP
    </Link>
  )
}

function DisabledProtocolPdfButton({
  compact = false,
  variant = 'table',
}: {
  compact?: boolean
  variant?: 'table' | 'mobile'
}) {
  return (
    <button
      type="button"
      disabled
      title="Předávací protokol není připravený"
      aria-label="Předávací protokol není připravený"
      className={`inline-flex items-center justify-center rounded-xl border border-[#6fa9d1] text-white opacity-45 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_16px_rgba(41,128,185,0.22)] cursor-not-allowed ${
        variant === 'mobile'
          ? compact
            ? 'h-8 min-w-[44px] px-2 bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-[11px] font-semibold'
            : 'h-8 min-w-[56px] px-3 bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-xs font-semibold'
          : 'h-8 min-w-[56px] px-3 bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-xs font-semibold'
      }`}
    >
      PP
    </button>
  )
}

function DisabledInfoButton({
  compact = false,
  variant = 'table',
}: {
  compact?: boolean
  variant?: 'table' | 'mobile'
}) {
  const baseClasses = `inline-flex items-center justify-center rounded-xl font-medium transition duration-200 cursor-not-allowed opacity-55`
  const buttonClasses =
    variant === 'mobile'
      ? compact
        ? 'h-8 min-w-0 w-full px-2 text-[11px]'
        : 'min-w-[88px] px-3 py-2 text-xs'
      : 'min-w-[88px] px-3 py-2 text-xs'

  return (
    <button
      type="button"
      disabled
      title="Info k zakázce není vyplněné"
      aria-label="Info k zakázce není vyplněné"
      className={`jobs-page__info-button jobs-page__info-button--empty border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] ${baseClasses} ${buttonClasses}`}
    >
      ZOBRAZIT
    </button>
  )
}

function MobileAssignmentButton({
  job,
  canEdit,
  technicianSuggestions,
  onJobUpdate,
  compact = false,
}: {
  job: JobRow
  canEdit: boolean
  technicianSuggestions: string[]
  onJobUpdate: (jobId: string, nextValues: Partial<JobRow>) => void
  compact?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [technicianValue, setTechnicianValue] = useState(job.technician_name ?? '')
  const [generatorValue, setGeneratorValue] = useState(job.generator_name ?? '')
  const [isTechnicianDirty, setIsTechnicianDirty] = useState(false)
  const [isGeneratorDirty, setIsGeneratorDirty] = useState(false)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [isSaving, setIsSaving] = useState(false)
  const isSavingRef = useRef(false)

  function openModal() {
    setTechnicianValue(job.technician_name ?? '')
    setGeneratorValue(job.generator_name ?? '')
    setIsTechnicianDirty(false)
    setIsGeneratorDirty(false)
    setIsOpen(true)
  }

  function saveAssignments() {
    if (!canEdit || isPending || isSavingRef.current) {
      setIsOpen(false)
      return
    }

    const originalTechnician = job.technician_name ?? ''
    const originalGenerator = job.generator_name ?? ''
    const technicianChanged =
      isTechnicianDirty || technicianValue !== originalTechnician
    const generatorChanged =
      isGeneratorDirty || generatorValue !== originalGenerator

    if (!technicianChanged && !generatorChanged) {
      setIsOpen(false)
      return
    }

    isSavingRef.current = true
    setIsSaving(true)

    startTransition(async () => {
      try {
        let hasError = false
        let normalizedTechnicianValue: string | null = null

        if (technicianChanged) {
          const finalizedTechnician = finalizeTechnicianInputValue(
            technicianValue,
            technicianSuggestions
          )

          if (finalizedTechnician.error) {
            alert(finalizedTechnician.error)
            hasError = true
          } else {
            normalizedTechnicianValue = finalizedTechnician.value

            if (normalizedTechnicianValue !== originalTechnician) {
              const technicianFormData = new FormData()
              technicianFormData.set('field', 'technician_name')
              technicianFormData.set('value', normalizedTechnicianValue)

              const technicianResult = await updateJobInlineFieldAction(
                job.id,
                { success: false, error: null },
                technicianFormData
              )

              if (!technicianResult.success) {
                alert(technicianResult.error ?? 'Technika se nepodařilo uložit.')
                hasError = true
              } else {
                setTechnicianValue(normalizedTechnicianValue)
                setIsTechnicianDirty(false)
              }
            } else {
              setTechnicianValue(normalizedTechnicianValue)
              setIsTechnicianDirty(false)
            }
          }
        }

        if (generatorChanged) {
          const generatorFormData = new FormData()
          generatorFormData.set('field', 'generator_name')
          generatorFormData.set('value', generatorValue)

          const generatorResult = await updateJobInlineFieldAction(
            job.id,
            { success: false, error: null },
            generatorFormData
          )

          if (!generatorResult.success) {
            alert(generatorResult.error ?? 'Agregát se nepodařilo uložit.')
            hasError = true
          } else {
            setIsGeneratorDirty(false)
          }
        }

        if (hasError) {
          return
        }

        const nextValues: Partial<JobRow> = {}

        if (normalizedTechnicianValue !== null) {
          nextValues.technician_name = normalizedTechnicianValue
        }

        if (generatorChanged) {
          nextValues.generator_name = generatorValue
        }

        if (Object.keys(nextValues).length > 0) {
          onJobUpdate(job.id, nextValues)
        }

        setSuccessMessage('Změny zakázky byly úspěšně uloženy.')
        setIsOpen(false)
      } finally {
        isSavingRef.current = false
        setIsSaving(false)
      }
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={`inline-flex h-8 items-center justify-center font-bold uppercase ${
          compact ? 'min-w-0 w-full px-2 text-[11px]' : 'min-w-[96px] px-3 text-[11px]'
        } ${GLASS_SECONDARY_BUTTON_CLASS}`}
      >
        UPRAVIT
      </button>

      {isOpen ? (
        <ModalShell
          title="UPRAVIT ZAKÁZKU"
          description={`ZAKÁZKA ${job.job_number.toUpperCase()}`}
          descriptionAsBadge
          onClose={() => setIsOpen(false)}
        >
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">
                Technik
              </span>
              <TechnicianNamesInput
                id={`mobile-technician-${job.id}`}
                value={technicianValue}
                technicians={technicianSuggestions}
                onValueChange={(nextValue) => {
                  setTechnicianValue(nextValue)
                  setIsTechnicianDirty(nextValue !== (job.technician_name ?? ''))
                }}
                disabled={isPending || !canEdit}
                className="h-11 w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] disabled:cursor-not-allowed disabled:bg-gray-50"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700">
                Agregát
              </span>
              <input
                type="text"
                value={generatorValue}
                disabled={isPending || !canEdit}
                onChange={(event) => {
                  const nextValue = event.target.value
                  setGeneratorValue(nextValue)
                  setIsGeneratorDirty(nextValue !== (job.generator_name ?? ''))
                }}
                className="h-11 w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] disabled:cursor-not-allowed disabled:bg-gray-50"
              />
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className={`inline-flex h-10 items-center justify-center px-4 text-sm font-medium uppercase tracking-[0.04em] ${GLASS_SECONDARY_BUTTON_CLASS}`}
              >
                ZRUŠIT
              </button>

              {canEdit ? (
                <button
                  type="button"
                  onClick={saveAssignments}
                  disabled={isPending || isSaving}
                  className="jobs-page__mobile-modal-submit inline-flex h-10 items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending || isSaving ? 'UKLÁDÁM…' : 'ULOŽIT'}
                </button>
              ) : null}
            </div>
          </div>
        </ModalShell>
      ) : null}

      <SuccessConfirmationModal
        isOpen={Boolean(successMessage)}
        title="ULOŽENO"
        message={successMessage ?? ''}
        onConfirm={() => setSuccessMessage(null)}
      />
    </>
  )
}

function EditableCell({
  job,
  field,
  value,
  type = 'text',
  printHidden = false,
  canEdit,
  clientSuggestions = [],
  technicianSuggestions = [],
}: {
  job: JobRow
  field: InlineEditableField
  value: string | null
  type?: 'text' | 'datetime'
  printHidden?: boolean
  canEdit: boolean
  clientSuggestions?: ClientOption[]
  technicianSuggestions?: string[]
}) {
  if (field === 'company_name') {
    return (
      <EditableCompanyCell
        job={job}
        value={value}
        printHidden={printHidden}
        canEdit={canEdit}
        clientSuggestions={clientSuggestions}
      />
    )
  }

  if (field === 'technician_name') {
    return (
      <EditableTechnicianCell
        job={job}
        value={value}
        printHidden={printHidden}
        canEdit={canEdit}
        technicianSuggestions={technicianSuggestions}
      />
    )
  }

  return (
    <EditableGenericCell
      job={job}
      field={field}
      value={value}
      type={type}
      printHidden={printHidden}
      canEdit={canEdit}
    />
  )
}

function EditableGenericCell({
  job,
  field,
  value,
  type = 'text',
  printHidden = false,
  canEdit,
}: {
  job: JobRow
  field: Exclude<InlineEditableField, 'company_name' | 'technician_name'>
  value: string | null
  type?: 'text' | 'datetime'
  printHidden?: boolean
  canEdit: boolean
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftValue, setDraftValue] = useState(
    type === 'datetime' ? toDateTimeLocalValue(value) : (value ?? '')
  )
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isEditing && canEdit) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing, canEdit])

  function cancelEditing() {
    setDraftValue(
      type === 'datetime' ? toDateTimeLocalValue(value) : (value ?? '')
    )
    setIsEditing(false)
  }

  function saveValue() {
    const originalValue =
      type === 'datetime' ? toDateTimeLocalValue(value) : (value ?? '')

    if (draftValue === originalValue) {
      setIsEditing(false)
      return
    }

    startTransition(async () => {
      const formData = new FormData()
      formData.set('field', field)
      formData.set('value', draftValue)

      const result = await updateJobInlineFieldAction(
        job.id,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        alert(result.error ?? 'Změnu se nepodařilo uložit.')
        cancelEditing()
        return
      }

      setIsEditing(false)
    })
  }

  const cellClassName = `border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-2 py-2 align-middle shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf] print:border print:px-1.5 print:py-1.5 ${
    printHidden ? 'print:hidden' : ''
  }`

  if (isEditing && canEdit) {
    return (
      <td
        className={`border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-2 py-1.5 align-middle ${
          printHidden ? 'print:hidden' : 'print:border print:px-1.5 print:py-1.5'
        }`}
      >
        <input
          ref={inputRef}
          type={type === 'datetime' ? 'datetime-local' : 'text'}
          value={draftValue}
          disabled={isPending}
          onChange={(event) => setDraftValue(event.target.value)}
          onBlur={saveValue}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              saveValue()
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              cancelEditing()
            }
          }}
          className="jobs-page__table-inline-edit-input h-8 w-full rounded-lg px-2 text-[12px] outline-none transition"
        />
      </td>
    )
  }

  if (!canEdit) {
    const displayValue = type === 'datetime' ? formatDateTime(value) : value || '—'

    return (
      <td className={cellClassName}>
        <div
          className="jobs-page__table-cell-value block w-full rounded-lg px-1 py-1 text-left text-[12px] text-gray-700 print:px-0 print:py-0 print:text-[11px]"
          title={displayValue}
        >
          <span className="block truncate">{displayValue}</span>
        </div>
      </td>
    )
  }

  const displayValue = type === 'datetime' ? formatDateTime(value) : value || '—'

  return (
    <td className={cellClassName}>
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="jobs-page__table-cell-value block w-full rounded-lg px-1 py-1 text-left text-[12px] text-gray-700 transition hover:bg-black/[0.025] hover:text-gray-900 print:px-0 print:py-0 print:text-[11px] print:hover:bg-transparent"
        title={displayValue}
      >
        <span className="block truncate">{displayValue}</span>
      </button>
    </td>
  )
}

function EditableCompanyCell({
  job,
  value,
  printHidden = false,
  canEdit,
  clientSuggestions,
}: {
  job: JobRow
  value: string | null
  printHidden?: boolean
  canEdit: boolean
  clientSuggestions: ClientOption[]
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  const companyOptions = useMemo(() => {
    const map = new Map<string, ClientOption>()

    clientSuggestions.forEach((client) => {
      const id = client.id.trim()
      const name = client.name.trim()

      if (!id || !name) return

      map.set(id, { id, name })
    })

    if (job.client_id && (value ?? '').trim()) {
      map.set(job.client_id, {
        id: job.client_id,
        name: (value ?? '').trim(),
      })
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'cs', { sensitivity: 'base' })
    )
  }, [clientSuggestions, job.client_id, value])

  const [companyName, setCompanyName] = useState(value ?? '')
  const [selectedClientId, setSelectedClientId] = useState(job.client_id ?? '')

  useEffect(() => {
    if (isEditing && canEdit) {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(companyName.length, companyName.length)
    }
  }, [canEdit, companyName.length, isEditing])

  const cellClassName = `border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-2 py-2 align-middle shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf] print:border print:px-1.5 print:py-1.5 ${
    printHidden ? 'print:hidden' : ''
  }`

  const selectedClient =
    companyOptions.find((client) => client.id === selectedClientId) ?? null

  const companySelectionIsValid =
    Boolean(selectedClientId) &&
    Boolean(selectedClient) &&
    companyName.trim() === (selectedClient?.name ?? '')

  function setAutocompleteSelection(start: number, end: number) {
    requestAnimationFrame(() => {
      inputRef.current?.focus()
      inputRef.current?.setSelectionRange(start, end)
    })
  }

  function startEditing() {
    setCompanyName(value ?? '')
    setSelectedClientId(job.client_id ?? '')
    setIsEditing(true)
  }

  function handleCompanyChange(nextRawValue: string) {
    const trimmedValue = nextRawValue.trim()
    const normalizedValue = normalizeSearchText(trimmedValue)

    if (!trimmedValue) {
      setCompanyName('')
      setSelectedClientId('')
      return
    }

    const exactMatch =
      companyOptions.find(
        (client) => normalizeSearchText(client.name) === normalizedValue
      ) ?? null

    if (exactMatch) {
      setCompanyName(exactMatch.name)
      setSelectedClientId(exactMatch.id)
      return
    }

    const prefixMatches = companyOptions.filter((client) =>
      normalizeSearchText(client.name).startsWith(normalizedValue)
    )

    if (prefixMatches.length === 1) {
      const matchedClient = prefixMatches[0]
      const completedName = matchedClient.name

      setCompanyName(completedName)
      setSelectedClientId(matchedClient.id)
      setAutocompleteSelection(nextRawValue.length, completedName.length)
      return
    }

    setCompanyName(nextRawValue)
    setSelectedClientId('')
  }

  function cancelEditing() {
    setCompanyName(value ?? '')
    setSelectedClientId(job.client_id ?? '')
    setIsEditing(false)
  }

  function saveValue() {
    const originalValue = value ?? ''
    const originalClientId = job.client_id ?? ''

    if (
      companyName === originalValue &&
      (selectedClientId ?? '') === originalClientId
    ) {
      setIsEditing(false)
      return
    }

    if (!companySelectionIsValid) {
      cancelEditing()
      return
    }

    startTransition(async () => {
      const formData = new FormData()
      formData.set('field', 'company_name')
      formData.set('value', companyName.trim())
      formData.set('client_id', selectedClientId)

      const result = await updateJobInlineFieldAction(
        job.id,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        alert(result.error ?? 'Firmu se nepodařilo uložit.')
        cancelEditing()
        return
      }

      setIsEditing(false)
    })
  }

  const displayValue = value || '—'

  if (isEditing && canEdit) {
    return (
      <td
        className={`border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-2 py-1.5 align-middle ${
          printHidden ? 'print:hidden' : 'print:border print:px-1.5 print:py-1.5'
        }`}
      >
        <input
          ref={inputRef}
          type="text"
          value={companyName}
          disabled={isPending}
          onChange={(event) => handleCompanyChange(event.target.value)}
          onBlur={saveValue}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              saveValue()
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              cancelEditing()
            }
          }}
          autoComplete="off"
          className="jobs-page__table-inline-edit-input h-8 w-full rounded-lg px-2 text-[12px] outline-none transition"
        />
      </td>
    )
  }

  if (!canEdit) {
    return (
      <td className={cellClassName}>
        <div
          className="jobs-page__company-cell-value block w-full rounded-lg px-1 py-1 text-left text-[12px] text-gray-900 print:px-0 print:py-0 print:text-[11px]"
          title={displayValue}
        >
          <span className="block truncate">{displayValue}</span>
        </div>
      </td>
    )
  }

  return (
    <td className={cellClassName}>
      <button
        type="button"
        onClick={startEditing}
        className="jobs-page__company-cell-value block w-full rounded-lg px-1 py-1 text-left text-[12px] text-gray-900 transition hover:bg-black/[0.025] hover:text-gray-900 print:px-0 print:py-0 print:text-[11px] print:hover:bg-transparent"
        title={displayValue}
      >
        <span className="block truncate">{displayValue}</span>
      </button>
    </td>
  )
}

function EditableTechnicianCell({
  job,
  value,
  printHidden = false,
  canEdit,
  technicianSuggestions,
}: {
  job: JobRow
  value: string | null
  printHidden?: boolean
  canEdit: boolean
  technicianSuggestions: string[]
}) {
  const router = useRouter()
  const [isEditing, setIsEditing] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [technicianValue, setTechnicianValue] = useState(value ?? '')

  const cellClassName = `border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-2 py-2 align-middle shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-200 group-hover:border-[#78abcf] print:border print:px-1.5 print:py-1.5 ${
    printHidden ? 'print:hidden' : ''
  }`

  function cancelEditing() {
    setTechnicianValue(value ?? '')
    setIsEditing(false)
  }

  function saveValue(nextValue?: string) {
    const originalValue = value ?? ''
    const currentValue = nextValue ?? technicianValue
    const finalizedTechnician = finalizeTechnicianInputValue(
      currentValue,
      technicianSuggestions
    )

    if (finalizedTechnician.error) {
      alert(finalizedTechnician.error)
      cancelEditing()
      return
    }

    if (finalizedTechnician.value === originalValue) {
      setIsEditing(false)
      return
    }

    startTransition(async () => {
      const formData = new FormData()
      formData.set('field', 'technician_name')
      formData.set('value', finalizedTechnician.value)

      const result = await updateJobInlineFieldAction(
        job.id,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        alert(result.error ?? 'Technika se nepodařilo uložit.')
        cancelEditing()
        return
      }

      setTechnicianValue(finalizedTechnician.value)
      setIsEditing(false)
      router.refresh()
    })
  }

  function startEditing() {
    setTechnicianValue(value ?? '')
    setIsEditing(true)
  }

  const displayValue = value || '—'

  if (!canEdit) {
    return (
      <td className={cellClassName}>
        <div
          className="jobs-page__table-cell-value block w-full rounded-lg px-1 py-1 text-left text-[12px] text-gray-700 print:px-0 print:py-0 print:text-[11px]"
          title={displayValue}
        >
          <span className="block truncate">{displayValue}</span>
        </div>
      </td>
    )
  }

  if (isEditing) {
    return (
      <td
        className={`border border-l-0 border-r-0 border-[#cfd8e3] bg-transparent px-2 py-1.5 align-middle ${
          printHidden ? 'print:hidden' : 'print:border print:px-1.5 print:py-1.5'
        }`}
      >
        <TechnicianNamesInput
          id={`job-technician-${job.id}`}
          value={technicianValue}
          technicians={technicianSuggestions}
          onValueChange={setTechnicianValue}
          onBlur={saveValue}
          autoFocus
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              saveValue()
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              cancelEditing()
            }
          }}
          disabled={isPending}
          className="jobs-page__table-inline-edit-input h-8 w-full rounded-lg px-2 text-[12px] outline-none transition"
        />
      </td>
    )
  }

  return (
    <td className={cellClassName}>
      <button
        type="button"
        onClick={startEditing}
        className="jobs-page__table-cell-value block w-full rounded-lg px-1 py-1 text-left text-[12px] text-gray-700 transition hover:bg-black/[0.025] hover:text-gray-900 print:px-0 print:py-0 print:text-[11px] print:hover:bg-transparent"
        title={displayValue}
      >
        <span className="block truncate">{displayValue}</span>
      </button>
    </td>
  )
}

function JobStatusButton({
  job,
  canEdit,
}: {
  job: JobRow
  canEdit: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const meta = getJobStatusMeta(getEffectiveJobStatus(job))

  if (!canEdit) {
    return (
      <span
        data-status={meta.value}
        className={`jobs-page__job-status-button inline-flex h-8 ${STATUS_BUTTON_WIDTH_CLASS} max-w-full items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase ${meta.className} pointer-events-none print:min-w-0 print:px-2 print:text-[10px]`}
      >
        <span className="truncate">{meta.label}</span>
      </span>
    )
  }

  const options: { value: JobStatus; label: string; className: string }[] = [
    getJobStatusMeta('nova'),
    getJobStatusMeta('k_reseni'),
    getJobStatusMeta('realizace'),
    getJobStatusMeta('ukoncena'),
    getJobStatusMeta('storno'),
  ]

  function saveStatus(nextStatus: JobStatus) {
    if (!canEdit) return

    startTransition(async () => {
      const formData = new FormData()
      formData.set('job_status', nextStatus)

      const result = await updateJobStatusAction(
        job.id,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        alert(result.error ?? 'Stav zakázky se nepodařilo uložit.')
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
        data-status={meta.value}
        className={`jobs-page__job-status-button inline-flex h-8 ${STATUS_BUTTON_WIDTH_CLASS} max-w-full items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out hover:-translate-y-[1px] print:min-w-0 print:px-2 print:text-[10px] ${meta.className}`}
      >
        <span className="truncate">{meta.label}</span>
      </button>

      {isOpen ? (
        <JobStatusModal
          jobNumber={job.job_number}
          currentMeta={meta}
          options={options}
          canEdit={canEdit}
          isPending={isPending}
          onClose={() => setIsOpen(false)}
          onSaveStatus={saveStatus}
        />
      ) : null}
    </>
  )
}

function JobStatusModal({
  jobNumber,
  currentMeta,
  options,
  canEdit,
  isPending,
  onClose,
  onSaveStatus,
}: {
  jobNumber: string
  currentMeta: { value: JobStatus; label: string; className: string }
  options: { value: JobStatus; label: string; className: string }[]
  canEdit: boolean
  isPending: boolean
  onClose: () => void
  onSaveStatus: (status: JobStatus) => void
}) {
  const title = canEdit ? 'Změnit stav zakázky:' : 'Stav zakázky:'

  const modalContent = (
    <div
      className="fixed inset-0 z-[120] bg-zinc-950/48 p-3 backdrop-blur-sm sm:p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex h-full items-center justify-center">
        <div className="jobs-page__modal-shell relative w-full max-w-md overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_36px_84px_rgba(24,24,27,0.32)]">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[28px] border border-white/65" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-7 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-100" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-10 top-1 h-10 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.70),transparent_70%)]" />

          <div className="jobs-page__status-modal__header relative mb-4 flex items-start justify-between gap-4 border-b border-white/70 pb-4">
            <div className="flex flex-col items-start">
              <h2 className="jobs-page__status-modal__title text-lg font-semibold tracking-tight text-gray-900">
                {title}
              </h2>
              <div className="mt-1.5 inline-flex items-center rounded-full border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-3 py-1 text-xs font-bold tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(41,128,185,0.2)]">
                {jobNumber}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <div className="relative flex items-center justify-between gap-3 rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-3 py-3 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(41,128,185,0.24)]">
            <span className="font-semibold text-white">Aktuální stav:</span>
            <span
              data-status={currentMeta.value}
              data-active="true"
              className={`jobs-page__status-chip inline-flex h-8 ${STATUS_BUTTON_WIDTH_CLASS} items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase ${currentMeta.className}`}
            >
              {currentMeta.label}
            </span>
          </div>

          {canEdit ? (
            <>
              <div className="mt-3 text-sm font-medium text-gray-700">
                Vyber nový stav zakázky:
              </div>

              <div className="mt-3 space-y-2">
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={isPending}
                    onClick={() => onSaveStatus(option.value)}
                    data-status={option.value}
                    className="jobs-page__status-option flex w-full items-center justify-end rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-3 py-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out hover:-translate-y-[1px] hover:border-[#c8dced] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_9px_14px_rgba(15,23,42,0.07)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span
                      data-active="false"
                      data-status={option.value}
                      className={`jobs-page__status-chip inline-flex h-8 ${STATUS_BUTTON_WIDTH_CLASS} items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase ${option.className}`}
                    >
                      {option.label}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className={`inline-flex h-10 items-center justify-center px-4 text-sm font-medium uppercase tracking-[0.04em] ${GLASS_SECONDARY_BUTTON_CLASS}`}
              >
                Zavřít
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
}

function EvidenceStatusButton({
  job,
  compact = false,
  compactClassName,
  canEdit,
}: {
  job: JobRow
  compact?: boolean
  compactClassName?: string
  canEdit: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const meta = getEvidenceStatusMeta(job.evidence_status)

  if (!canEdit) {
    return (
      <span
        data-status={meta.value}
        className={`inline-flex h-8 ${
          compact
            ? compactClassName ?? 'min-w-[96px]'
            : EVIDENCE_BUTTON_WIDTH_CLASS
        } max-w-full items-center justify-center rounded-xl ${
          compact ? '' : 'px-3'
        } text-[11px] font-bold uppercase ${meta.className} pointer-events-none`}
      >
        <span className="truncate">{meta.label}</span>
      </span>
    )
  }

  const options: {
    value: EvidenceStatus
    label: string
    className: string
  }[] = [getEvidenceStatusMeta('nove'), getEvidenceStatusMeta('zapsano')]

  function saveEvidenceStatus(nextStatus: EvidenceStatus) {
    if (!canEdit) return

    startTransition(async () => {
      const formData = new FormData()
      formData.set('evidence_status', nextStatus)

      const result = await updateJobEvidenceStatusAction(
        job.id,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        alert(result.error ?? 'Stav evidence se nepodařilo uložit.')
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
        data-status={meta.value}
        className={`inline-flex h-8 ${
          compact
            ? compactClassName ?? 'min-w-[96px]'
            : EVIDENCE_BUTTON_WIDTH_CLASS
        } max-w-full items-center justify-center rounded-xl ${
          compact ? '' : 'px-3'
        } text-[11px] font-bold uppercase transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out hover:-translate-y-[1px] jobs-page__job-evidence-button ${meta.className}`}
      >
        <span className="truncate">{meta.label}</span>
      </button>

      {isOpen ? (
        <EvidenceStatusModal
          jobNumber={job.job_number}
          options={options}
          canEdit={canEdit}
          isPending={isPending}
          onClose={() => setIsOpen(false)}
          onSaveEvidenceStatus={saveEvidenceStatus}
        />
      ) : null}
    </>
  )
}

function EvidenceStatusModal({
  jobNumber,
  options,
  canEdit,
  isPending,
  onClose,
  onSaveEvidenceStatus,
}: {
  jobNumber: string
  options: { value: EvidenceStatus; label: string; className: string }[]
  canEdit: boolean
  isPending: boolean
  onClose: () => void
  onSaveEvidenceStatus: (status: EvidenceStatus) => void
}) {
  const title = canEdit ? 'Změnit stav evidence:' : 'Stav evidence:'

  const modalContent = (
    <div
      className="fixed inset-0 z-[120] bg-zinc-950/48 p-3 backdrop-blur-sm sm:p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex h-full items-center justify-center">
        <div className="jobs-page__modal-shell relative w-full max-w-md overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_36px_84px_rgba(24,24,27,0.32)]">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[28px] border border-white/65" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-7 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-100" />
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-10 top-1 h-10 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.70),transparent_70%)]" />

          <div className="relative mb-4 flex items-start justify-between gap-4 border-b border-white/70 pb-4">
            <div className="flex flex-col items-start">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900">
                {title}
              </h2>
              <div className="mt-1.5 inline-flex items-center rounded-full border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-3 py-1 text-xs font-bold tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(41,128,185,0.2)]">
                {jobNumber}
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          {canEdit ? (
            <>
              <div className="space-y-2">
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={isPending}
                    onClick={() => onSaveEvidenceStatus(option.value)}
                    data-status={option.value}
                    className="jobs-page__evidence-option flex w-full items-center justify-between rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-3 py-3 text-sm shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out hover:-translate-y-[1px] hover:border-[#c8dced] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_9px_14px_rgba(15,23,42,0.07)] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="font-medium text-gray-900">{option.label}</span>
                    <span
                      className={`inline-flex h-8 ${EVIDENCE_BUTTON_WIDTH_CLASS} items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase ${option.className}`}
                    >
                      {option.label}
                    </span>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className={`inline-flex h-10 items-center justify-center px-4 text-sm font-medium uppercase tracking-[0.04em] ${GLASS_SECONDARY_BUTTON_CLASS}`}
              >
                Zavřít
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
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

  const modalContent = (
    <div
      className="fixed inset-0 z-[120] bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px] print:hidden"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex h-full items-center justify-center">
        <div className="jobs-page__modal-shell relative w-full max-w-md overflow-hidden rounded-[28px] border border-zinc-200/95 bg-[linear-gradient(168deg,rgba(255,255,255,0.96)_0%,rgba(249,250,251,0.92)_42%,rgba(244,244,245,0.88)_100%)] p-5 shadow-[0_34px_84px_rgba(24,24,27,0.34)] lg:shadow-[0_40px_96px_rgba(24,24,27,0.38)]">
          <div
            className={`jobs-page__modal-header mb-4 flex items-start justify-between gap-4 ${
              showHeaderDivider ? 'border-b border-gray-100 pb-4' : ''
            }`}
          >
            <div className="flex flex-col items-start">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900">
                {title}
              </h2>
              {description ? (
                descriptionAsBadge ? (
                  <div className="jobs-page__mobile-modal-badge mt-1.5 inline-flex items-center rounded-full border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-3 py-1 text-xs font-bold tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.32),0_10px_18px_rgba(24,78,129,0.26)]">
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
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_14px_28px_rgba(39,39,42,0.18)]"
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

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
}

function getJobStatusMeta(status: JobStatus) {
  switch (status) {
    case 'nova':
      return {
        value: 'nova' as JobStatus,
        label: 'NOVÁ',
        className:
          'border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_16px_rgba(41,128,185,0.22)]',
      }
    case 'k_reseni':
      return {
        value: 'k_reseni' as JobStatus,
        label: 'V ŘEŠENÍ',
        className:
          'border border-orange-400/85 bg-[linear-gradient(155deg,#ff8b2b_0%,#ff6a00_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(249,115,22,0.24)]',
      }
    case 'realizace':
      return {
        value: 'realizace' as JobStatus,
        label: 'REALIZACE',
        className:
          'border border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(16,185,129,0.22)]',
      }
    case 'ukoncena':
      return {
        value: 'ukoncena' as JobStatus,
        label: 'UKONČENÁ',
        className:
          'border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_12px_rgba(15,23,42,0.06)]',
      }
    case 'storno':
      return {
        value: 'storno' as JobStatus,
        label: 'STORNO',
        className:
          'border border-red-500/85 bg-[linear-gradient(155deg,#ef4444_0%,#dc2626_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_8px_16px_rgba(220,38,38,0.26)]',
      }
  }
}

function getEvidenceStatusMeta(status: EvidenceStatus) {
  switch (status) {
    case 'nove':
      return {
        value: 'nove' as EvidenceStatus,
        label: 'ZAPSAT',
        className:
          'border border-[#7fb2d6] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_6px_12px_rgba(41,128,185,0.16)]',
      }
    case 'zapsano':
      return {
        value: 'zapsano' as EvidenceStatus,
        label: 'ZAPSÁNO',
        className:
          'border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_12px_rgba(15,23,42,0.06)]',
      }
  }
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

function formatJobStartWeekday(value: string | null) {
  if (!value) return null

  const weekday = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    weekday: 'long',
  }).format(new Date(value))

  switch (weekday) {
    case 'pondělí':
      return 'PONDĚLÍ'
    case 'úterý':
      return 'ÚTERÝ'
    case 'středa':
      return 'STŘEDA'
    case 'čtvrtek':
      return 'ČTVRTEK'
    case 'pátek':
      return 'PÁTEK'
    case 'sobota':
      return 'SOBOTA'
    case 'neděle':
      return 'NEDĚLE'
    default:
      return null
  }
}

function toDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return ''

  const date = new Date(value)

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  const parts = formatter.formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value ?? ''
  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  const hour = parts.find((part) => part.type === 'hour')?.value ?? ''
  const minute = parts.find((part) => part.type === 'minute')?.value ?? ''

  if (!year || !month || !day || !hour || !minute) return ''

  return `${year}-${month}-${day}T${hour}:${minute}`
}
