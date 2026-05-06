'use client'

import { useActionState, useEffect, useState } from 'react'
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
          className ??
          'primary-ambient-glow--blue inline-flex items-center justify-center rounded-2xl bg-[#2980B9] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#236f9f]'
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

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950/45 p-4 backdrop-blur-sm sm:p-4"
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
          className="flex w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl"
          style={{
            maxHeight:
              'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
          }}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                NOVÁ NABÍDKA
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Vyber typ nabídky a vyplň základní data.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              aria-label="Zavřít"
            >
              ×
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
                  <label className="flex min-h-[46px] cursor-pointer items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-black transition hover:bg-gray-50">
                    <input
                      type="radio"
                      name="offer_type"
                      value="classic"
                      defaultChecked
                      className="h-4 w-4 accent-[#2980B9]"
                    />
                    <span className="text-base font-semibold uppercase text-gray-900">KLASICKÁ</span>
                  </label>
                  <label className="flex min-h-[46px] cursor-pointer items-center gap-3 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-black transition hover:bg-gray-50">
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
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
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
                      'w-full rounded-xl border bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:ring-2',
                      showCompanyError
                        ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                        : 'border-gray-200 focus:border-gray-300 focus:ring-gray-200',
                    ].join(' ')}
                  />

                  {suggestions.length > 0 ? (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-lg">
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
                          className="block w-full px-4 py-2.5 text-left text-sm text-gray-700 transition hover:bg-gray-50"
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
                      className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
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
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
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
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                />
              </div>

              {state.error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
              />
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
