'use client'

import { useActionState, useEffect, useId, useMemo } from 'react'
import {
  createJobAction,
  updateJobAction,
  type CreateJobActionState,
  type UpdateJobActionState,
} from './actions'

type SalesOwner = 'JIŘÍ' | 'MICHAL' | 'LÍDA'
type JobStatus = 'nova' | 'k_reseni' | 'realizace' | 'ukoncena' | 'storno'
type InvoiceStatus =
  | 'bez_faktury'
  | 'k_fakturaci'
  | 'vyfakturovano'

export type JobFormValues = {
  id: string
  company_name: string
  contact_person: string | null
  sales_owner: SalesOwner
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  technician_name: string | null
  generator_name: string | null
  power_and_cables_note: string | null
  info_note: string | null
  job_status: JobStatus
  invoice_status: InvoiceStatus
}

type JobFormProps = {
  mode: 'create' | 'edit'
  title: string
  description?: string
  submitLabel: string
  onClose: () => void
  clientSuggestions: string[]
  initialValues?: JobFormValues
}

const SALES_OWNER_OPTIONS: SalesOwner[] = ['JIŘÍ', 'MICHAL', 'LÍDA']
const JOB_STATUS_OPTIONS: { value: JobStatus; label: string }[] = [
  { value: 'nova', label: 'Nová' },
  { value: 'k_reseni', label: 'K řešení' },
  { value: 'realizace', label: 'Realizace' },
  { value: 'ukoncena', label: 'Ukončená' },
  { value: 'storno', label: 'Storno' },
]
const INVOICE_STATUS_OPTIONS: { value: InvoiceStatus; label: string }[] = [
  { value: 'bez_faktury', label: 'Bez faktury' },
  { value: 'k_fakturaci', label: 'K fakturaci' },
  { value: 'vyfakturovano', label: 'Vyfakturováno' },
]

const CREATE_INITIAL_STATE: CreateJobActionState = {
  success: false,
  error: null,
}

const UPDATE_INITIAL_STATE: UpdateJobActionState = {
  success: false,
  error: null,
}

function toDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return ''

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
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

  if (!year || !month || !day || !hour || !minute) {
    return ''
  }

  return `${year}-${month}-${day}T${hour}:${minute}`
}

export function JobForm({
  mode,
  title,
  description,
  submitLabel,
  onClose,
  clientSuggestions,
  initialValues,
}: JobFormProps) {
  const companyListId = useId()

  const defaultValues = useMemo<JobFormValues>(
    () => ({
      id: initialValues?.id ?? '',
      company_name: initialValues?.company_name ?? '',
      contact_person: initialValues?.contact_person ?? '',
      sales_owner: initialValues?.sales_owner ?? 'JIŘÍ',
      start_at: toDateTimeLocalValue(initialValues?.start_at),
      end_at: toDateTimeLocalValue(initialValues?.end_at),
      site_address: initialValues?.site_address ?? '',
      store_number: initialValues?.store_number ?? '',
      technician_name: initialValues?.technician_name ?? '',
      generator_name: initialValues?.generator_name ?? '',
      power_and_cables_note: initialValues?.power_and_cables_note ?? '',
      info_note: initialValues?.info_note ?? '',
      job_status: initialValues?.job_status ?? 'nova',
      invoice_status: initialValues?.invoice_status ?? 'bez_faktury',
    }),
    [initialValues]
  )

  const [createState, createFormAction, createPending] = useActionState(
    createJobAction,
    CREATE_INITIAL_STATE
  )

  const [updateState, updateFormAction, updatePending] = useActionState(
    mode === 'edit' && defaultValues.id
      ? updateJobAction.bind(null, defaultValues.id)
      : async () => UPDATE_INITIAL_STATE,
    UPDATE_INITIAL_STATE
  )

  const state = mode === 'create' ? createState : updateState
  const formAction = mode === 'create' ? createFormAction : updateFormAction
  const isPending = mode === 'create' ? createPending : updatePending

  useEffect(() => {
    if (state.success) {
      onClose()
    }
  }, [onClose, state.success])

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
        <div className="flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-5 py-4 sm:px-6">
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
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label
                    htmlFor="company_name"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Firma
                  </label>
                  <input
                    id="company_name"
                    name="company_name"
                    type="text"
                    list={companyListId}
                    defaultValue={defaultValues.company_name}
                    required
                    className="h-11 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                    placeholder="Název firmy"
                  />
                  <datalist id={companyListId}>
                    {clientSuggestions.map((suggestion) => (
                      <option key={suggestion} value={suggestion} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label
                    htmlFor="contact_person"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Kontaktní osoba
                  </label>
                  <input
                    id="contact_person"
                    name="contact_person"
                    type="text"
                    defaultValue={defaultValues.contact_person ?? ''}
                    className="h-11 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                    placeholder="Jméno kontaktu"
                  />
                </div>

                <div>
                  <label
                    htmlFor="sales_owner"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Obchodník
                  </label>
                  <select
                    id="sales_owner"
                    name="sales_owner"
                    defaultValue={defaultValues.sales_owner}
                    className="h-11 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  >
                    {SALES_OWNER_OPTIONS.map((owner) => (
                      <option key={owner} value={owner}>
                        {owner}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="start_at"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Začátek
                  </label>
                  <input
                    id="start_at"
                    name="start_at"
                    type="datetime-local"
                    defaultValue={defaultValues.start_at}
                    required
                    className="h-11 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor="end_at"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Konec
                  </label>
                  <input
                    id="end_at"
                    name="end_at"
                    type="datetime-local"
                    defaultValue={defaultValues.end_at}
                    required
                    className="h-11 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="md:col-span-2">
                  <label
                    htmlFor="site_address"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Adresa realizace
                  </label>
                  <input
                    id="site_address"
                    name="site_address"
                    type="text"
                    defaultValue={defaultValues.site_address ?? ''}
                    className="h-11 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                    placeholder="Ulice, město, provozovna"
                  />
                </div>

                <div>
                  <label
                    htmlFor="store_number"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Číslo prodejny
                  </label>
                  <input
                    id="store_number"
                    name="store_number"
                    type="text"
                    defaultValue={defaultValues.store_number ?? ''}
                    className="h-11 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                    placeholder="Např. 1024"
                  />
                </div>

                <div>
                  <label
                    htmlFor="technician_name"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Technik
                  </label>
                  <input
                    id="technician_name"
                    name="technician_name"
                    type="text"
                    defaultValue={defaultValues.technician_name ?? ''}
                    className="h-11 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                    placeholder="Jméno technika"
                  />
                </div>

                <div>
                  <label
                    htmlFor="generator_name"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Agregát
                  </label>
                  <input
                    id="generator_name"
                    name="generator_name"
                    type="text"
                    defaultValue={defaultValues.generator_name ?? ''}
                    className="h-11 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                    placeholder="Označení agregátu"
                  />
                </div>

                <div>
                  <label
                    htmlFor="job_status"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Stav zakázky
                  </label>
                  <select
                    id="job_status"
                    name="job_status"
                    defaultValue={defaultValues.job_status}
                    className="h-11 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  >
                    {JOB_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="invoice_status"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Fakturace
                  </label>
                  <select
                    id="invoice_status"
                    name="invoice_status"
                    defaultValue={defaultValues.invoice_status}
                    className="h-11 w-full rounded-2xl border border-gray-200 bg-white px-4 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  >
                    {INVOICE_STATUS_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label
                    htmlFor="power_and_cables_note"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Výkon a kabely
                  </label>
                  <textarea
                    id="power_and_cables_note"
                    name="power_and_cables_note"
                    rows={3}
                    defaultValue={defaultValues.power_and_cables_note ?? ''}
                    className="w-full resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                    placeholder="Interní poznámka k výkonu, kabelům nebo zapojení"
                  />
                </div>

                <div className="md:col-span-2">
                  <label
                    htmlFor="info_note"
                    className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                  >
                    Info k zakázce
                  </label>
                  <textarea
                    id="info_note"
                    name="info_note"
                    rows={4}
                    defaultValue={defaultValues.info_note ?? ''}
                    className="w-full resize-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                    placeholder="Interní poznámka k zakázce"
                  />
                </div>
              </div>

              {state.error ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {state.error}
                </div>
              ) : null}
            </div>

            <div className="border-t border-gray-100 px-5 py-4 sm:px-6">
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex h-11 items-center justify-center rounded-2xl border border-gray-200 bg-white px-5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Zrušit
                </button>

                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex h-11 items-center justify-center rounded-2xl bg-[#2980B9] px-5 text-sm font-medium text-white transition hover:bg-[#236f9f] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isPending ? 'Ukládám…' : submitLabel}
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
