'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { createJobAction, type CreateJobActionState } from './actions'

type SalesOwner = 'JIŘÍ' | 'MICHAL' | 'LÍDA' | 'NONAME'

type ClientOption = {
  id: string
  name: string
}

type JobFormValues = {
  id: string
  company_name: string
  client_id?: string | null
  contact_person: string | null
  sales_owner: SalesOwner
  start_at: string
  end_at: string
  site_address: string | null
  store_number: string | null
  technician_name: string | null
  generator_name: string | null
  info_note: string | null
}

type NewJobButtonProps = {
  clientSuggestions: ClientOption[]
  className?: string
  isAdmin?: boolean
}

const initialCreateState: CreateJobActionState = {
  success: false,
  error: null,
}

export function NewJobButton({
  clientSuggestions,
  className,
  isAdmin = true,
}: NewJobButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)

  function openModal() {
    if (!isAdmin) return
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  function closeModal() {
    setIsOpen(false)
  }

  const resolvedClassName =
    className ??
    'inline-flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800'

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        aria-disabled={!isAdmin}
        className={`${resolvedClassName} ${!isAdmin ? 'cursor-not-allowed' : ''}`}
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
  clientSuggestions: ClientOption[]
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
  clientSuggestions: ClientOption[]
  onClose: () => void
  error: string | null
  formAction: (payload: FormData) => void
  job?: JobFormValues
}) {
  const companyOptions = useMemo(() => {
    const map = new Map<string, ClientOption>()

    clientSuggestions.forEach((client) => {
      const name = client.name.trim()
      if (!name) return

      map.set(client.id, {
        id: client.id,
        name,
      })
    })

    if (job?.client_id && job.company_name?.trim()) {
      map.set(job.client_id, {
        id: job.client_id,
        name: job.company_name.trim(),
      })
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'cs', { sensitivity: 'base' })
    )
  }, [clientSuggestions, job?.client_id, job?.company_name])

  const [companyName, setCompanyName] = useState(job?.company_name ?? '')
  const [selectedClientId, setSelectedClientId] = useState(job?.client_id ?? '')
  const [companyTouched, setCompanyTouched] = useState(false)

  const selectedClient = useMemo(() => {
    return companyOptions.find((client) => client.id === selectedClientId) ?? null
  }, [companyOptions, selectedClientId])

  const companySelectionIsValid =
    Boolean(selectedClientId) &&
    Boolean(selectedClient) &&
    companyName.trim() === (selectedClient?.name ?? '')

  const showCompanyError = companyTouched && !companySelectionIsValid

  const title = 'Nová zakázka'
  const description = 'Vyber existující firmu a vyplň základní údaje k nové realizaci.'
  const submitLabel = 'ULOŽIT ZAKÁZKU'

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-gray-900/45 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex min-h-full items-start justify-center py-3 sm:items-center sm:py-4">
        <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-4 py-3 sm:px-5 sm:py-4">
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
            <input type="hidden" name="client_id" value={selectedClientId} />
            <input
              type="hidden"
              name="company_name"
              value={companySelectionIsValid ? companyName.trim() : ''}
            />

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
              <div className="grid gap-4 xl:grid-cols-[1.15fr_0.95fr_0.9fr]">
                <section className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Základ zakázky
                    </h3>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Firma, osoba a obchodník.
                    </p>
                  </div>

                  <div className="grid gap-3">
                    <div>
                      <label
                        htmlFor={`${mode}-client_id`}
                        className="mb-1 block text-sm font-medium text-gray-700"
                      >
                        Firma *
                      </label>

                      <select
                        id={`${mode}-client_id`}
                        value={selectedClientId}
                        required
                        onChange={(event) => {
                          const nextClientId = event.target.value
                          const nextClient =
                            companyOptions.find((client) => client.id === nextClientId) ??
                            null

                          setSelectedClientId(nextClientId)
                          setCompanyName(nextClient?.name ?? '')
                          setCompanyTouched(true)
                        }}
                        onBlur={() => setCompanyTouched(true)}
                        className={`h-10 w-full rounded-xl border bg-white px-3 text-sm text-gray-900 outline-none transition focus:ring-2 ${
                          showCompanyError
                            ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                            : 'border-gray-200 focus:border-gray-300 focus:ring-gray-200'
                        }`}
                      >
                        <option value="">Vyber firmu ze seznamu klientů</option>
                        {companyOptions.map((client) => (
                          <option key={client.id} value={client.id}>
                            {client.name}
                          </option>
                        ))}
                      </select>

                      <div className="mt-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                          Vybraná firma
                        </div>
                        <div className="mt-1 text-sm text-gray-900">
                          {companyName.trim() || 'Žádná firma není vybraná'}
                        </div>
                      </div>

                      {showCompanyError ? (
                        <p className="mt-2 text-sm text-red-600">
                          Pro založení zakázky musíš vybrat firmu z existujícího seznamu klientů.
                        </p>
                      ) : null}
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
                  </div>
                </section>

                <section className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Termín a místo
                    </h3>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Začátek, konec a adresa realizace.
                    </p>
                  </div>

                  <div className="grid gap-3">
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

                    <div>
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
                  </div>
                </section>

                <section className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Realizace
                    </h3>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Technik, agregát a interní info.
                    </p>
                  </div>

                  <div className="grid gap-3">
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
                        htmlFor={`${mode}-info_note`}
                        className="mb-1 block text-sm font-medium text-gray-700"
                      >
                        Info k zakázce
                      </label>
                      <textarea
                        id={`${mode}-info_note`}
                        name="info_note"
                        rows={6}
                        defaultValue={job?.info_note ?? ''}
                        placeholder="Libovolná interní poznámka k zakázce"
                        className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                      />
                    </div>
                  </div>
                </section>
              </div>

              {error ? (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                  {error}
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-gray-100 px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium uppercase text-gray-700 transition hover:bg-gray-50"
              >
                ZRUŠIT
              </button>

              <SubmitButton
                label={submitLabel}
                disabled={!companySelectionIsValid}
              />
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

function SubmitButton({
  label,
  disabled = false,
}: {
  label: string
  disabled?: boolean
}) {
  const { pending } = useFormStatus()
  const isDisabled = pending || disabled

  return (
    <button
      type="submit"
      disabled={isDisabled}
      className="inline-flex h-10 items-center justify-center rounded-xl bg-gray-900 px-4 text-sm font-medium uppercase text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'UKLÁDÁM…' : label}
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