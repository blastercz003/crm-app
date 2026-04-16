'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import {
  updateJobEvidenceStatusAction,
  updateJobInfoAction,
  updateJobInlineFieldAction,
  updateJobStatusAction,
} from './actions'
import { EditJobButton } from './edit-job-button'

type JobStatus =
  | 'nova'
  | 'k_reseni'
  | 'realizace'
  | 'ukoncena'
  | 'storno'

type EvidenceStatus = 'nove' | 'zapsano'
type SalesOwner = 'JIŘÍ' | 'MICHAL' | 'LÍDA' | 'NONAME'

type JobRow = {
  id: string
  job_number: string
  company_name: string
  contact_person: string | null
  sales_owner: SalesOwner
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  technician_name: string | null
  generator_name: string | null
  info_note: string | null
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
  clientSuggestions: string[]
}

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const STATUS_BUTTON_WIDTH_CLASS = 'min-w-[108px]'
const EVIDENCE_BUTTON_WIDTH_CLASS = 'min-w-[108px]'

export function JobsInteractiveTable({
  jobs,
  clientSuggestions,
}: JobsInteractiveTableProps) {
  return (
    <>
      <section className="hidden rounded-3xl border border-gray-200 bg-white p-2 shadow-sm lg:block">
        <table className="w-full table-fixed border-separate border-spacing-y-2">
          <thead>
            <tr className="text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-500">
              <th className="w-[76px] px-2 py-2">Zakázka</th>
              <th className="w-[112px] px-2 py-2 text-center">Evidence</th>
              <th className="w-[120px] px-2 py-2">Firma</th>
              <th className="w-[94px] px-2 py-2">Osoba</th>
              <th className="w-[126px] px-2 py-2">Začátek</th>
              <th className="w-[126px] px-2 py-2">Konec</th>
              <th className="w-[144px] px-2 py-2">Adresa</th>
              <th className="w-[74px] px-2 py-2">Prodejna</th>
              <th className="w-[96px] px-2 py-2">Technik</th>
              <th className="w-[96px] px-2 py-2">Agregát</th>
              <th className="w-[86px] px-2 py-2 text-center">Info</th>
              <th className="w-[112px] px-2 py-2 text-center">Stav</th>
            </tr>
          </thead>

          <tbody>
            {jobs.map((job) => (
              <DesktopRow
                key={job.id}
                job={job}
                clientSuggestions={clientSuggestions}
              />
            ))}
          </tbody>
        </table>
      </section>

      <section className="grid gap-3 lg:hidden">
        {jobs.map((job) => (
          <MobileCard
            key={job.id}
            job={job}
            clientSuggestions={clientSuggestions}
          />
        ))}
      </section>
    </>
  )
}

function DesktopRow({
  job,
  clientSuggestions,
}: {
  job: JobRow
  clientSuggestions: string[]
}) {
  return (
    <tr className="group">
      <td className="rounded-l-2xl border border-r-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
        <EditJobButton job={job} clientSuggestions={clientSuggestions}>
          <span className="block truncate">{job.job_number}</span>
        </EditJobButton>
      </td>

      <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle text-center transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
        <EvidenceStatusButton job={job} />
      </td>

      <EditableCell job={job} field="company_name" value={job.company_name} />
      <EditableCell
        job={job}
        field="contact_person"
        value={job.contact_person}
      />
      <EditableCell
        job={job}
        field="start_at"
        value={job.start_at}
        type="datetime"
      />
      <EditableCell
        job={job}
        field="end_at"
        value={job.end_at}
        type="datetime"
      />
      <EditableCell job={job} field="site_address" value={job.site_address} />
      <EditableCell job={job} field="store_number" value={job.store_number} />
      <EditableCell
        job={job}
        field="technician_name"
        value={job.technician_name}
      />
      <EditableCell
        job={job}
        field="generator_name"
        value={job.generator_name}
      />

      <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle text-center transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
        <InfoNoteButton job={job} compact />
      </td>

      <td className="rounded-r-2xl border border-l-0 border-gray-200 bg-white px-2 py-2 align-middle text-center transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
        <JobStatusButton job={job} />
      </td>
    </tr>
  )
}

function MobileCard({
  job,
  clientSuggestions,
}: {
  job: JobRow
  clientSuggestions: string[]
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <EditJobButton
            job={job}
            clientSuggestions={clientSuggestions}
            className="text-sm font-semibold leading-tight text-gray-900 hover:underline"
          >
            {job.job_number}
          </EditJobButton>
          <p className="mt-0.5 truncate text-sm text-gray-700">
            {job.company_name}
          </p>
        </div>

        <EvidenceStatusButton job={job} compact />
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12px] leading-5 text-gray-600">
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

      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <InfoNoteButton job={job} />
          <JobStatusButton job={job} />
        </div>
      </div>
    </div>
  )
}

function EditableCell({
  job,
  field,
  value,
  type = 'text',
}: {
  job: JobRow
  field: InlineEditableField
  value: string | null
  type?: 'text' | 'datetime'
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [draftValue, setDraftValue] = useState(
    type === 'datetime' ? toDateTimeLocalValue(value) : (value ?? '')
  )
  const [isPending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraftValue(
      type === 'datetime' ? toDateTimeLocalValue(value) : (value ?? '')
    )
  }, [type, value])

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [isEditing])

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

  if (isEditing) {
    return (
      <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-1.5 align-middle">
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
          className="h-8 w-full rounded-lg border border-gray-300 bg-white px-2 text-[12px] text-gray-900 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-200"
        />
      </td>
    )
  }

  return (
    <td className="border border-l-0 border-r-0 border-gray-200 bg-white px-2 py-2 align-middle transition group-hover:border-gray-300 group-hover:bg-gray-50/70">
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="block w-full rounded-lg px-1 py-1 text-left text-[12px] text-gray-700 transition hover:bg-black/[0.025] hover:text-gray-900"
        title="Klikni pro úpravu"
      >
        <span className="block truncate">
          {type === 'datetime' ? formatDateTime(value) : value || '—'}
        </span>
      </button>
    </td>
  )
}

function InfoNoteButton({
  job,
  compact = false,
}: {
  job: JobRow
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

      const result = await updateJobInfoAction(
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
            ? 'border-gray-900 bg-gray-900 text-white hover:bg-gray-800'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
        }`}
      >
        {job.info_note ? 'ZOBRAZIT' : 'PŘIDAT'}
      </button>

      {isOpen ? (
        <ModalShell
          title="Info k zakázce"
          description={`Zakázka ${job.job_number}`}
          onClose={() => setIsOpen(false)}
        >
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
              Zrušit
            </button>

            <button
              type="button"
              onClick={saveInfo}
              disabled={isPending}
              className="inline-flex h-10 items-center justify-center rounded-xl bg-gray-900 px-4 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? 'Ukládám…' : 'Uložit'}
            </button>
          </div>
        </ModalShell>
      ) : null}
    </>
  )
}

function JobStatusButton({ job }: { job: JobRow }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const meta = getJobStatusMeta(job.job_status)

  const options: { value: JobStatus; label: string; className: string }[] = [
    getJobStatusMeta('nova'),
    getJobStatusMeta('k_reseni'),
    getJobStatusMeta('realizace'),
    getJobStatusMeta('ukoncena'),
    getJobStatusMeta('storno'),
  ]

  function saveStatus(nextStatus: JobStatus) {
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
        className={`inline-flex h-8 ${STATUS_BUTTON_WIDTH_CLASS} max-w-full items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase transition hover:opacity-95 ${meta.className}`}
      >
        <span className="truncate">{meta.label}</span>
      </button>

      {isOpen ? (
        <ModalShell
          title="Změnit stav zakázky"
          description={`Zakázka ${job.job_number}`}
          onClose={() => setIsOpen(false)}
        >
          <div className="space-y-2">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={isPending}
                onClick={() => saveStatus(option.value)}
                className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-3 py-3 text-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="font-medium text-gray-900">{option.label}</span>
                <span
                  className={`inline-flex h-8 ${STATUS_BUTTON_WIDTH_CLASS} items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase ${option.className}`}
                >
                  {option.label}
                </span>
              </button>
            ))}
          </div>
        </ModalShell>
      ) : null}
    </>
  )
}

function EvidenceStatusButton({
  job,
  compact = false,
}: {
  job: JobRow
  compact?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const meta = getEvidenceStatusMeta(job.evidence_status)

  const options: {
    value: EvidenceStatus
    label: string
    className: string
  }[] = [getEvidenceStatusMeta('nove'), getEvidenceStatusMeta('zapsano')]

  function saveEvidenceStatus(nextStatus: EvidenceStatus) {
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
        className={`inline-flex h-8 ${
          compact ? 'min-w-[96px]' : EVIDENCE_BUTTON_WIDTH_CLASS
        } max-w-full items-center justify-center rounded-xl px-3 text-[11px] font-bold uppercase transition hover:opacity-95 ${meta.className}`}
      >
        <span className="truncate">{meta.label}</span>
      </button>

      {isOpen ? (
        <ModalShell
          title="Změnit stav evidence"
          description={`Zakázka ${job.job_number}`}
          onClose={() => setIsOpen(false)}
        >
          <div className="space-y-2">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={isPending}
                onClick={() => saveEvidenceStatus(option.value)}
                className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-3 py-3 text-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
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
        </ModalShell>
      ) : null}
    </>
  )
}

function ModalShell({
  title,
  description,
  onClose,
  children,
}: {
  title: string
  description?: string
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
      className="fixed inset-0 z-50 bg-gray-900/45 p-3 sm:p-4"
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
          <div className="mb-4 flex items-start justify-between gap-4 border-b border-gray-100 pb-4">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-gray-900">
                {title}
              </h2>
              {description ? (
                <p className="mt-1 text-sm text-gray-500">{description}</p>
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

function getJobStatusMeta(status: JobStatus) {
  switch (status) {
    case 'nova':
      return {
        value: 'nova' as JobStatus,
        label: 'NOVÁ',
        className:
          'border border-blue-300 bg-blue-100 text-blue-800 shadow-sm',
      }
    case 'k_reseni':
      return {
        value: 'k_reseni' as JobStatus,
        label: 'K ŘEŠENÍ',
        className:
          'border border-amber-300 bg-amber-100 text-amber-800 shadow-sm',
      }
    case 'realizace':
      return {
        value: 'realizace' as JobStatus,
        label: 'REALIZACE',
        className:
          'border border-emerald-300 bg-emerald-100 text-emerald-800 shadow-sm',
      }
    case 'ukoncena':
      return {
        value: 'ukoncena' as JobStatus,
        label: 'UKONČENÁ',
        className:
          'border border-slate-300 bg-slate-100 text-slate-700 shadow-sm',
      }
    case 'storno':
      return {
        value: 'storno' as JobStatus,
        label: 'STORNO',
        className: 'border border-red-300 bg-red-100 text-red-800 shadow-sm',
      }
  }
}

function getEvidenceStatusMeta(status: EvidenceStatus) {
  switch (status) {
    case 'nove':
      return {
        value: 'nove' as EvidenceStatus,
        label: 'NOVÉ',
        className:
          'border border-blue-300 bg-blue-100 text-blue-800 shadow-sm',
      }
    case 'zapsano':
      return {
        value: 'zapsano' as EvidenceStatus,
        label: 'ZAPSÁNO',
        className:
          'border border-emerald-300 bg-emerald-100 text-emerald-800 shadow-sm',
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