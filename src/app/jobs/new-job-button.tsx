'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createJobAction, type CreateJobActionState } from './actions'
import { buildJobCreatedToast } from '@/components/ui/action-feedback-messages'
import {
  ActionFeedbackToast,
  useAnimatedActionToast,
} from '@/components/ui/action-feedback-toast'
import { MobileModalActions } from '@/components/ui/mobile-modal-actions'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'

type SalesOwner = 'JIŘÍ' | 'MICHAL' | 'LÍDA'

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
}

type NewJobButtonProps = {
  clientSuggestions: ClientOption[]
  clientContacts?: ClientContactOption[]
  className?: string
  isAdmin?: boolean
}

const initialCreateState: CreateJobActionState = {
  success: false,
  error: null,
}

export function NewJobButton({
  clientSuggestions,
  clientContacts = [],
  className,
  isAdmin = true,
}: NewJobButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const { toast, isVisible: isToastVisible, showToast } = useAnimatedActionToast()

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
    'inline-flex items-center justify-center rounded-2xl border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_26px_rgba(9,48,82,0.32)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-[#1f5f8e] hover:bg-[linear-gradient(160deg,rgba(56,125,177,0.95)_0%,rgba(37,109,163,0.96)_45%,rgba(22,86,138,0.98)_100%)]'

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
          clientContacts={clientContacts}
          onClose={closeModal}
          onSuccess={(state) => showToast(buildJobCreatedToast(state))}
        />
      ) : null}

      {toast ? <ActionFeedbackToast toast={toast} isVisible={isToastVisible} /> : null}
    </>
  )
}

export function CreateJobModal({
  clientSuggestions,
  clientContacts,
  onClose,
  onSuccess,
}: {
  clientSuggestions: ClientOption[]
  clientContacts: ClientContactOption[]
  onClose: () => void
  onSuccess?: (state: CreateJobActionState) => void
}) {
  const [state, formAction] = useActionState(createJobAction, initialCreateState)

  useEffect(() => {
    if (state.success) {
      onSuccess?.(state)
      onClose()
    }
  }, [onClose, onSuccess, state])

  return (
    <JobFormShell
      mode="create"
      clientSuggestions={clientSuggestions}
      clientContacts={clientContacts}
      onClose={onClose}
      error={state.error}
      formAction={formAction}
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
}: {
  mode: 'create'
  clientSuggestions: ClientOption[]
  clientContacts: ClientContactOption[]
  onClose: () => void
  error: string | null
  formAction: (payload: FormData) => void
  job?: JobFormValues
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

    if (job?.client_id && job.company_name?.trim()) {
      map.set(job.client_id, {
        id: job.client_id,
        name: job.company_name.trim(),
      })
    }

    return Array.from(map.values()).sort((a, b) =>
      a.name.localeCompare(b.name, 'cs', { sensitivity: 'base' })
    )
  }, [clientSuggestions, job])

  const companyInputRef = useRef<HTMLInputElement>(null)

  const [companyName, setCompanyName] = useState(job?.company_name ?? '')
  const [selectedClientId, setSelectedClientId] = useState(job?.client_id ?? '')
  const [selectedContactId, setSelectedContactId] = useState(job?.client_contact_id ?? '')
  const [contactPerson, setContactPerson] = useState(job?.contact_person ?? '')
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

  const title = 'Nová zakázka'
  const submitLabel = 'ULOŽIT ZAKÁZKU'

  useBodyScrollLock(true)

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
      return ''
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

  const modalContent = (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto bg-zinc-950/38 p-4 backdrop-blur-[5px] lg:backdrop-blur-[6px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="flex min-h-full items-start justify-center py-4 sm:items-center sm:py-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
      >
        <div
          className="relative flex w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]"
          style={{
            maxHeight:
              'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
          }}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                {title}
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-zinc-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_14px_28px_rgba(39,39,42,0.18)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="client_id" value={selectedClientId} />
            <input type="hidden" name="client_contact_id" value={selectedContactId} />
            <input
              type="hidden"
              name="company_name"
              value={companySelectionIsValid ? companyName.trim() : ''}
            />

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
              <div className="grid gap-4 xl:grid-cols-[1.15fr_0.95fr_0.9fr]">
                <section className="overflow-hidden rounded-2xl border border-white/65 bg-[linear-gradient(165deg,rgba(255,255,255,0.84)_0%,rgba(250,252,254,0.76)_48%,rgba(246,249,252,0.70)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_8px_20px_rgba(148,163,184,0.1)] sm:overflow-visible">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Základ zakázky
                    </h3>
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
                        className={`h-10 w-full rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition focus:ring-2 ${
                          showCompanyError
                            ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                            : companySelectionIsValid && !companyHasFocus
                              ? 'border-emerald-300 focus:border-emerald-300 focus:ring-emerald-100'
                              : 'focus:border-[#c2cfdd] focus:ring-[#dbe5ef]'
                        }`}
                      />

                      <div className="mt-2 rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)]">
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
                          Pro založení zakázky musíš zadat existující firmu ze seznamu klientů.
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
                            className="h-10 w-full rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition focus:border-[#c2cfdd] focus:ring-2 focus:ring-[#dbe5ef]"
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
                          className="h-10 w-full rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition placeholder:text-gray-400 focus:border-[#c2cfdd] focus:ring-2 focus:ring-[#dbe5ef]"
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
                        defaultValue={job?.sales_owner ?? 'JIŘÍ'}
                        className="h-10 w-full appearance-none rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition focus:border-[#c2cfdd] focus:ring-2 focus:ring-[#dbe5ef]"
                      >
                        <option value="JIŘÍ">JIŘÍ</option>
                        <option value="MICHAL">MICHAL</option>
                        <option value="LÍDA">LÍDA</option>
                      </select>
                    </div>
                  </div>
                </section>

                <section className="overflow-hidden rounded-2xl border border-white/65 bg-[linear-gradient(165deg,rgba(255,255,255,0.84)_0%,rgba(250,252,254,0.76)_48%,rgba(246,249,252,0.70)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_8px_20px_rgba(148,163,184,0.1)] sm:overflow-visible">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Termín a místo
                    </h3>
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
                        defaultValue={toDateTimeLocalValue(job?.start_at)}
                        className="h-10 w-full min-w-0 max-w-full appearance-none rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition focus:border-[#c2cfdd] focus:ring-2 focus:ring-[#dbe5ef]"
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
                        defaultValue={toDateTimeLocalValue(job?.end_at)}
                        className="h-10 w-full min-w-0 max-w-full appearance-none rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition focus:border-[#c2cfdd] focus:ring-2 focus:ring-[#dbe5ef]"
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
                        className="h-10 w-full rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition placeholder:text-gray-400 focus:border-[#c2cfdd] focus:ring-2 focus:ring-[#dbe5ef]"
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
                        className="h-10 w-full rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition placeholder:text-gray-400 focus:border-[#c2cfdd] focus:ring-2 focus:ring-[#dbe5ef]"
                      />
                    </div>
                  </div>
                </section>

                <section className="rounded-2xl border border-white/65 bg-[linear-gradient(165deg,rgba(255,255,255,0.84)_0%,rgba(250,252,254,0.76)_48%,rgba(246,249,252,0.70)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.84),0_8px_20px_rgba(148,163,184,0.1)]">
                  <div className="mb-3">
                    <h3 className="text-sm font-semibold text-gray-900">
                      Realizace
                    </h3>
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
                        className="h-10 w-full rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition placeholder:text-gray-400 focus:border-[#c2cfdd] focus:ring-2 focus:ring-[#dbe5ef]"
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
                        className="h-10 w-full rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition placeholder:text-gray-400 focus:border-[#c2cfdd] focus:ring-2 focus:ring-[#dbe5ef]"
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
                        className="w-full resize-none rounded-xl border border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] px-3 py-2.5 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] transition placeholder:text-gray-400 focus:border-[#c2cfdd] focus:ring-2 focus:ring-[#dbe5ef]"
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

            <MobileModalActions
              onCancel={onClose}
              submitLabel={submitLabel}
              pendingSubmitLabel="UKLÁDÁM..."
              submitDisabled={!companySelectionIsValid}
              disableAmbientGlow
            />
          </form>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
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
