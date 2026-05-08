'use client'

import {
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react'
import { useFormStatus } from 'react-dom'
import {
  deleteJobAction,
  updateJobAction,
  type UpdateJobActionState,
} from './actions'

type SalesOwner = 'JIŘÍ' | 'MICHAL' | 'LÍDA'
type JobStatus = 'nova' | 'k_reseni' | 'realizace' | 'ukoncena' | 'storno'
type InvoiceStatus =
  | 'bez_faktury'
  | 'k_fakturaci'
  | 'vyfakturovano'

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

type JobFormValues = {
  id: string
  job_number: string
  company_name: string
  client_id?: string | null
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
  job_status: JobStatus
  invoice_status: InvoiceStatus
}

type EditJobButtonProps = {
  job: JobFormValues
  clientSuggestions: ClientOption[]
  clientContacts?: ClientContactOption[]
  className?: string
  children?: React.ReactNode
  isAdmin?: boolean
}

const initialUpdateState: UpdateJobActionState = {
  success: false,
  error: null,
}

export function EditJobButton({
  job,
  clientSuggestions,
  clientContacts = [],
  className,
  children,
  isAdmin = true,
}: EditJobButtonProps) {
  const [isOpen, setIsOpen] = useState(false)

  function openModal() {
    if (!isAdmin) return
    setIsOpen(true)
  }

  function closeModal() {
    setIsOpen(false)
  }

  const resolvedClassName =
    className ??
    'inline-flex items-center justify-center rounded-lg px-1 py-1 text-[12px] font-semibold text-gray-900 transition hover:bg-black/[0.025]'

  if (!isAdmin) {
    return <span className={resolvedClassName}>{children ?? job.job_number}</span>
  }

  return (
    <>
      <button type="button" onClick={openModal} className={resolvedClassName}>
        {children ?? job.job_number}
      </button>

      {isOpen ? (
        <EditJobModal
          job={job}
          clientSuggestions={clientSuggestions}
          clientContacts={clientContacts}
          onClose={closeModal}
        />
      ) : null}
    </>
  )
}

function EditJobModal({
  job,
  clientSuggestions,
  clientContacts,
  onClose,
}: {
  job: JobFormValues
  clientSuggestions: ClientOption[]
  clientContacts: ClientContactOption[]
  onClose: () => void
}) {
  const [state, formAction] = useActionState(
    updateJobAction.bind(null, job.id),
    initialUpdateState
  )
  const [isDeleting, startDeleteTransition] = useTransition()

  useEffect(() => {
    if (state.success) {
      onClose()
    }
  }, [onClose, state.success])

  function handleDeleteClick() {
    const isConfirmed = window.confirm(
      `Opravdu chceš smazat zakázku ${job.job_number}? Tato akce nejde vrátit zpět.`
    )

    if (!isConfirmed) return

    startDeleteTransition(async () => {
      const result = await deleteJobAction(job.id)

      if (!result.success) {
        alert(result.error ?? 'Zakázku se nepodařilo smazat.')
        return
      }

      onClose()
    })
  }

  return (
    <JobFormShell
      mode="edit"
      clientSuggestions={clientSuggestions}
      clientContacts={clientContacts}
      onClose={onClose}
      error={state.error}
      formAction={formAction}
      job={job}
      onDelete={handleDeleteClick}
      isDeleting={isDeleting}
    />
  )
}

function JobFormShell({
  mode,
  clientSuggestions,
  clientContacts,
  onClose,
  error,
  formAction,
  job,
  onDelete,
  isDeleting,
}: {
  mode: 'edit'
  clientSuggestions: ClientOption[]
  clientContacts: ClientContactOption[]
  onClose: () => void
  error: string | null
  formAction: (payload: FormData) => void
  job: JobFormValues
  onDelete: () => void
  isDeleting: boolean
}) {
  const companyOptions = useMemo(() => {
    const map = new Map<string, ClientOption>()

    clientSuggestions.forEach((client) => {
      const id = client.id.trim()
      const name = client.name.trim()

      if (!id || !name) return

      map.set(id, {
        id,
        name,
      })
    })

    if (job.client_id && job.company_name?.trim()) {
      map.set(job.client_id, {
        id: job.client_id,
        name: job.company_name.trim(),
      })
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'cs', { sensitivity: 'base' })
    )
  }, [clientSuggestions, job.client_id, job.company_name])

  const companyInputRef = useRef<HTMLInputElement>(null)

  const [companyName, setCompanyName] = useState(job.company_name ?? '')
  const [selectedClientId, setSelectedClientId] = useState(job.client_id ?? '')
  const [selectedContactId, setSelectedContactId] = useState(job.client_contact_id ?? '')
  const [contactPerson, setContactPerson] = useState(job.contact_person ?? '')
  const [companyTouched, setCompanyTouched] = useState(false)
  const [companyHasFocus, setCompanyHasFocus] = useState(false)

  const selectedClient = useMemo(() => {
    return companyOptions.find((client) => client.id === selectedClientId) ?? null
  }, [companyOptions, selectedClientId])
  const selectedClientContacts = clientContacts.filter(
    (contact) => contact.client_id === selectedClientId
  )

  const companySelectionIsValid =
    Boolean(selectedClientId) &&
    Boolean(selectedClient) &&
    companyName.trim() === (selectedClient?.name ?? '')

  const showCompanyError = companyTouched && !companySelectionIsValid

  const title = `Upravit zakázku ${job.job_number}`
  const description = 'Uprav základní údaje k realizaci.'
  const submitLabel = 'ULOŽIT ZMĚNY'

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  function setAutocompleteSelection(start: number, end: number) {
    requestAnimationFrame(() => {
      companyInputRef.current?.focus()
      companyInputRef.current?.setSelectionRange(start, end)
    })
  }

  function handleCompanyChange(nextRawValue: string) {
    setCompanyTouched(true)

    const trimmedValue = nextRawValue.trim()
    const normalizedValue = normalizeSearchText(trimmedValue)

    if (!trimmedValue) {
      setCompanyName('')
      setSelectedClientId('')
      setSelectedContactId('')
      setContactPerson('')
      return
    }

    const exactMatch =
      companyOptions.find(
        (client) => normalizeSearchText(client.name) === normalizedValue
      ) ?? null

    if (exactMatch) {
      setCompanyName(exactMatch.name)
      setSelectedClientId(exactMatch.id)
      setSelectedContactId('')
      setContactPerson('')
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
      setSelectedContactId('')
      setContactPerson('')

      setAutocompleteSelection(nextRawValue.length, completedName.length)
      return
    }

    setCompanyName(nextRawValue)
    setSelectedClientId('')
    setSelectedContactId('')
    setContactPerson('')
  }

  function handleCompanyFocus() {
    setCompanyHasFocus(true)
  }

  function handleCompanyBlur() {
    setCompanyHasFocus(false)
    setCompanyTouched(true)

    const trimmedValue = companyName.trim()
    const normalizedValue = normalizeSearchText(trimmedValue)

    if (!trimmedValue) {
      setCompanyName('')
      setSelectedClientId('')
      setSelectedContactId('')
      setContactPerson('')
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

    setSelectedClientId('')
    setSelectedContactId('')
    setContactPerson('')
  }

  function handleContactChange(nextContactId: string) {
    setSelectedContactId(nextContactId)

    const nextContact =
      selectedClientContacts.find((contact) => contact.id === nextContactId) ?? null

    setContactPerson(nextContact?.name ?? '')
  }

  const companyStatusText = (() => {
    const trimmedValue = companyName.trim()

    if (!trimmedValue) {
      return 'Začni psát název firmy ze seznamu klientů.'
    }

    if (companySelectionIsValid) {
      return 'Klient nalezen v seznamu.'
    }

    return 'Firma neexistuje v seznamu klientů.'
  })()

  const companyStatusClassName =
    companySelectionIsValid
      ? 'text-emerald-700'
      : companyName.trim()
        ? 'text-red-600'
        : 'text-gray-500'

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
      <div className="flex h-full items-center justify-center overflow-hidden">
        <div className="flex w-full max-w-5xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl">
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

          <form action={formAction} className="flex flex-col">
            <input type="hidden" name="job_status" value={job.job_status} />
            <input
              type="hidden"
              name="invoice_status"
              value={job.invoice_status}
            />
            <input type="hidden" name="client_id" value={selectedClientId} />
            <input type="hidden" name="client_contact_id" value={selectedContactId} />
            <input
              type="hidden"
              name="company_name"
              value={companySelectionIsValid ? companyName.trim() : ''}
            />

            <div className="px-4 py-3 sm:px-5 sm:py-4">
              <div className="grid gap-4 xl:grid-cols-[1.15fr_0.95fr_0.9fr]">
                <section className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50/60 p-4 sm:overflow-visible">
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
                        htmlFor={`${mode}-client-search`}
                        className="mb-1 block text-sm font-medium text-gray-700"
                      >
                        Firma *
                      </label>

                      <input
                        ref={companyInputRef}
                        id={`${mode}-client-search`}
                        type="text"
                        value={companyName}
                        autoComplete="off"
                        placeholder="Začni psát název firmy"
                        onChange={(event) => handleCompanyChange(event.target.value)}
                        onFocus={handleCompanyFocus}
                        onBlur={handleCompanyBlur}
                        className={`h-10 w-full rounded-xl border bg-white px-3 text-sm text-gray-900 outline-none transition focus:ring-2 ${
                          showCompanyError
                            ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                            : companySelectionIsValid && !companyHasFocus
                              ? 'border-emerald-300 focus:border-emerald-300 focus:ring-emerald-100'
                              : 'border-gray-200 focus:border-gray-300 focus:ring-gray-200'
                        }`}
                      />

                      <div className="mt-2 rounded-xl border border-gray-200 bg-white px-3 py-2.5">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
                          Vybraná firma
                        </div>
                        <div className="mt-1 text-sm text-gray-900">
                          {companySelectionIsValid
                            ? companyName.trim()
                            : 'Žádná firma není vybraná'}
                        </div>
                      </div>

                      <p className={`mt-2 text-sm ${companyStatusClassName}`}>
                        {companyStatusText}
                      </p>

                      {showCompanyError ? (
                        <p className="mt-2 text-sm text-red-600">
                          Pro uložení změn musíš zadat existující firmu ze seznamu klientů.
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
                      {selectedClientContacts.length > 0 ? (
                        <>
                          <select
                            id={`${mode}-client_contact_id`}
                            value={selectedContactId}
                            onChange={(event) => handleContactChange(event.target.value)}
                            className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                          >
                            <option value="">Bez konkrétní osoby</option>
                            {selectedClientContacts.map((contact) => (
                              <option key={contact.id} value={contact.id}>
                                {contact.name}
                                {contact.is_primary ? ' (hlavní)' : ''}
                              </option>
                            ))}
                          </select>
                          <input type="hidden" name="contact_person" value={contactPerson} />
                        </>
                      ) : (
                        <input
                          id={`${mode}-contact_person`}
                          name="contact_person"
                          type="text"
                          value={contactPerson}
                          onChange={(event) => setContactPerson(event.target.value)}
                          placeholder="Kontaktní osoba"
                          className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                        />
                      )}
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
                        defaultValue={job.sales_owner ?? 'JIŘÍ'}
                        className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                      >
                        <option value="JIŘÍ">JIŘÍ</option>
                        <option value="MICHAL">MICHAL</option>
                        <option value="LÍDA">LÍDA</option>
                      </select>
                    </div>
                  </div>
                </section>

                <section className="overflow-hidden rounded-2xl border border-gray-200 bg-gray-50/60 p-4 sm:overflow-visible">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Termín a místo
                    </h3>
                    <p className="mt-0.5 text-xs text-gray-500">
                      Začátek, konec a adresa realizace.
                    </p>
                  </div>

                  <div className="grid gap-3">
                    <div className="min-w-0">
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
                        defaultValue={toDateTimeLocalValue(job.start_at)}
                        className="h-10 w-full min-w-0 max-w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                      />
                    </div>

                    <div className="min-w-0">
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
                        defaultValue={toDateTimeLocalValue(job.end_at)}
                        className="h-10 w-full min-w-0 max-w-full appearance-none rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
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
                        defaultValue={job.site_address ?? ''}
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
                        defaultValue={job.store_number ?? ''}
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
                        defaultValue={job.technician_name ?? ''}
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
                        defaultValue={job.generator_name ?? ''}
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
                        defaultValue={job.info_note ?? ''}
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

            <div className="flex shrink-0 flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:px-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex shrink-0">
                <button
                  type="button"
                  onClick={onDelete}
                  disabled={isDeleting}
                  className="inline-flex h-10 min-w-[170px] shrink-0 items-center justify-center whitespace-nowrap rounded-xl border border-red-600 bg-red-600 px-4 text-sm font-medium uppercase text-white shadow-sm transition hover:border-red-700 hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isDeleting ? 'MAŽU ZAKÁZKU…' : 'SMAZAT ZAKÁZKU'}
                </button>
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isDeleting}
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium uppercase text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  ZRUŠIT
                </button>

                <SubmitButton
                  label={submitLabel}
                  disabled={isDeleting || !companySelectionIsValid}
                />
              </div>
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

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLocaleLowerCase('cs')
}
