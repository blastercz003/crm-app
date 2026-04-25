'use client'

import { useActionState, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  createOfferModalAction,
  type OfferFormActionState,
} from './actions'

type ClientOption = {
  id: string
  name: string
}

type NewOfferButtonProps = {
  clients: ClientOption[]
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

export function NewOfferButton({ clients, className }: NewOfferButtonProps) {
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
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  )
}

function NewOfferModal({
  clients,
  onClose,
}: {
  clients: ClientOption[]
  onClose: () => void
}) {
  const router = useRouter()
  const [state, formAction] = useActionState(createOfferModalAction, initialState)
  const [companyName, setCompanyName] = useState('')
  const [selectedClientId, setSelectedClientId] = useState('')
  const [companyTouched, setCompanyTouched] = useState(false)
  const [companyHasFocus, setCompanyHasFocus] = useState(false)

  const selectedClient =
    clients.find((client) => client.id === selectedClientId) ?? null

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

    setCompanyName(nextRawValue)
    setSelectedClientId('')
  }

  function handleCompanyBlur() {
    setCompanyHasFocus(false)
    setCompanyTouched(true)

    const trimmedValue = companyName.trim()
    const normalizedValue = normalizeSearchText(trimmedValue)

    if (!trimmedValue) {
      setCompanyName('')
      setSelectedClientId('')
      return
    }

    const exactMatch =
      clients.find(
        (client) => normalizeSearchText(client.name) === normalizedValue
      ) ?? null

    if (exactMatch) {
      setCompanyName(exactMatch.name)
      setSelectedClientId(exactMatch.id)
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

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950/45 p-3 backdrop-blur-sm sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex min-h-full items-start justify-center py-3 sm:items-center sm:py-4">
        <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                Nová nabídka
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Založ základ nabídky. Položky a schvalování navážeš na detailu nabídky.
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

          <form action={formAction} className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
            <div className="grid gap-4">
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
                  htmlFor="title"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Název nabídky
                </label>
                <input
                  id="title"
                  name="title"
                  required
                  placeholder="Např. Cenová nabídka elektroinstalace"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                />
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

              <div>
                <label
                  htmlFor="contact_person"
                  className="mb-2 block text-sm font-medium text-gray-700"
                >
                  Kontaktní osoba
                </label>
                <input
                  id="contact_person"
                  name="contact_person"
                  placeholder="Kontaktní osoba zákazníka"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                />
              </div>


              {state.error ? (
                <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {state.error}
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-gray-100 pt-4">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-10 items-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                ZRUŠIT
              </button>
              <button
                type="submit"
                disabled={!companySelectionIsValid}
                className="inline-flex min-h-10 items-center rounded-xl bg-[#2980B9] px-4 text-sm font-medium text-white transition hover:bg-[#236f9f] disabled:cursor-not-allowed disabled:opacity-60"
              >
                VYTVOŘIT NABÍDKU
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
