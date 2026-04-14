'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { updateJobAction, type UpdateJobActionState } from './actions'

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

type EditJobButtonProps = {
  clientSuggestions: string[]
  job: JobFormValues
}

const initialUpdateState: UpdateJobActionState = {
  success: false,
  error: null,
}

export function EditJobButton({
  clientSuggestions,
  job,
}: EditJobButtonProps) {
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
        className="inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-700 transition hover:bg-gray-100"
      >
        Upravit
      </button>

      {isOpen ? (
        <EditJobModal
          key={formKey}
          clientSuggestions={clientSuggestions}
          onClose={closeModal}
          job={job}
        />
      ) : null}
    </>
  )
}

function EditJobModal({
  clientSuggestions,
  onClose,
  job,
}: {
  clientSuggestions: string[]
  onClose: () => void
  job: JobFormValues
}) {
  const boundUpdateAction = useMemo(
    () => updateJobAction.bind(null, job.id),
    [job.id]
  )

  const [state, formAction] = useActionState(
    boundUpdateAction,
    initialUpdateState
  )

  useEffect(() => {
    if (state.success) {
      onClose()
    }
  }, [onClose, state.success])

  const companySuggestions = useMemo(() => {
    const items = [...clientSuggestions]

    if (job.company_name && !items.includes(job.company_name)) {
      items.unshift(job.company_name)
    }

    return items
  }, [clientSuggestions, job.company_name])

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
                Upravit zakázku
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Uprav údaje k zakázce {job.company_name}.
              </p>
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
                    htmlFor="edit-company_name"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Firma *
                  </label>
                  <input
                    id="edit-company_name"
                    name="company_name"
                    type="text"
                    list="edit-job-company-suggestions"
                    required
                    defaultValue={job.company_name}
                    placeholder="Začni psát název firmy"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                  <datalist id="edit-job-company-suggestions">
                    {companySuggestions.map((companyName) => (
                      <option key={companyName} value={companyName} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label
                    htmlFor="edit-contact_person"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Osoba
                  </label>
                  <input
                    id="edit-contact_person"
                    name="contact_person"
                    type="text"
                    defaultValue={job.contact_person ?? ''}
                    placeholder="Kontaktní osoba"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-sales_owner"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Obchodník
                  </label>
                  <select
                    id="edit-sales_owner"
                    name="sales_owner"
                    defaultValue={job.sales_owner}
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
                    htmlFor="edit-start_at"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Začátek *
                  </label>
                  <input
                    id="edit-start_at"
                    name="start_at"
                    type="datetime-local"
                    required
                    defaultValue={toDateTimeLocalValue(job.start_at)}
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-end_at"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Konec *
                  </label>
                  <input
                    id="edit-end_at"
                    name="end_at"
                    type="datetime-local"
                    required
                    defaultValue={toDateTimeLocalValue(job.end_at)}
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="md:col-span-2">
                  <label
                    htmlFor="edit-site_address"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Adresa realizace
                  </label>
                  <input
                    id="edit-site_address"
                    name="site_address"
                    type="text"
                    defaultValue={job.site_address ?? ''}
                    placeholder="Adresa realizace"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-store_number"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Číslo prodejny
                  </label>
                  <input
                    id="edit-store_number"
                    name="store_number"
                    type="text"
                    defaultValue={job.store_number ?? ''}
                    placeholder="Např. 154"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-technician_name"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Technik
                  </label>
                  <input
                    id="edit-technician_name"
                    name="technician_name"
                    type="text"
                    defaultValue={job.technician_name ?? ''}
                    placeholder="Odpovědný pracovník"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-generator_name"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Agregát
                  </label>
                  <input
                    id="edit-generator_name"
                    name="generator_name"
                    type="text"
                    defaultValue={job.generator_name ?? ''}
                    placeholder="Např. Aggreko 250 kVA"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-power_and_cables_note"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Výkon a kabely
                  </label>
                  <input
                    id="edit-power_and_cables_note"
                    name="power_and_cables_note"
                    type="text"
                    defaultValue={job.power_and_cables_note ?? ''}
                    placeholder="Krátká provozní poznámka"
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div>
                  <label
                    htmlFor="edit-job_status"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Stav zakázky
                  </label>
                  <select
                    id="edit-job_status"
                    name="job_status"
                    defaultValue={job.job_status}
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
                    htmlFor="edit-invoice_status"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Fakturace
                  </label>
                  <select
                    id="edit-invoice_status"
                    name="invoice_status"
                    defaultValue={job.invoice_status}
                    className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  >
                    <option value="bez_faktury">Bez faktury</option>
                    <option value="k_fakturaci">K fakturaci</option>
                    <option value="vyfakturovano">Vyfakturováno</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label
                    htmlFor="edit-info_note"
                    className="mb-1 block text-sm font-medium text-gray-700"
                  >
                    Info k zakázce
                  </label>
                  <textarea
                    id="edit-info_note"
                    name="info_note"
                    rows={4}
                    defaultValue={job.info_note ?? ''}
                    placeholder="Libovolná delší poznámka k zakázce"
                    className="w-full resize-y rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>
              </div>

              {state.error ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  {state.error}
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

              <SubmitButton />
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function SubmitButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 items-center justify-center rounded-xl bg-gray-900 px-4 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Ukládám…' : 'Uložit změny'}
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