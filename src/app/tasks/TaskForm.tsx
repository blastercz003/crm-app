'use client'

import Link from 'next/link'
import { useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { getRepeatIntervalLabel } from './taskUi'
import { MobileModalActions } from '@/components/ui/mobile-modal-actions'

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
  modalMode?: boolean
}

const inputClassName =
  'clients-modal__input task-form__input min-w-0 w-full max-w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.96)] transition duration-200 ease-out focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

const selectClassName = `${inputClassName} task-form__select h-[46px] appearance-none bg-no-repeat py-0 pr-10`
const selectArrowStyle = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2020%2020'%20fill='none'%20stroke='%236b7280'%20stroke-width='2.2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M6%208l4%204%204-4'/%3E%3C/svg%3E\")",
  backgroundPosition: 'right 0.95rem center',
  backgroundSize: '16px 16px',
} as const

const labelClassName = 'clients-modal__label task-form__label mb-2 block text-sm font-medium text-gray-700'
const modalPanelClass =
  'task-form__panel rounded-[22px] border p-3.5 sm:p-4'
const modalPanelTitleClass =
  'task-form__panel-title mb-3 text-[11px] font-semibold uppercase tracking-[0.18em]'

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
  modalMode = false,
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
      return modalMode ? '' : 'Začni psát název firmy.'
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

  const taskNoteField = (
    <div className={modalMode ? '' : 'md:col-span-2'}>
      <label htmlFor="note" className={labelClassName}>
        Zadání úkolu
      </label>
      <textarea
        id="note"
        name="note"
        rows={modalMode ? 4 : 6}
        defaultValue={initialValues?.note ?? ''}
        className={`${inputClassName} resize-y ${
          modalMode ? 'min-h-[140px] sm:min-h-[150px]' : 'min-h-[220px]'
        }`}
        placeholder="Popište zadání úkolu"
      />
    </div>
  )

  return (
    <form action={action} className={modalMode ? 'flex min-h-0 flex-1 flex-col' : 'space-y-6'}>
      <PendingFormLock />
      <PendingFieldset
        as={modalMode ? 'div' : 'fieldset'}
        className={modalMode ? 'flex min-h-0 flex-1 flex-col' : 'space-y-6'}
      >
        <input type="hidden" name="client_id" value={selectedClientId} />
        <input type="hidden" name="client_contact_id" value={selectedContactId} />
        <div className={modalMode ? 'min-h-0 flex-1 overflow-y-auto pb-4' : ''}>
        <div className={modalMode ? 'space-y-4' : 'grid gap-5 md:grid-cols-2'}>
        <section className={modalMode ? modalPanelClass : 'contents'}>
          {modalMode ? (
            <h3 className={modalPanelTitleClass}>Zadání úkolu</h3>
          ) : null}
          <div className={modalMode ? 'space-y-3' : 'contents'}>
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
          {modalMode ? taskNoteField : null}
          </div>
        </section>

        <section className={modalMode ? modalPanelClass : 'contents'}>
          {modalMode ? (
            <h3 className={modalPanelTitleClass}>Klient a odpovědnost</h3>
          ) : null}
          <div className={modalMode ? 'grid gap-3 md:grid-cols-2' : 'contents'}>
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
            className={`clients-modal__input task-form__input mb-1 w-full rounded-2xl border bg-white/96 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.96)] transition duration-200 ease-out focus:ring-2 ${
              showCompanyError
                ? 'border-amber-300 focus:border-amber-300 focus:ring-amber-100'
                : companySelectionIsValid && !companyHasFocus
                  ? 'border-emerald-300 focus:border-emerald-300 focus:ring-emerald-100'
                  : 'border-gray-200 focus:border-[#9dc7e5] focus:ring-[#b9d8ef]'
            }`}
          />

          <div className={`task-form__company-status mt-1 rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.94)] ${modalMode ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500">
              Napojení na klienta
            </div>
            <div className="mt-1 text-sm text-gray-900">
              {companySelectionIsValid
                ? selectedClient?.name
                : 'Žádný klient není vybraný'}
            </div>
          </div>

          {companyStatusText ? (
            <p className={`mt-2 text-sm ${companyStatusClassName}`}>
              {companyStatusText}
            </p>
          ) : null}

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
                className={selectClassName}
                style={selectArrowStyle}
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
              placeholder="Např. Kvído Kýbl"
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
            className={selectClassName}
            style={selectArrowStyle}
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
          </div>
        </section>

        <section className={modalMode ? modalPanelClass : 'contents'}>
          {modalMode ? (
            <h3 className={modalPanelTitleClass}>Termín a režim</h3>
          ) : null}
          <div className={modalMode ? 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4' : 'contents'}>
        <div className="min-w-0">
          <label htmlFor="due_date" className={labelClassName}>
            Termín
          </label>
          <input
            id="due_date"
            name="due_date"
            type="date"
            defaultValue={initialValues?.due_date ?? ''}
            className={`${inputClassName} task-form__date appearance-none [&::-webkit-calendar-picker-indicator]:opacity-100`}
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
            className={selectClassName}
            style={selectArrowStyle}
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
            className={selectClassName}
            style={selectArrowStyle}
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
            className={selectClassName}
            style={selectArrowStyle}
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
          </div>
        </section>

        {!modalMode ? taskNoteField : null}
        </div>

        {error ? (
          <div className="task-form__error rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(127,29,29,0.10)]">
            {error}
          </div>
        ) : null}
        </div>

        <TaskFormActions
          submitLabel={submitLabel}
          pendingSubmitLabel={pendingSubmitLabel}
          extraActions={extraActions}
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
    <div className="task-form__pending rounded-2xl border border-[#2980B9]/25 bg-[#2980B9]/10 px-4 py-3 text-sm font-medium text-[#1d5f88] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(24,95,145,0.14)]">
      Ukládám úkol, čekej prosím...
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

function TaskFormActions({
  submitLabel,
  pendingSubmitLabel,
  extraActions,
  onCancel,
  cancelHref,
  cancelLabel,
}: {
  submitLabel: string
  pendingSubmitLabel: string
  extraActions?: React.ReactNode
  onCancel?: () => void
  cancelHref: string
  cancelLabel: string
}) {
  const { pending } = useFormStatus()

  return (
    <>
      {onCancel ? (
        <div className="tasks-form__actions-shell -mx-4 -mb-3 mt-4 sm:-mx-5 sm:-mb-4">
          <MobileModalActions
            onCancel={onCancel}
            submitLabel={submitLabel}
            pendingSubmitLabel={pendingSubmitLabel}
            visualStyle="client-modal"
          />
        </div>
      ) : (
        <div className={`flex flex-wrap gap-3 ${pending ? 'cursor-wait' : ''}`}>
        <button
          type="submit"
          disabled={pending}
          aria-busy={pending}
          className="clients-page__submit inline-flex items-center justify-center gap-2 rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-5 py-3 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)] disabled:cursor-not-allowed disabled:opacity-75"
        >
          {pending ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          ) : null}
          {pending ? pendingSubmitLabel : submitLabel}
        </button>

        {extraActions}

        {onCancel ? (
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="clients-page__cancel rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-5 py-3 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cancelLabel}
          </button>
        ) : (
          <Link
            href={cancelHref}
            aria-disabled={pending}
            className={`clients-page__cancel rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-5 py-3 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)] ${
              pending ? 'pointer-events-none opacity-60' : ''
            }`}
          >
            {cancelLabel}
          </Link>
        )}
        </div>
      )}
    </>
  )
}
