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

const glassFieldBaseClass =
  'w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-0 focus-visible:outline-none focus-visible:ring-0'

const glassFieldClass = glassFieldBaseClass
const glassSelectClass = `${glassFieldBaseClass} h-[46px] appearance-none bg-no-repeat py-0 pr-10`
const modalPanelClass =
  'meetings-form__panel rounded-[22px] border p-3.5 sm:p-4'
const modalPanelTitleClass =
  'meetings-form__panel-title mb-3 text-[11px] font-semibold uppercase tracking-[0.18em]'
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

  return (
    <form action={action} autoComplete="off" className={`${modalMode ? 'flex min-h-0 flex-1 flex-col' : 'space-y-6'} meetings-form`}>
      <PendingFormLock />
      <PendingFieldset
        as={modalMode ? 'div' : 'fieldset'}
        className={`${modalMode ? 'flex min-h-0 flex-1 flex-col' : 'space-y-6'} meetings-form__fieldset`}
      >
        {initialValues?.id ? (
          <input type="hidden" name="id" value={initialValues.id} />
        ) : null}

        <input type="hidden" name="client_id" value={selectedClientId} />
        <input type="hidden" name="client_contact_id" value={selectedContactId} />

        <div className={modalMode ? 'min-h-0 flex-1 overflow-y-auto pb-4' : ''}>
          <div className={modalMode ? 'space-y-4' : 'grid gap-5 sm:grid-cols-2'}>
            <section className={modalMode ? modalPanelClass : 'contents'}>
              {modalMode ? (
                <h3 className={modalPanelTitleClass}>Klient a kontakt</h3>
              ) : null}
              <div className={modalMode ? 'grid gap-3 sm:grid-cols-6' : 'contents'}>
            <div className={`meetings-form__field space-y-2 ${modalMode ? 'sm:col-span-6' : 'sm:col-span-2'}`}>
          <label
            htmlFor="company_name"
            className="meetings-form__label text-sm font-medium text-gray-900"
          >
            Firma
          </label>
          <input
            ref={companyInputRef}
            id="company_name"
            name="company_name"
            type="text"
            autoComplete="off"
            value={companyName}
            placeholder="Začni psát název firmy"
            onChange={(event) => handleCompanyChange(event.target.value)}
            onFocus={handleCompanyFocus}
            onBlur={handleCompanyBlur}
            className={`mb-1 ${glassFieldBaseClass} ${
              showCompanyError
                ? 'border-amber-300 focus:border-amber-300 focus:ring-0'
                : companySelectionIsValid && !companyHasFocus
                  ? 'border-emerald-300 focus:border-emerald-300 focus:ring-0'
                  : ''
            }`}
          />

          <div className={`meetings-form__info mt-1 rounded-2xl border border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.94)] ${modalMode ? 'px-3 py-2.5' : 'px-4 py-3'}`}>
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
            <p className={`text-sm ${companyStatusClassName}`}>
              {companyStatusText}
            </p>
          ) : null}
        </div>

            <div className={`meetings-form__field space-y-2 ${modalMode ? 'sm:col-span-2' : ''}`}>
          <label
            htmlFor="contact_person"
            className="meetings-form__label text-sm font-medium text-gray-900"
          >
            Kontaktní osoba
          </label>
          {selectedClientContacts.length > 0 ? (
            <>
              <select
                id="client_contact_select"
                value={selectedContactId}
                onChange={(event) => handleContactChange(event.target.value)}
                className={`${glassSelectClass} meetings-form__select`}
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
              autoComplete="off"
              value={contactPerson}
              onChange={(event) => setContactPerson(event.target.value)}
              placeholder="Např. Kvído Kýbl"
              className={glassFieldClass}
            />
          )}
        </div>

            <div className={`meetings-form__field space-y-2 ${modalMode ? 'sm:col-span-2' : ''}`}>
          <label
            htmlFor="contact_phone"
            className="meetings-form__label text-sm font-medium text-gray-900"
          >
            Telefon
          </label>
          <input
            id="contact_phone"
            name="contact_phone"
            type="text"
            autoComplete="off"
            value={contactPhone}
            onChange={(event) => setContactPhone(event.target.value)}
            placeholder="Např. +420 777 123 456"
            className={glassFieldClass}
          />
        </div>

            <div className={`meetings-form__field space-y-2 ${modalMode ? 'sm:col-span-2' : ''}`}>
          <label
            htmlFor="contact_email"
            className="meetings-form__label text-sm font-medium text-gray-900"
          >
            E-mail
          </label>
          <input
            id="contact_email"
            name="contact_email"
            type="email"
            autoComplete="off"
            value={contactEmail}
            onChange={(event) => setContactEmail(event.target.value)}
            placeholder="Např. kvido@kybl.cz"
            className={glassFieldClass}
          />
        </div>

            <div className={`meetings-form__field space-y-2 ${modalMode ? 'sm:col-span-6' : 'sm:col-span-2'}`}>
          <label
            htmlFor="address"
            className="meetings-form__label text-sm font-medium text-gray-900"
          >
            Adresa
          </label>
          <input
            id="address"
            name="address"
            type="text"
            autoComplete="off"
            defaultValue={initialValues?.address ?? ''}
            placeholder="Např. Bezvýpadková 1, Praha"
            className={glassFieldClass}
          />
        </div>
              </div>
            </section>

            <section className={modalMode ? modalPanelClass : 'contents'}>
              {modalMode ? (
                <h3 className={modalPanelTitleClass}>Schůzka</h3>
              ) : null}
              <div className={modalMode ? 'grid gap-3 sm:grid-cols-6' : 'contents'}>
            <div className={`meetings-form__field space-y-2 ${modalMode ? 'sm:col-span-6' : 'sm:col-span-2'}`}>
          <label htmlFor="title" className="meetings-form__label text-sm font-medium text-gray-900">
            Název schůzky
          </label>
          <input
            id="title"
            name="title"
            type="text"
            autoComplete="off"
            defaultValue={initialValues?.title ?? ''}
            placeholder="Např. Úvodní schůzka"
            className={glassFieldClass}
          />
        </div>

            <div className={`meetings-form__field min-w-0 space-y-2 ${modalMode ? 'sm:col-span-4' : ''}`}>
          <label
            htmlFor="meeting_datetime"
            className="meetings-form__label text-sm font-medium text-gray-900"
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
            className={`${glassFieldClass} max-w-full min-w-0 appearance-none`}
            style={{ minWidth: 0 }}
          />
        </div>

        <div className={`meetings-form__field min-w-0 space-y-2 ${modalMode ? 'sm:col-span-2' : ''}`}>
          <label htmlFor="status" className="meetings-form__label text-sm font-medium text-gray-900">
            Stav
          </label>
          <select
            id="status"
            name="status"
            defaultValue={initialValues?.status ?? 'planned'}
            className={`${glassSelectClass} meetings-form__select max-w-full min-w-0`}
          >
            <option value="planned">Plánovaná</option>
            <option value="completed">Dokončená</option>
          </select>
        </div>

            <div className={`meetings-form__field space-y-2 ${modalMode ? 'sm:col-span-3' : 'sm:col-span-2'}`}>
          <label
            htmlFor="pre_meeting_note"
            className="meetings-form__label text-sm font-medium text-gray-900"
          >
            Poznámka před schůzkou
          </label>
          <textarea
            id="pre_meeting_note"
            name="pre_meeting_note"
            rows={modalMode ? 3 : 4}
            defaultValue={initialValues?.pre_meeting_note ?? ''}
            className={glassFieldClass}
          />
        </div>

            <div className={`meetings-form__field space-y-2 ${modalMode ? 'sm:col-span-3' : 'sm:col-span-2'}`}>
          <label
            htmlFor="result_note"
            className="meetings-form__label text-sm font-medium text-gray-900"
          >
            Výsledek schůzky
          </label>
          <textarea
            id="result_note"
            name="result_note"
            rows={modalMode ? 3 : 4}
            defaultValue={initialValues?.result_note ?? ''}
            className={glassFieldClass}
          />
        </div>
              </div>
            </section>

            <section className={modalMode ? modalPanelClass : 'contents'}>
              {modalMode ? (
                <h3 className={modalPanelTitleClass}>Navazující úkol</h3>
              ) : null}
              <div className={modalMode ? 'grid gap-3 sm:grid-cols-6' : 'contents'}>
            <div className={`meetings-form__field space-y-2 ${modalMode ? 'sm:col-span-6' : 'sm:col-span-2'}`}>
          <label
            htmlFor="follow_up_task"
            className="meetings-form__label text-sm font-medium text-gray-900"
          >
            Název úkolu po schůzce
          </label>
          <input
            id="follow_up_task"
            name="follow_up_task"
            type="text"
            defaultValue={initialValues?.follow_up_task ?? ''}
            placeholder="Např. Poslat cenovou nabídku"
            className={glassFieldClass}
          />
        </div>

        <div className={`meetings-form__field space-y-2 ${modalMode ? 'sm:col-span-6' : 'sm:col-span-2'}`}>
          <label
            htmlFor="follow_up_task_note"
            className="meetings-form__label text-sm font-medium text-gray-900"
          >
            Poznámka k úkolu
          </label>
          <textarea
            id="follow_up_task_note"
            name="follow_up_task_note"
            rows={modalMode ? 3 : 4}
            defaultValue={initialValues?.follow_up_task_note ?? ''}
            placeholder="Doplňující informace, které se mají propsat do poznámky úkolu"
            className={glassFieldClass}
          />
        </div>

            <div className={`meetings-form__field space-y-2 ${modalMode ? 'sm:col-span-3' : ''}`}>
          <label
            htmlFor="follow_up_task_due_date"
            className="meetings-form__label text-sm font-medium text-gray-900"
          >
            Termín úkolu po schůzce
          </label>
          <input
            id="follow_up_task_due_date"
            name="follow_up_task_due_date"
            type="date"
            defaultValue={initialValues?.follow_up_task_due_date ?? ''}
            className={`${glassFieldClass} max-w-full min-w-0 appearance-none [&::-webkit-calendar-picker-indicator]:opacity-100`}
            style={{ minWidth: 0 }}
          />
        </div>

        <div className={`meetings-form__field space-y-2 ${modalMode ? 'sm:col-span-3' : ''}`}>
          <label
            htmlFor="follow_up_task_priority"
            className="meetings-form__label text-sm font-medium text-gray-900"
          >
            Priorita úkolu po schůzce
          </label>
          <select
            id="follow_up_task_priority"
            name="follow_up_task_priority"
            defaultValue={initialValues?.follow_up_task_priority ?? 'medium'}
            className={`${glassSelectClass} meetings-form__select`}
          >
            <option value="low">{getPriorityLabel('low')}</option>
            <option value="medium">{getPriorityLabel('medium')}</option>
            <option value="high">{getPriorityLabel('high')}</option>
          </select>
        </div>
              </div>
            </section>
          </div>

        {error ? (
          <div className="meetings-form__error rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(127,29,29,0.10)]">
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
    <div className="meetings-form__pending rounded-2xl border border-[#2980B9]/25 bg-[#2980B9]/10 px-4 py-3 text-sm font-medium text-[#1d5f88] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(24,95,145,0.14)]">
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
        <div className="meetings-form__actions-shell -mx-4 -mb-3 mt-4 sm:-mx-5 sm:-mb-4">
          <MobileModalActions
            onCancel={onCancel}
            submitLabel={submitLabel}
            pendingSubmitLabel={pendingSubmitLabel}
            visualStyle="meeting-modal"
          />
        </div>
      ) : (
        <div
          className={`meetings-form__actions flex flex-col gap-3 border-t border-gray-100 pt-6 sm:flex-row sm:justify-end ${
            pending ? 'cursor-wait' : ''
          }`}
        >
          {cancelHref ? (
            <Link
              href={cancelHref}
              aria-disabled={pending}
              className={`meetings-form__cancel inline-flex items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-4 py-2.5 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)] ${
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
            className="meetings-form__submit inline-flex items-center justify-center gap-2 rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)] disabled:cursor-not-allowed disabled:opacity-75"
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
