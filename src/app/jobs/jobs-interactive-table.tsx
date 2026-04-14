'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import {
  updateJobInfoAction,
  updateJobInlineFieldAction,
  updateJobInvoiceStatusAction,
  updateJobStatusAction,
} from './actions'

type JobStatus =
  | 'nova'
  | 'k_reseni'
  | 'realizace'
  | 'ukoncena'
  | 'storno'

type InvoiceStatus =
  | 'bez_faktury'
  | 'k_fakturaci'
  | 'vyfakturovano'

type JobRow = {
  id: string
  job_number: string
  company_name: string
  contact_person: string | null
  sales_owner: string
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  technician_name: string | null
  generator_name: string | null
  info_note: string | null
  job_status: JobStatus
  invoice_status: InvoiceStatus
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

export function JobsInteractiveTable({ jobs }: JobsInteractiveTableProps) {
  return (
    <>
      <section className="hidden overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-sm lg:block">
        <table className="w-full table-fixed divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr className="text-left text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              <th className="w-[74px] px-1.5 py-3">Zakázka</th>
              <th className="w-[112px] px-1.5 py-3">Firma</th>
              <th className="w-[88px] px-1.5 py-3">Osoba</th>
              <th className="w-[122px] px-1.5 py-3">Začátek</th>
              <th className="w-[122px] px-1.5 py-3">Konec</th>
              <th className="w-[138px] px-1.5 py-3">Adresa</th>
              <th className="w-[70px] px-1.5 py-3">Prodejna</th>
              <th className="w-[92px] px-1.5 py-3">Technik</th>
              <th className="w-[92px] px-1.5 py-3">Agregát</th>
              <th className="w-[76px] px-1.5 py-3 text-center">Info</th>
              <th className="w-[98px] px-1.5 py-3 text-center">Stav</th>
              <th className="w-[108px] px-1.5 py-3 text-center">Fakturace</th>
              <th className="w-[78px] px-1.5 py-3">Obchodník</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100">
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

function DesktopRow({ job }: { job: JobRow }) {
  const detailHref = `/jobs/${job.id}`

  return (
    <tr className="transition hover:bg-gray-50">
      <td className="px-1.5 py-2 align-middle">
        <Link
          href={detailHref}
          className="block rounded-md px-1 py-1 text-[11px] font-semibold text-gray-900 transition hover:bg-black/[0.03]"
        >
          <span className="block truncate">{job.job_number}</span>
        </Link>
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

      <td className="px-1.5 py-2 align-middle text-center">
        <InfoNoteButton job={job} compact />
      </td>

      <td className="px-1.5 py-2 align-middle text-center">
        <JobStatusButton job={job} />
      </td>

      <td className="px-1.5 py-2 align-middle text-center">
        <InvoiceStatusButton job={job} />
      </td>

      <td className="px-1.5 py-2 align-middle text-[11px] text-gray-600">
        <div className="truncate">{job.sales_owner}</div>
      </td>
    </tr>
  )
}

function MobileCard({ job }: { job: JobRow }) {
  const detailHref = `/jobs/${job.id}`
  const jobStatusMeta = getJobStatusMeta(job.job_status)
  const invoiceStatusMeta = getInvoiceStatusMeta(job.invoice_status)

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={detailHref}
            className="text-sm font-semibold text-gray-900 hover:underline"
          >
            {job.job_number}
          </Link>
          <p className="mt-0.5 truncate text-xs font-medium text-gray-700">
            {job.company_name}
          </p>
        </div>

        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
          {job.sales_owner}
        </span>
      </div>

      <div className="mt-3 grid gap-2 text-xs text-gray-600">
        <div>
          <span className="font-medium text-gray-900">Osoba:</span>{' '}
          {job.contact_person || '—'}
        </div>
        <div>
          <span className="font-medium text-gray-900">Začátek:</span>{' '}
          {formatDateTime(job.start_at)}
        </div>
        <div>
          <span className="font-medium text-gray-900">Konec:</span>{' '}
          {formatDateTime(job.end_at)}
        </div>
        <div>
          <span className="font-medium text-gray-900">Adresa:</span>{' '}
          {job.site_address || '—'}
        </div>
        <div>
          <span className="font-medium text-gray-900">Technik:</span>{' '}
          {job.technician_name || '—'}
        </div>
        <div>
          <span className="font-medium text-gray-900">Agregát:</span>{' '}
          {job.generator_name || '—'}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium ${jobStatusMeta.className}`}
        >
          {jobStatusMeta.label}
        </span>

        <span
          className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium ${invoiceStatusMeta.className}`}
        >
          {invoiceStatusMeta.label}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <InfoNoteButton job={job} />
        <JobStatusButton job={job} />
        <InvoiceStatusButton job={job} />
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
      <td className="px-1.5 py-1 align-middle">
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
          className="h-8 w-full rounded-lg border border-gray-300 bg-white px-2 text-[11px] text-gray-900 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-200"
        />
      </td>
    )
  }

  return (
    <td className="px-1.5 py-2 align-middle">
      <button
        type="button"
        onClick={() => setIsEditing(true)}
        className="block w-full rounded-md px-1 py-1 text-left text-[11px] text-gray-600 transition hover:bg-black/[0.03] hover:text-gray-900"
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
        className={`inline-flex h-7 items-center justify-center rounded-lg ${
          compact ? 'min-w-[68px]' : 'px-3'
        } border ${
          job.info_note
            ? 'border-gray-900 bg-gray-900 text-white hover:bg-gray-800'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
        } px-2 text-[10px] font-medium transition`}
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
            rows={6}
            className="w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
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
        className={`inline-flex max-w-full items-center rounded-full px-2 py-1 text-[10px] font-medium transition hover:opacity-90 ${meta.className}`}
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
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium ${option.className}`}
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

function InvoiceStatusButton({ job }: { job: JobRow }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isPending, startTransition] = useTransition()
  const meta = getInvoiceStatusMeta(job.invoice_status)

  const options: {
    value: InvoiceStatus
    label: string
    className: string
  }[] = [
    getInvoiceStatusMeta('bez_faktury'),
    getInvoiceStatusMeta('k_fakturaci'),
    getInvoiceStatusMeta('vyfakturovano'),
  ]

  function saveInvoiceStatus(nextStatus: InvoiceStatus) {
    startTransition(async () => {
      const formData = new FormData()
      formData.set('invoice_status', nextStatus)

      const result = await updateJobInvoiceStatusAction(
        job.id,
        { success: false, error: null },
        formData
      )

      if (!result.success) {
        alert(result.error ?? 'Stav fakturace se nepodařilo uložit.')
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
        className={`inline-flex max-w-full items-center rounded-full px-2 py-1 text-[10px] font-medium transition hover:opacity-90 ${meta.className}`}
      >
        <span className="truncate">{meta.label}</span>
      </button>

      {isOpen ? (
        <ModalShell
          title="Změnit stav fakturace"
          description={`Zakázka ${job.job_number}`}
          onClose={() => setIsOpen(false)}
        >
          <div className="space-y-2">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={isPending}
                onClick={() => saveInvoiceStatus(option.value)}
                className="flex w-full items-center justify-between rounded-xl border border-gray-200 px-3 py-3 text-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="font-medium text-gray-900">{option.label}</span>
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-medium ${option.className}`}
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
  return (
    <div
      className="fixed inset-0 z-50 bg-gray-900/40 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-[30vw] min-w-[360px] rounded-3xl border border-gray-200 bg-white p-5 shadow-2xl">
          <div className="mb-4 flex items-start justify-between gap-4">
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
        label: 'Nová',
        className: 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200',
      }
    case 'k_reseni':
      return {
        value: 'k_reseni' as JobStatus,
        label: 'K řešení',
        className:
          'bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-200',
      }
    case 'realizace':
      return {
        value: 'realizace' as JobStatus,
        label: 'Realizace',
        className:
          'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200',
      }
    case 'ukoncena':
      return {
        value: 'ukoncena' as JobStatus,
        label: 'Ukončená',
        className: 'bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200',
      }
    case 'storno':
      return {
        value: 'storno' as JobStatus,
        label: 'Storno',
        className: 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200',
      }
  }
}

function getInvoiceStatusMeta(status: InvoiceStatus) {
  switch (status) {
    case 'bez_faktury':
      return {
        value: 'bez_faktury' as InvoiceStatus,
        label: 'Bez faktury',
        className:
          'bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-200',
      }
    case 'k_fakturaci':
      return {
        value: 'k_fakturaci' as InvoiceStatus,
        label: 'K fakturaci',
        className:
          'bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200',
      }
    case 'vyfakturovano':
      return {
        value: 'vyfakturovano' as InvoiceStatus,
        label: 'Vyfakturováno',
        className:
          'bg-green-50 text-green-700 ring-1 ring-inset ring-green-200',
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