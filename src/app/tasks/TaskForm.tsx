'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { getRepeatIntervalLabel } from './taskUi'

type UserOption = {
  id: string
  name: string | null
  role: string | null
}

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

type TaskFormValues = {
  title?: string | null
  note?: string | null
  due_date?: string | null
  status?: string | null
  priority?: string | null
  repeat_interval?: string | null
  assigned_to?: string | null
  client_id?: string | null
  client_contact_id?: string | null
  company_name?: string | null
  contact_person?: string | null
}

type TaskFormProps = {
  users: UserOption[]
  clients: ClientOption[]
  contacts?: ClientContactOption[]
  submitLabel: string
  cancelHref?: string
  onCancel?: () => void
  cancelLabel?: string
  action: (formData: FormData) => void | Promise<void>
  initialValues?: TaskFormValues
  error?: string | null
  extraActions?: React.ReactNode
}

const inputClassName =
  'min-w-0 w-full max-w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-gray-400 focus:ring-2 focus:ring-gray-200'

const labelClassName = 'mb-2 block text-sm font-medium text-gray-700'

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export default function TaskForm({
  users,
  clients,
  contacts = [],
  submitLabel,
  cancelHref = '/tasks',
  onCancel,
  cancelLabel = 'ZRUŠIT',
  action,
  initialValues,
  error,
  extraActions,
}: TaskFormProps) {
  const companyInputRef = useRef<HTMLInputElement>(null)

  const initialCompanyName = initialValues?.company_name ?? ''
  const initialClientId = initialValues?.client_id ?? ''
  const initialContactId = initialValues?.client_contact_id ?? ''

  const [companyName, setCompanyName] = useState(initialCompanyName)
  const [selectedClientId, setSelectedClientId] = useState(initialClientId)
  const [selectedContactId, setSelectedContactId] = useState(initialContactId)
  const [contactPerson, setContactPerson] = useState(initialValues?.contact_person ?? '')
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

    setContactPerson(nextContact?.name ?? '')
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

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="client_id" value={selectedClientId} />
      <input type="hidden" name="client_contact_id" value={selectedContactId} />

      <div className="grid gap-5 md:grid-cols-2">
        <div className="md:col-span-2">
          <label htmlFor="title" className={labelClassName}>
            Název úkolu
          </label>
          <input
            id="title"
            name="title"
            type="text"
            required
            defaultValue={initialValues?.title ?? ''}
            className={inputClassName}
            placeholder="Např. Zavolat klientovi kvůli termínu schůzky"
          />
        </div>

        <div className="md:col-span-2">
          <label htmlFor="company_name" className={labelClassName}>
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
            className={`w-full rounded-lg border bg-white px-4 py-3 text-base text-gray-900 placeholder:text-gray-400 outline-none transition focus:ring-2 ${
              showCompanyError
                ? 'border-amber-300 focus:border-amber-300 focus:ring-amber-100'
                : companySelectionIsValid && !companyHasFocus
                  ? 'border-emerald-300 focus:border-emerald-300 focus:ring-emerald-100'
                  : 'border-gray-300 focus:border-gray-400 focus:ring-gray-200'
            }`}
          />

          <div className="mt-3 rounded-2xl border border-gray-200 bg-white px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
              Napojení na klienta
            </div>
            <div className="mt-1 text-sm text-gray-900">
              {companySelectionIsValid
                ? selectedClient?.name
                : 'Žádný klient není vybraný'}
            </div>
          </div>

          <p className={`mt-2 text-sm ${companyStatusClassName}`}>
            {companyStatusText}
          </p>

          <p className="mt-2 text-xs text-gray-500">
            Klient je volitelný. Úkol může fungovat i jako běžný interní úkol mezi uživateli.
          </p>
        </div>

        <div className="min-w-0">
          <label htmlFor="contact_person" className={labelClassName}>
            Kontaktní osoba
          </label>
          {selectedClientContacts.length > 0 ? (
            <>
              <select
                id="client_contact_select"
                value={selectedContactId}
                onChange={(event) => handleContactChange(event.target.value)}
                className={inputClassName}
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
              className={inputClassName}
              placeholder="Např. Jan Novák"
            />
          )}
        </div>

        <div className="min-w-0">
          <label htmlFor="assigned_to" className={labelClassName}>
            Přiřadit uživateli
          </label>
          <select
            id="assigned_to"
            name="assigned_to"
            defaultValue={initialValues?.assigned_to ?? ''}
            className={inputClassName}
          >
            <option value="">Nepřiřazeno</option>
            {users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.name ?? 'Uživatel bez jména'}
                {user.role ? ` (${user.role})` : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0">
          <label htmlFor="due_date" className={labelClassName}>
            Termín
          </label>
          <input
            id="due_date"
            name="due_date"
            type="date"
            defaultValue={initialValues?.due_date ?? ''}
            className={`${inputClassName} appearance-none [&::-webkit-calendar-picker-indicator]:opacity-100`}
            style={{ minWidth: 0 }}
          />
        </div>

        <div className="min-w-0">
          <label htmlFor="status" className={labelClassName}>
            Stav
          </label>
          <select
            id="status"
            name="status"
            defaultValue={initialValues?.status ?? 'todo'}
            className={inputClassName}
          >
            <option value="todo">K vyřízení</option>
            <option value="done">Hotovo</option>
          </select>
        </div>

        <div className="min-w-0">
          <label htmlFor="priority" className={labelClassName}>
            Priorita
          </label>
          <select
            id="priority"
            name="priority"
            defaultValue={initialValues?.priority ?? 'medium'}
            className={inputClassName}
          >
            <option value="low">Nízká</option>
            <option value="medium">Střední</option>
            <option value="high">Vysoká</option>
          </select>
        </div>

        <div className="min-w-0">
          <label htmlFor="repeat_interval" className={labelClassName}>
            Opakování úkolu
          </label>
          <select
            id="repeat_interval"
            name="repeat_interval"
            defaultValue={initialValues?.repeat_interval ?? ''}
            className={inputClassName}
          >
            <option value="">Bez opakování</option>
            <option value="daily">{getRepeatIntervalLabel('daily')}</option>
            <option value="weekly">{getRepeatIntervalLabel('weekly')}</option>
            <option value="monthly">{getRepeatIntervalLabel('monthly')}</option>
          </select>
          <p className="mt-2 text-xs text-gray-500">
            Opakování vyžaduje termín. Po dokončení se automaticky vytvoří další výskyt.
          </p>
        </div>

        <div className="md:col-span-2">
          <label htmlFor="note" className={labelClassName}>
            Zadání úkolu
          </label>
          <textarea
            id="note"
            name="note"
            rows={6}
            defaultValue={initialValues?.note ?? ''}
            className={`${inputClassName} min-h-[220px] resize-y`}
            placeholder="Popište zadání úkolu"
          />
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          className="rounded-lg bg-black px-5 py-3 text-sm font-medium text-white transition hover:opacity-90"
        >
          {submitLabel}
        </button>

        {extraActions}

        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {cancelLabel}
          </button>
        ) : (
          <Link
            href={cancelHref}
            className="rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            {cancelLabel}
          </Link>
        )}
      </div>
    </form>
  )
}
