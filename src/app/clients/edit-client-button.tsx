'use client'

import { useActionState, useEffect, useState } from 'react'
import {
  deleteClientRecord,
  updateClientModalAction,
  type UpdateClientActionState,
} from './actions'

type EditClientButtonProps = {
  client: {
    id: string
    name: string
    ico: string | null
    contact_person: string | null
    contact_phone: string | null
    contact_email: string | null
    address: string | null
    note: string | null
  }
  className?: string
  label?: string
  canDeleteClient?: boolean
}

const initialUpdateState: UpdateClientActionState = {
  success: false,
  error: null,
}

export function EditClientButton({
  client,
  className,
  label = 'UPRAVIT',
  canDeleteClient = false,
}: EditClientButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)

  function openModal() {
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  function closeModal() {
    setIsOpen(false)
  }

  const resolvedClassName =
    className ??
    'inline-flex items-center justify-center rounded-xl bg-gray-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-gray-800'

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={resolvedClassName}
      >
        {label}
      </button>

      {isOpen ? (
        <EditClientModal
          key={formKey}
          client={client}
          canDeleteClient={canDeleteClient}
          onClose={closeModal}
        />
      ) : null}
    </>
  )
}

function EditClientModal({
  client,
  canDeleteClient,
  onClose,
}: {
  client: EditClientButtonProps['client']
  canDeleteClient: boolean
  onClose: () => void
}) {
  const [state, formAction] = useActionState(
    updateClientModalAction,
    initialUpdateState
  )

  useEffect(() => {
    if (state.success) {
      onClose()
    }
  }, [onClose, state.success])

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
                Upravit klienta
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Uprav údaje o klientovi v databázi.
              </p>
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

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="id" value={client.id} />

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor={`edit-name-${client.id}`}
                    className="text-sm font-medium text-gray-900"
                  >
                    Název firmy *
                  </label>
                  <input
                    id={`edit-name-${client.id}`}
                    name="name"
                    type="text"
                    required
                    defaultValue={client.name}
                    placeholder="Např. ABC Stavby s.r.o."
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor={`edit-ico-${client.id}`}
                    className="text-sm font-medium text-gray-900"
                  >
                    IČO
                  </label>
                  <input
                    id={`edit-ico-${client.id}`}
                    name="ico"
                    type="text"
                    defaultValue={client.ico ?? ''}
                    placeholder="Např. 12345678"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor={`edit-contact-person-${client.id}`}
                    className="text-sm font-medium text-gray-900"
                  >
                    Kontaktní osoba
                  </label>
                  <input
                    id={`edit-contact-person-${client.id}`}
                    name="contact_person"
                    type="text"
                    defaultValue={client.contact_person ?? ''}
                    placeholder="Např. Jan Novák"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor={`edit-contact-phone-${client.id}`}
                    className="text-sm font-medium text-gray-900"
                  >
                    Telefon
                  </label>
                  <input
                    id={`edit-contact-phone-${client.id}`}
                    name="contact_phone"
                    type="text"
                    defaultValue={client.contact_phone ?? ''}
                    placeholder="Např. +420 777 123 456"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor={`edit-contact-email-${client.id}`}
                    className="text-sm font-medium text-gray-900"
                  >
                    E-mail
                  </label>
                  <input
                    id={`edit-contact-email-${client.id}`}
                    name="contact_email"
                    type="email"
                    defaultValue={client.contact_email ?? ''}
                    placeholder="Např. novak@firma.cz"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor={`edit-address-${client.id}`}
                    className="text-sm font-medium text-gray-900"
                  >
                    Adresa
                  </label>
                  <input
                    id={`edit-address-${client.id}`}
                    name="address"
                    type="text"
                    defaultValue={client.address ?? ''}
                    placeholder="Např. Ulice 123, 110 00 Praha"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor={`edit-note-${client.id}`}
                    className="text-sm font-medium text-gray-900"
                  >
                    Poznámka
                  </label>
                  <textarea
                    id={`edit-note-${client.id}`}
                    name="note"
                    rows={5}
                    defaultValue={client.note ?? ''}
                    placeholder="Doplňující informace o klientovi, preferencích nebo spolupráci."
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>
              </div>

              {state.error ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {state.error}
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
              {canDeleteClient ? (
                <button
                  type="submit"
                  formAction={deleteClientRecord}
                  className="inline-flex items-center justify-center rounded-2xl border border-red-300 bg-white px-4 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-50"
                >
                  SMAZAT KLIENTA
                </button>
              ) : (
                <div className="hidden sm:block" />
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  ZRUŠIT
                </button>

                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
                >
                  ULOŽIT ZMĚNY
                </button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
