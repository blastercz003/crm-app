'use client'

import { useActionState, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  createOfferModalAction,
  type OfferFormActionState,
} from './actions'
import { MobileModalActions } from '@/components/ui/mobile-modal-actions'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'

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

type NewOfferButtonProps = {
  clients: ClientOption[]
  contacts?: ClientContactOption[]
  className?: string
}

const initialState: OfferFormActionState = {
  success: false,
  error: null,
}

const glassInputClass =
  'h-10 w-full rounded-xl border border-zinc-200/80 bg-[linear-gradient(160deg,rgba(255,255,255,0.99)_0%,rgba(255,255,255,0.95)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

const glassSelectClass = `${glassInputClass} appearance-none bg-no-repeat pr-10`

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ')
    .trim()
}

export function NewOfferButton({
  clients,
  contacts = [],
  className,
}: NewOfferButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)

  function openModal() {
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={
          `${className ??
            'inline-flex items-center justify-center rounded-2xl border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_26px_rgba(9,48,82,0.32)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-[#1f5f8e] hover:bg-[linear-gradient(160deg,rgba(56,125,177,0.95)_0%,rgba(37,109,163,0.96)_45%,rgba(22,86,138,0.98)_100%)]'}`
        }
      >
        NOVÁ NABÍDKA
      </button>

      {isOpen ? (
        <NewOfferModal
          key={formKey}
          clients={clients}
          contacts={contacts}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  )
}

export function NewOfferModal({
  clients,
  contacts,
  onClose,
}: {
  clients: ClientOption[]
  contacts: ClientContactOption[]
  onClose: () => void
}) {
  const router = useRouter()
  const [state, formAction] = useActionState(createOfferModalAction, initialState)
  const [companyName, setCompanyName] = useState('')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedContactId, setSelectedContactId] = useState('')
  const [contactPerson, setContactPerson] = useState('')
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
      clients.find(
        (client) => normalizeSearchText(client.name) === normalizedValue
      ) ?? null

    if (exactMatch) {
      setCompanyName(exactMatch.name)
      setSelectedClientId(exactMatch.id)
      setSelectedContactId('')
      setContactPerson('')
      return
    }

    setCompanyName(nextRawValue)
    setSelectedClientId('')
    setSelectedContactId('')
    setContactPerson('')
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
      clients.find(
        (client) => normalizeSearchText(client.name) === normalizedValue
      ) ?? null

    if (exactMatch) {
      setCompanyName(exactMatch.name)
      setSelectedClientId(exactMatch.id)
      setSelectedContactId('')
      setContactPerson('')
    }
  }

  function handleContactChange(nextContactId: string) {
    setSelectedContactId(nextContactId)

    const nextContact =
      selectedClientContacts.find((contact) => contact.id === nextContactId) ?? null

    setContactPerson(nextContact?.name ?? '')
  }

  const suggestions =
    companyHasFocus && companyName.trim()
      ? clients
          .filter((client) =>
            normalizeSearchText(client.name).includes(
              normalizeSearchText(companyName)
            )
          )
          .slice(0, 6)
      : []

  useBodyScrollLock(true)

  useEffect(() => {
    if (state.success && state.offerId) {
      onClose()
      router.push(`/offers/${state.offerId}`)
    }
  }, [onClose, router, state.offerId, state.success])

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
          className="relative flex w-full max-w-3xl flex-col overflow-hidden rounded-[30px] border border-zinc-200/86 bg-[linear-gradient(160deg,rgba(255,255,255,0.9)_0%,rgba(244,248,252,0.82)_55%,rgba(236,243,249,0.74)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_36px_84px_rgba(24,24,27,0.32)]"
          style={{
            maxHeight:
              'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
          }}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/70 px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                NOVÁ NABÍDKA
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.84)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(15,23,42,0.14)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            <div className="grid gap-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Typ nabídky
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex min-h-[46px] cursor-pointer items-center gap-3 rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-4 py-3 text-sm text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition hover:border-[#b9d8ef]">
                    <input
                      type="radio"
                      name="offer_type"
                      value="classic"
                      defaultChecked
                      className="h-4 w-4 accent-[#2980B9]"
                    />
                    <span className="text-base font-semibold uppercase text-gray-900">KLASICKÁ</span>
                  </label>
                  <label className="flex min-h-[46px] cursor-pointer items-center gap-3 rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-4 py-3 text-sm text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition hover:border-[#b9d8ef]">
                    <input
                      type="radio"
                      name="offer_type"
                      value="bsafe24"
                      className="h-4 w-4 accent-[#2980B9]"
                    />
                    <span className="text-base font-semibold uppercase text-gray-900">B-SAFE 24</span>
                  </label>
                </div>
              </div>

              <div>
                <label
                  htmlFor="title"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Název nabídky
                </label>
                <input
                  id="title"
                  name="title"
                  required
                  placeholder="Např. Pronájem DA 250kVA / 200kW"
                  className={glassInputClass}
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-gray-700">
                  Klient
                </label>
                <input type="hidden" name="client_id" value={selectedClientId} />
                <div className="relative">
                  <input
                    value={companyName}
                    onChange={(event) => handleCompanyChange(event.target.value)}
                    onFocus={() => setCompanyHasFocus(true)}
                    onBlur={handleCompanyBlur}
                    placeholder="Začni psát název klienta"
                    className={[
                      glassInputClass,
                      showCompanyError
                        ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                        : '',
                    ].join(' ')}
                  />

                  {suggestions.length > 0 ? (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.97)_0%,rgba(243,248,252,0.94)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_20px_36px_rgba(15,23,42,0.16)]">
                      {suggestions.map((client) => (
                        <button
                          key={client.id}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault()
                            setCompanyName(client.name)
                            setSelectedClientId(client.id)
                            setSelectedContactId('')
                            setContactPerson('')
                            setCompanyTouched(true)
                            setCompanyHasFocus(false)
                          }}
                          className="block w-full px-4 py-2.5 text-left text-sm text-gray-700 transition hover:bg-[#eef6fd]"
                        >
                          {client.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {showCompanyError ? (
                  <p className="mt-2 text-xs text-red-600">
                    Vyber klienta z databáze.
                  </p>
                ) : null}
              </div>

              <div>
                <label
                  htmlFor="contact_person"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Kontaktní osoba
                </label>
                <input type="hidden" name="client_contact_id" value={selectedContactId} />
                {selectedClientContacts.length > 0 ? (
                  <>
                    <select
                      id="client_contact_select"
                      value={selectedContactId}
                      onChange={(event) => handleContactChange(event.target.value)}
                      className={glassSelectClass}
                      style={{
                        backgroundImage:
                          "url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2020%2020'%20fill='none'%20stroke='%23111827'%20stroke-width='2.2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M6%208l4%204%204-4'/%3E%3C/svg%3E\")",
                        backgroundPosition: 'right 0.95rem center',
                        backgroundSize: '16px 16px',
                      }}
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
                    value={contactPerson}
                    onChange={(event) => setContactPerson(event.target.value)}
                    placeholder="Kontaktní osoba zákazníka"
                    className={glassInputClass}
                  />
                )}
              </div>

              <div>
                <label
                  htmlFor="realization_address"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Adresa realizace
                </label>
                <input
                  id="realization_address"
                  name="realization_address"
                  placeholder="Místo realizace"
                  className={glassInputClass}
                />
              </div>

              {state.error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(127,29,29,0.10)]">
                  {state.error}
                </div>
              ) : null}
            </div>

            </div>

            <div className="shrink-0">
              <MobileModalActions
                onCancel={onClose}
                submitLabel="VYTVOŘIT NABÍDKU"
                pendingSubmitLabel="VYTVÁŘÍM NABÍDKU..."
                submitDisabled={!companySelectionIsValid}
                visualStyle="blaster"
                disableAmbientGlow
              />
            </div>
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
