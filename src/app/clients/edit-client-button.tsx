'use client'

import { useActionState, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
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

const glassInputClass =
  'w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

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

  const modalContent = (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex min-h-full items-start justify-center py-3 sm:items-center sm:py-4">
        <div className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] sm:max-h-[calc(100dvh-2rem)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 rounded-3xl border border-white/65"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-95"
          />
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                Upravit klienta
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),0_14px_24px_rgba(39,39,42,0.16)]"
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
                    className={glassInputClass}
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
                    className={glassInputClass}
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
                    className={glassInputClass}
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
                    className={glassInputClass}
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
                    className={glassInputClass}
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
                    className={glassInputClass}
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
                    className={glassInputClass}
                  />
                </div>
              </div>

              {state.error ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(127,29,29,0.10)]">
                  {state.error}
                </div>
              ) : null}
            </div>

            <div className="flex shrink-0 flex-col gap-3 border-t border-gray-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.68)_100%)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4">
              {canDeleteClient ? (
                <button
                  type="submit"
                  formAction={deleteClientRecord}
                  className="inline-flex items-center justify-center rounded-2xl border border-red-300 bg-white/95 px-4 py-2.5 text-sm font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(127,29,29,0.10)] transition duration-200 ease-out hover:-translate-y-[1px] hover:bg-red-50"
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
                  className="inline-flex items-center justify-center rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 py-2.5 text-sm font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(185,28,28,0.2)]"
                >
                  ZRUŠIT
                </button>

                <button
                  type="submit"
                  className="inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)]"
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

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
}
