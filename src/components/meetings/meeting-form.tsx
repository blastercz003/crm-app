'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { getPriorityLabel } from '@/app/tasks/taskUi'
import { MobileModalActions } from '@/components/ui/mobile-modal-actions'

type ClientOption = {
  id: string
  name: string
}

type ClientContactOption = {
  id: string
  client_id: string
  name: string
  phone: string | null
  email: string | null
  is_primary: boolean
}

type MeetingFormValues = {
  id?: string
  client_id?: string | null
  client_contact_id?: string | null
  company_name?: string | null
  contact_person?: string | null
  contact_phone?: string | null
  contact_email?: string | null
  address?: string | null
  title?: string | null
  meeting_datetime?: string | null
  pre_meeting_note?: string | null
  result_note?: string | null
  follow_up_task?: string | null
  follow_up_task_note?: string | null
  follow_up_task_priority?: string | null
  follow_up_task_due_date?: string | null
  status?: 'planned' | 'completed'
}

type MeetingFormProps = {
  action: (formData: FormData) => void
  submitLabel: string
  cancelHref?: string
  onCancel?: () => void
  cancelLabel?: string
  initialValues?: MeetingFormValues
  clients: ClientOption[]
  contacts?: ClientContactOption[]
  error?: string | null
  modalMode?: boolean
}

function formatDateTimeLocalInput(value?: string | null) {
  if (!value) return ''

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) return ''

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  const parts = formatter.formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  const hour = parts.find((part) => part.type === 'hour')?.value
  const minute = parts.find((part) => part.type === 'minute')?.value

  if (!year || !month || !day || !hour || !minute) return ''

  return `${year}-${month}-${day}T${hour}:${minute}`
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function MeetingForm({
  action,
  submitLabel,
  cancelHref,
  onCancel,
  cancelLabel = 'ZRUŠIT',
  initialValues,
  clients,
  contacts = [],
  error,
  modalMode = false,
}: MeetingFormProps) {
  const companyInputRef = useRef<HTMLInputElement>(null)

  const initialCompanyName = initialValues?.company_name ?? ''
  const initialClientId = initialValues?.client_id ?? ''
  const initialContactId = initialValues?.client_contact_id ?? ''

  const [companyName, setCompanyName] = useState(initialCompanyName)
  const [selectedClientId, setSelectedClientId] = useState(initialClientId)
  const [selectedContactId, setSelectedContactId] = useState(initialContactId)
  const [contactPerson, setContactPerson] = useState(initialValues?.contact_person ?? '')
  const [contactPhone, setContactPhone] = useState(initialValues?.contact_phone ?? '')
  const [contactEmail, setContactEmail] = useState(initialValues?.contact_email ?? '')
  const [companyTouched, setCompanyTouched] = useState(false)
  const [companyHasFocus, setCompanyHasFocus] = useState(false)

  const selectedClient =
    clients.find((client) => client.id === selectedClientId) ?? null
  const selectedClientContacts = contacts.filter(
    (contact) => contact.client_id === selectedClientId
  )

  const companySelectionIsValid =
    Boolean(selectedClientId) &&
    Boolean(selectedClient) &&
    companyName.trim() === (selectedClient?.name ?? '')

  const showCompanyError = companyTouched && !companySelectionIsValid

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
      return
    }

    const exactMatch =
      clients.find(
        (client) => normalizeSearchText(client.name) === normalizedValue
      ) ?? null

    if (exactMatch) {
      setCompanyName(exactMatch.name)
      setSelectedClientId(exactMatch.id)
      setSelectedContactId('')
      return
    }

    const prefixMatches = clients.filter((client) =>
      normalizeSearchText(client.name).startsWith(normalizedValue)
    )

    if (prefixMatches.length === 1) {
      const matchedClient = prefixMatches[0]
      const completedName = matchedClient.name

      setCompanyName(completedName)
      setSelectedClientId(matchedClient.id)
      setSelectedContactId('')

      setAutocompleteSelection(nextRawValue.length, completedName.length)
      return
    }

    setCompanyName(nextRawValue)
    setSelectedClientId('')
    setSelectedContactId('')
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
      return
    }

    const exactMatch =
      clients.find(
        (client) => normalizeSearchText(client.name) === normalizedValue
      ) ?? null

    if (exactMatch) {
      setCompanyName(exactMatch.name)
      setSelectedClientId(exactMatch.id)
      return
    }

    setSelectedClientId('')
    setSelectedContactId('')
  }

  function handleContactChange(nextContactId: string) {
    setSelectedContactId(nextContactId)

    const nextContact =
      selectedClientContacts.find((contact) => contact.id === nextContactId) ?? null

    if (!nextContact) {
      setContactPerson('')
      setContactPhone('')
      setContactEmail('')
      return
    }

    setContactPerson(nextContact.name)
    setContactPhone(nextContact.phone ?? '')
    setContactEmail(nextContact.email ?? '')
  }

  const companyStatusText = (() => {
    const trimmedValue = companyName.trim()

    if (!trimmedValue) {
      return 'Začni psát název firmy.'
    }

    if (companySelectionIsValid) {
      return 'Klient nalezen v databázi.'
    }

    return 'Firma není napojená na klienta z databáze.'
  })()

  const companyStatusClassName =
    companySelectionIsValid
      ? 'text-emerald-700'
      : companyName.trim()
        ? 'text-amber-700'
        : 'text-gray-500'

  const pendingSubmitLabel =
    submitLabel.trim().length > 0 && submitLabel === submitLabel.toUpperCase()
      ? 'UKLÁDÁM...'
      : 'Ukládám...'

  return (
    <form action={action} className={modalMode ? 'flex min-h-0 flex-1 flex-col' : 'space-y-6'}>
      <PendingFormLock />
      <PendingFieldset
        as={modalMode ? 'div' : 'fieldset'}
        className={modalMode ? 'flex min-h-0 flex-1 flex-col' : 'space-y-6'}
      >
        {initialValues?.id ? (
          <input type="hidden" name="id" value={initialValues.id} />
        ) : null}

        <input type="hidden" name="client_id" value={selectedClientId} />
        <input type="hidden" name="client_contact_id" value={selectedContactId} />

        <div className={modalMode ? 'min-h-0 flex-1 overflow-y-auto pb-4' : ''}>
        <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <label
            htmlFor="company_name"
            className="text-sm font-medium text-gray-900"
          >
            Firma
          </label>
          <input
            ref={companyInputRef}
            id="company_name"
            name="company_name"
            type="text"
            value={companyName}
            autoComplete="off"
            placeholder="Začni psát název firmy"
            onChange={(event) => handleCompanyChange(event.target.value)}
            onFocus={handleCompanyFocus}
            onBlur={handleCompanyBlur}
            className={`w-full rounded-2xl border bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:ring-2 ${
              showCompanyError
                ? 'border-amber-300 focus:border-amber-300 focus:ring-amber-100'
                : companySelectionIsValid && !companyHasFocus
                  ? 'border-emerald-300 focus:border-emerald-300 focus:ring-emerald-100'
                  : 'border-gray-200 focus:border-gray-300 focus:ring-gray-200'
            }`}
          />

          <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
              Napojení na klienta
            </div>
            <div className="mt-1 text-sm text-gray-900">
              {companySelectionIsValid
                ? selectedClient?.name
                : 'Žádný klient není vybraný'}
            </div>
          </div>

          <p className={`text-sm ${companyStatusClassName}`}>
            {companyStatusText}
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="contact_person"
            className="text-sm font-medium text-gray-900"
          >
            Kontaktní osoba
          </label>
          {selectedClientContacts.length > 0 ? (
            <>
              <select
                id="client_contact_select"
                value={selectedContactId}
                onChange={(event) => handleContactChange(event.target.value)}
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
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
              id="contact_person"
              name="contact_person"
              type="text"
              value={contactPerson}
              onChange={(event) => setContactPerson(event.target.value)}
              placeholder="Např. Jan Novák"
              className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
            />
          )}
        </div>

        <div className="space-y-2">
          <label
            htmlFor="contact_phone"
            className="text-sm font-medium text-gray-900"
          >
            Telefon
          </label>
          <input
            id="contact_phone"
            name="contact_phone"
            type="text"
            value={contactPhone}
            onChange={(event) => setContactPhone(event.target.value)}
            placeholder="Např. +420 777 123 456"
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="contact_email"
            className="text-sm font-medium text-gray-900"
          >
            E-mail
          </label>
          <input
            id="contact_email"
            name="contact_email"
            type="email"
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            placeholder="Např. novak@firma.cz"
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label
            htmlFor="address"
            className="text-sm font-medium text-gray-900"
          >
            Adresa
          </label>
          <input
            id="address"
            name="address"
            type="text"
            defaultValue={initialValues?.address ?? ''}
            placeholder="Např. Ulice 123, Praha"
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label htmlFor="title" className="text-sm font-medium text-gray-900">
            Název schůzky
          </label>
          <input
            id="title"
            name="title"
            type="text"
            defaultValue={initialValues?.title ?? ''}
            placeholder="Např. Úvodní schůzka"
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="min-w-0 space-y-2">
          <label
            htmlFor="meeting_datetime"
            className="text-sm font-medium text-gray-900"
          >
            Datum a čas
          </label>
          <input
            id="meeting_datetime"
            name="meeting_datetime"
            type="datetime-local"
            defaultValue={formatDateTimeLocalInput(
              initialValues?.meeting_datetime
            )}
            className="w-full max-w-full min-w-0 appearance-none rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
            style={{ minWidth: 0 }}
          />
        </div>

        <div className="min-w-0 space-y-2">
          <label htmlFor="status" className="text-sm font-medium text-gray-900">
            Stav
          </label>
          <select
            id="status"
            name="status"
            defaultValue={initialValues?.status ?? 'planned'}
            className="w-full max-w-full min-w-0 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          >
            <option value="planned">Plánovaná</option>
            <option value="completed">Dokončená</option>
          </select>
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label
            htmlFor="pre_meeting_note"
            className="text-sm font-medium text-gray-900"
          >
            Poznámka před schůzkou
          </label>
          <textarea
            id="pre_meeting_note"
            name="pre_meeting_note"
            rows={4}
            defaultValue={initialValues?.pre_meeting_note ?? ''}
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label
            htmlFor="result_note"
            className="text-sm font-medium text-gray-900"
          >
            Výsledek schůzky
          </label>
          <textarea
            id="result_note"
            name="result_note"
            rows={4}
            defaultValue={initialValues?.result_note ?? ''}
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label
            htmlFor="follow_up_task"
            className="text-sm font-medium text-gray-900"
          >
            Název úkolu po schůzce
          </label>
          <input
            id="follow_up_task"
            name="follow_up_task"
            type="text"
            defaultValue={initialValues?.follow_up_task ?? ''}
            placeholder="Např. Poslat cenovou nabídku"
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <label
            htmlFor="follow_up_task_note"
            className="text-sm font-medium text-gray-900"
          >
            Poznámka k úkolu
          </label>
          <textarea
            id="follow_up_task_note"
            name="follow_up_task_note"
            rows={4}
            defaultValue={initialValues?.follow_up_task_note ?? ''}
            placeholder="Doplňující informace, které se mají propsat do poznámky úkolu"
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="follow_up_task_due_date"
            className="text-sm font-medium text-gray-900"
          >
            Termín úkolu po schůzce
          </label>
          <input
            id="follow_up_task_due_date"
            name="follow_up_task_due_date"
            type="date"
            defaultValue={initialValues?.follow_up_task_due_date ?? ''}
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          />
        </div>

        <div className="space-y-2">
          <label
            htmlFor="follow_up_task_priority"
            className="text-sm font-medium text-gray-900"
          >
            Priorita úkolu po schůzce
          </label>
          <select
            id="follow_up_task_priority"
            name="follow_up_task_priority"
            defaultValue={initialValues?.follow_up_task_priority ?? 'medium'}
            className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
          >
            <option value="low">{getPriorityLabel('low')}</option>
            <option value="medium">{getPriorityLabel('medium')}</option>
            <option value="high">{getPriorityLabel('high')}</option>
          </select>
        </div>
        </div>

        {error ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}
        </div>

        <MeetingFormActions
          submitLabel={submitLabel}
          pendingSubmitLabel={pendingSubmitLabel}
          onCancel={onCancel}
          cancelHref={cancelHref}
          cancelLabel={cancelLabel}
        />
      </PendingFieldset>
    </form>
  )
}

function PendingFormLock() {
  const { pending } = useFormStatus()

  if (!pending) return null

  return (
    <div className="rounded-2xl border border-[#2980B9]/25 bg-[#2980B9]/10 px-4 py-3 text-sm font-medium text-[#1d5f88]">
      Ukládám schůzku, čekej prosím...
    </div>
  )
}

function PendingFieldset({
  children,
  className,
  as = 'fieldset',
}: {
  children: React.ReactNode
  className?: string
  as?: 'fieldset' | 'div'
}) {
  const { pending } = useFormStatus()

  if (as === 'div') {
    return (
      <div
        aria-disabled={pending}
        className={`${className ?? ''} ${
          pending ? 'pointer-events-none cursor-wait opacity-80' : ''
        }`}
      >
        {children}
      </div>
    )
  }

  return (
    <fieldset
      disabled={pending}
      className={`${className ?? ''} ${
        pending ? 'cursor-wait opacity-80' : ''
      }`}
    >
      {children}
    </fieldset>
  )
}

function MeetingFormActions({
  submitLabel,
  pendingSubmitLabel,
  onCancel,
  cancelHref,
  cancelLabel,
}: {
  submitLabel: string
  pendingSubmitLabel: string
  onCancel?: () => void
  cancelHref?: string
  cancelLabel: string
}) {
  const { pending } = useFormStatus()

  return (
    <>
      {onCancel ? (
        <MobileModalActions
          onCancel={onCancel}
          submitLabel={submitLabel}
          pendingSubmitLabel={pendingSubmitLabel}
        />
      ) : (
        <div
          className={`flex flex-col gap-3 border-t border-gray-100 pt-6 sm:flex-row sm:justify-end ${
            pending ? 'cursor-wait' : ''
          }`}
        >
          {cancelHref ? (
            <Link
              href={cancelHref}
              aria-disabled={pending}
              className={`inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 ${
                pending ? 'pointer-events-none opacity-60' : ''
              }`}
            >
              {cancelLabel}
            </Link>
          ) : null}

          <button
            type="submit"
            disabled={pending}
            aria-busy={pending}
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-75"
          >
            {pending ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : null}
            {pending ? pendingSubmitLabel : submitLabel}
          </button>
        </div>
      )}
    </>
  )
}
