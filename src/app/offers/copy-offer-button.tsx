'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import {
  duplicateOfferModalAction,
  type OfferFormActionState,
} from './actions'
import { MobileModalActions } from '@/components/ui/mobile-modal-actions'
import { ModalHeading } from '@/components/ui/modal-heading'

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

type CopyOfferButtonProps = {
  offerId: string
  offerNumber: string
  clients: ClientOption[]
  contacts: ClientContactOption[]
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

export function CopyOfferButton({
  offerId,
  offerNumber,
  clients,
  contacts,
  className,
}: CopyOfferButtonProps) {
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
          'inline-flex h-8 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-[11px] font-bold uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_16px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px]'
        }
      >
        KOPIE
      </button>

      {isOpen ? (
        <CopyOfferModal
          key={formKey}
          offerId={offerId}
          offerNumber={offerNumber}
          clients={clients}
          contacts={contacts}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  )
}

function CopyOfferModal({
  offerId,
  offerNumber,
  clients,
  contacts,
  onClose,
}: {
  offerId: string
  offerNumber: string
  clients: ClientOption[]
  contacts: ClientContactOption[]
  onClose: () => void
}) {
  const router = useRouter()
  const [state, formAction] = useActionState(
    duplicateOfferModalAction,
    initialState
  )
  const [isMounted] = useState(() => typeof window !== 'undefined')
  const [companyName, setCompanyName] = useState('')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedContactId, setSelectedContactId] = useState('')
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

  function resetClientSelection() {
    setSelectedClientId('')
    setSelectedContactId('')
  }

  function selectClient(client: ClientOption) {
    setCompanyName(client.name)
    setSelectedClientId(client.id)
    setSelectedContactId('')
    setCompanyTouched(true)
    setCompanyHasFocus(false)
  }

  function handleCompanyChange(nextRawValue: string) {
    setCompanyTouched(true)

    const trimmedValue = nextRawValue.trim()
    const normalizedValue = normalizeSearchText(trimmedValue)

    if (!trimmedValue) {
      setCompanyName('')
      resetClientSelection()
      return
    }

    const exactMatch =
      clients.find(
        (client) => normalizeSearchText(client.name) === normalizedValue
      ) ?? null

    if (exactMatch) {
      selectClient(exactMatch)
      return
    }

    setCompanyName(nextRawValue)
    resetClientSelection()
  }

  function handleCompanyBlur() {
    setCompanyHasFocus(false)
    setCompanyTouched(true)

    const trimmedValue = companyName.trim()
    const normalizedValue = normalizeSearchText(trimmedValue)

    if (!trimmedValue) {
      setCompanyName('')
      resetClientSelection()
      return
    }

    const exactMatch =
      clients.find(
        (client) => normalizeSearchText(client.name) === normalizedValue
      ) ?? null

    if (exactMatch) {
      selectClient(exactMatch)
    }
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

  useEffect(() => {
    if (state.success && state.offerId) {
      onClose()
      router.push(`/offers/${state.offerId}`)
    }
  }, [onClose, router, state.offerId, state.success])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  if (!isMounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[100] overflow-y-auto bg-zinc-950/38 p-3 backdrop-blur-[5px] lg:backdrop-blur-[6px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex min-h-full items-start justify-center py-3 sm:items-center sm:py-4">
        <div className="clients-modal__shell relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[30px] border border-zinc-200/86 bg-[linear-gradient(160deg,rgba(255,255,255,0.9)_0%,rgba(244,248,252,0.82)_55%,rgba(236,243,249,0.74)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_30px_72px_rgba(24,24,27,0.28)] sm:max-h-[calc(100dvh-2rem)] lg:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_36px_84px_rgba(24,24,27,0.32)]">
          <div aria-hidden className="clients-modal__shell-frame pointer-events-none absolute inset-0 rounded-[30px] border border-white/65" />
          <div aria-hidden className="clients-modal__shell-sheen pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-95" />
          <div aria-hidden className="clients-modal__shell-halo pointer-events-none absolute inset-x-10 top-1 h-10 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.72),transparent_70%)]" />
          <div className="clients-modal__header flex shrink-0 items-start justify-between gap-4 border-b border-white/70 px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <ModalHeading section="NABÍDKY" title="Kopie nabídky" />
              <p className="clients-modal__subtitle mt-1 text-sm text-gray-500">
                Vytvoř novou nabídku podle {offerNumber}.
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="clients-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,250,0.84)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(15,23,42,0.14)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <div className="clients-modal__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 [-webkit-overflow-scrolling:touch] sm:px-5">
            <input type="hidden" name="offer_id" value={offerId} />

            <div className="grid gap-4">
              <div>
                <label
                  htmlFor="copy_offer_title"
                  className="clients-modal__label mb-2 block text-sm font-medium text-gray-700"
                >
                  Název nabídky
                </label>
                <input
                  id="copy_offer_title"
                  name="title"
                  required
                  placeholder="Např. Pronájem DA 250kVA / 200kW"
                  className="clients-modal__input w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-4 py-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                />
              </div>

              <div>
                <label
                  htmlFor="copy_offer_client"
                  className="clients-modal__label mb-2 block text-sm font-medium text-gray-700"
                >
                  Klient
                </label>
                <input type="hidden" name="client_id" value={selectedClientId} />
                <div className="relative">
                  <input
                    id="copy_offer_client"
                    value={companyName}
                    onChange={(event) => handleCompanyChange(event.target.value)}
                    onFocus={() => setCompanyHasFocus(true)}
                    onBlur={handleCompanyBlur}
                    placeholder="Začni psát název klienta"
                    aria-autocomplete="list"
                    className={[
                      'clients-modal__input w-full rounded-xl border bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-4 py-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:ring-2',
                      showCompanyError
                        ? 'border-red-300 focus:border-red-300 focus:ring-red-100'
                        : 'border-white/75 focus:border-[#9dc7e5] focus:ring-[#b9d8ef]',
                    ].join(' ')}
                  />

                  {suggestions.length > 0 ? (
                    <div className="offers-page__copy-modal__suggestions absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.97)_0%,rgba(243,248,252,0.94)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_20px_36px_rgba(15,23,42,0.16)]">
                      {suggestions.map((client) => (
                        <button
                          key={client.id}
                          type="button"
                          onMouseDown={(event) => {
                            event.preventDefault()
                            selectClient(client)
                          }}
                          className="offers-page__copy-modal__suggestion block w-full px-4 py-2.5 text-left text-sm text-gray-700 transition hover:bg-[#eef6fd]"
                        >
                          {client.name}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                {showCompanyError ? (
                  <p className="offers-page__copy-modal__error mt-2 text-xs text-red-600">
                    Vyber klienta z databáze.
                  </p>
                ) : null}
              </div>

              <div>
                <label
                  htmlFor="copy_offer_contact"
                  className="clients-modal__label mb-2 block text-sm font-medium text-gray-700"
                >
                  Kontaktní osoba
                </label>
                <div className="relative">
                  <select
                    id="copy_offer_contact"
                    name="client_contact_id"
                    value={selectedContactId}
                    onChange={(event) => setSelectedContactId(event.target.value)}
                    disabled={!selectedClientId}
                    className="clients-modal__select offers-page__copy-modal__select h-[46px] w-full appearance-none rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] bg-no-repeat px-4 py-0 pr-10 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] disabled:cursor-not-allowed disabled:opacity-60"
                    style={{
                      backgroundImage:
                        "url(\"data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2020%2020'%20fill='none'%20stroke='%23111827'%20stroke-width='2.2'%20stroke-linecap='round'%20stroke-linejoin='round'%3E%3Cpath%20d='M6%208l4%204%204-4'/%3E%3C/svg%3E\")",
                      backgroundPosition: 'right 0.95rem center',
                      backgroundSize: '16px 16px',
                      backgroundRepeat: 'no-repeat',
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
                  <span
                    aria-hidden
                    className="offers-page__copy-modal__select-arrow pointer-events-none absolute right-[0.95rem] top-1/2 hidden h-4 w-4 -translate-y-1/2"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="copy_offer_realization_address"
                  className="clients-modal__label mb-2 block text-sm font-medium text-gray-700"
                >
                  Adresa realizace
                </label>
                <input
                  id="copy_offer_realization_address"
                  name="realization_address"
                  placeholder="Místo realizace"
                  className="clients-modal__input w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-4 py-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                />
              </div>

              {state.error ? (
                <div className="offers-page__copy-modal__form-error rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(127,29,29,0.10)]">
                  {state.error}
                </div>
              ) : null}
            </div>

            </div>

            <div className="shrink-0">
              <MobileModalActions
                onCancel={onClose}
                submitLabel="VYTVOŘIT KOPII"
                pendingSubmitLabel="VYTVÁŘÍM KOPII..."
                submitDisabled={!companySelectionIsValid}
                visualStyle="client-modal"
              />
            </div>
          </form>
        </div>
      </div>
    </div>,
    document.body
  )
}
