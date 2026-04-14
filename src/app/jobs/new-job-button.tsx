'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { createJobAction, type CreateJobActionState } from './actions'

type SalesOwner = 'JIŘÍ' | 'MICHAL' | 'LÍDA' | 'NONAME'
type JobStatus = 'nova' | 'k_reseni' | 'realizace' | 'ukoncena' | 'storno'
type InvoiceStatus = 'bez_faktury' | 'k_fakturaci' | 'vyfakturovano'

type JobFormValues = {
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

type NewJobButtonProps = {
  clientSuggestions: string[]
  className?: string
}

const initialCreateState: CreateJobActionState = {
  success: false,
  error: null,
}

export function NewJobButton({
  clientSuggestions,
  className,
}: NewJobButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)

  function openModal() {
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  function closeModal() {
    setIsOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={
          className ??
          'inline-flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800'
        }
      >
        NOVÁ ZAKÁZKA
      </button>

      {isOpen ? (
        <CreateJobModal
          key={formKey}
          clientSuggestions={clientSuggestions}
          onClose={closeModal}
        />
      ) : null}
    </>
  )
}

function CreateJobModal({
  clientSuggestions,
  onClose,
}: {
  clientSuggestions: string[]
  onClose: () => void
}) {
  const [state, formAction] = useActionState(createJobAction, initialCreateState)

  useEffect(() => {
    if (state.success) {
      onClose()
    }
  }, [onClose, state.success])

  return (
    <JobFormShell
      mode="create"
      clientSuggestions={clientSuggestions}
      onClose={onClose}
      error={state.error}
      formAction={formAction}
    />
  )
}

function JobFormShell({
  mode,
  clientSuggestions,
  onClose,
  error,
  formAction,
  job,
}: {
  mode: 'create'
  clientSuggestions: string[]
  onClose: () => void
  error: string | null
  formAction: (payload: FormData) => void
  job?: JobFormValues
}) {
  const companySuggestions = useMemo(() => {
    const items = [...clientSuggestions]

    if (job?.company_name && !items.includes(job.company_name)) {
      items.unshift(job.company_name)
    }

    return items
  }, [clientSuggestions, job?.company_name])

  const title = 'Nová zakázka'
  const description = 'Vyplň základní údaje k nové realizaci.'
  const submitLabel = 'Uložit zakázku'

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

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
      <div className="flex h-full items-start justify-center overflow-hidden">
        <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-200 bg-white px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                {title}
              </h2>
              <p className="mt-1 text-sm text-gray-500">{description}</p>
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

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label
                    htmlFor={`${mode}-company_name`}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Firma *
                  </label>
                  <input
                    id={`${mode}-company_name`}
                    name="company_name"
                    type="text"
                    list={`${mode}-job-company-suggestions`}
                    required
                    defaultValue={job?.company_name ?? ''}
                    placeholder="Začni psát název firmy"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                  <datalist id={`${mode}-job-company-suggestions`}>
                    {companySuggestions.map((companyName) => (
                      <option key={companyName} value={companyName} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label
                    htmlFor={`${mode}-contact_person`}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Osoba
                  </label>
                  <input
                    id={`${mode}-contact_person`}
                    name="contact_person"
                    type="text"
                    defaultValue={job?.contact_person ?? ''}
                    placeholder="Kontaktní osoba"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${mode}-sales_owner`}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Obchodník
                  </label>
                  <select
                    id={`${mode}-sales_owner`}
                    name="sales_owner"
                    defaultValue={job?.sales_owner ?? 'NONAME'}
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  >
                    <option value="JIŘÍ">JIŘÍ</option>
                    <option value="MICHAL">MICHAL</option>
                    <option value="LÍDA">LÍDA</option>
                    <option value="NONAME">NONAME</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor={`${mode}-start_at`}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Začátek *
                  </label>
                  <input
                    id={`${mode}-start_at`}
                    name="start_at"
                    type="datetime-local"
                    required
                    defaultValue={toDateTimeLocalValue(job?.start_at)}
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${mode}-end_at`}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Konec *
                  </label>
                  <input
                    id={`${mode}-end_at`}
                    name="end_at"
                    type="datetime-local"
                    required
                    defaultValue={toDateTimeLocalValue(job?.end_at)}
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="md:col-span-2">
                  <label
                    htmlFor={`${mode}-site_address`}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Adresa realizace
                  </label>
                  <input
                    id={`${mode}-site_address`}
                    name="site_address"
                    type="text"
                    defaultValue={job?.site_address ?? ''}
                    placeholder="Adresa realizace"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${mode}-store_number`}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Číslo prodejny
                  </label>
                  <input
                    id={`${mode}-store_number`}
                    name="store_number"
                    type="text"
                    defaultValue={job?.store_number ?? ''}
                    placeholder="Např. 154"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${mode}-technician_name`}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Technik
                  </label>
                  <input
                    id={`${mode}-technician_name`}
                    name="technician_name"
                    type="text"
                    defaultValue={job?.technician_name ?? ''}
                    placeholder="Odpovědný pracovník"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${mode}-generator_name`}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Agregát
                  </label>
                  <input
                    id={`${mode}-generator_name`}
                    name="generator_name"
                    type="text"
                    defaultValue={job?.generator_name ?? ''}
                    placeholder="Např. Aggreko 250 kVA"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${mode}-power_and_cables_note`}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Výkon a kabely
                  </label>
                  <input
                    id={`${mode}-power_and_cables_note`}
                    name="power_and_cables_note"
                    type="text"
                    defaultValue={job?.power_and_cables_note ?? ''}
                    placeholder="Krátká provozní poznámka"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`${mode}-job_status`}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Stav zakázky
                  </label>
                  <select
                    id={`${mode}-job_status`}
                    name="job_status"
                    defaultValue={job?.job_status ?? 'nova'}
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  >
                    <option value="nova">Nová</option>
                    <option value="k_reseni">K řešení</option>
                    <option value="realizace">Realizace</option>
                    <option value="ukoncena">Ukončená</option>
                    <option value="storno">Storno</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor={`${mode}-invoice_status`}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Fakturace
                  </label>
                  <select
                    id={`${mode}-invoice_status`}
                    name="invoice_status"
                    defaultValue={job?.invoice_status ?? 'bez_faktury'}
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  >
                    <option value="bez_faktury">Bez faktury</option>
                    <option value="k_fakturaci">K fakturaci</option>
                    <option value="vyfakturovano">Vyfakturováno</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label
                    htmlFor={`${mode}-info_note`}
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Info k zakázce
                  </label>
                  <textarea
                    id={`${mode}-info_note`}
                    name="info_note"
                    rows={4}
                    defaultValue={job?.info_note ?? ''}
                    placeholder="Libovolná delší poznámka k zakázce"
                    className="w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>
              </div>

              {error ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  {error}
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-gray-200 bg-white px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Zrušit
              </button>

              <SubmitButton label={submitLabel} />
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 items-center justify-center rounded-xl bg-gray-900 px-4 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Ukládám…' : label}
    </button>
  )
}

function toDateTimeLocalValue(value: string | null | undefined) {
  if (!value) return ''

  const date = new Date(value)

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

  if (!year || !month || !day || !hour || !minute) return ''

  return `${year}-${month}-${day}T${hour}:${minute}`
}