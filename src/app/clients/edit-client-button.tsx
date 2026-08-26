'use client'

import { useActionState, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  deleteClientRecord,
  updateClientModalAction,
  type UpdateClientActionState,
} from './actions'
import { ModalHeading } from '@/components/ui/modal-heading'
import {
  useModalActionSuccess,
  useModalMotionClose,
} from '@/components/ui/modal-motion'

export type ClientForEditing = {
  id: string
  name: string
  ico: string | null
  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null
  address: string | null
  note: string | null
}

type EditClientButtonProps = {
  client: ClientForEditing
  className?: string
  label?: string
  canDeleteClient?: boolean
}

const initialUpdateState: UpdateClientActionState = {
  success: false,
  error: null,
}

const glassInputClass =
  'clients-modal__input w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'
const clientFormPanelClass =
  'clients-form__panel rounded-[22px] border p-3.5 sm:p-4'
const clientFormPanelTitleClass =
  'clients-form__panel-title mb-3 text-[11px] font-semibold uppercase tracking-[0.18em]'

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
    'clients-page__edit-button inline-flex items-center justify-center rounded-xl bg-gray-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-gray-800'

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

export function EditClientModal({
  client,
  canDeleteClient,
  onClose: closeImmediately,
}: {
  client: ClientForEditing
  canDeleteClient: boolean
  onClose: () => void
}) {
  const onClose = useModalMotionClose(closeImmediately)
  const [state, formAction] = useActionState(
    updateClientModalAction,
    initialUpdateState
  )

  useModalActionSuccess(state.success, onClose)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const modalContent = (
    <div
      data-modal-motion-root
      className="clients-modal fixed inset-0 z-50 overflow-y-auto bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex min-h-full items-start justify-center py-0 sm:items-center sm:py-4">
        <div data-modal-motion-surface className="standard-form-modal__shell clients-modal__shell relative flex h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] sm:h-[calc(100dvh-2rem)] sm:max-h-[760px] lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]">
          <div className="standard-form-modal__header clients-modal__header flex shrink-0 items-start justify-between gap-4 border-b border-gray-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-4 py-3 sm:px-5 sm:py-4">
            <ModalHeading section="KLIENTI" title="Upravit klienta" className="min-w-0" />

            <button
              type="button"
              onClick={onClose}
              className="standard-form-modal__close clients-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),0_14px_24px_rgba(39,39,42,0.16)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="id" value={client.id} />

            <div className="clients-modal__body min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
              <div className="space-y-4">
                <section className={clientFormPanelClass}>
                  <h3 className={clientFormPanelTitleClass}>Firma</h3>
                  <div className="grid gap-3 sm:grid-cols-6">
                <div className="space-y-2 sm:col-span-6">
                  <label
                    htmlFor={`edit-name-${client.id}`}
                    className="clients-modal__label text-sm font-medium text-gray-900"
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

                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor={`edit-ico-${client.id}`}
                    className="clients-modal__label text-sm font-medium text-gray-900"
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

                <div className="space-y-2 sm:col-span-4">
                  <label
                    htmlFor={`edit-address-${client.id}`}
                    className="clients-modal__label text-sm font-medium text-gray-900"
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
                  </div>
                </section>

                <section className={clientFormPanelClass}>
                  <h3 className={clientFormPanelTitleClass}>Hlavní kontakt</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor={`edit-contact-person-${client.id}`}
                    className="clients-modal__label text-sm font-medium text-gray-900"
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
                    className="clients-modal__label text-sm font-medium text-gray-900"
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
                    className="clients-modal__label text-sm font-medium text-gray-900"
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

                  </div>
                </section>

                <section className={clientFormPanelClass}>
                  <h3 className={clientFormPanelTitleClass}>Poznámka</h3>
                <div className="space-y-2">
                  <label
                    htmlFor={`edit-note-${client.id}`}
                    className="clients-modal__label text-sm font-medium text-gray-900"
                  >
                    Poznámka
                  </label>
                  <textarea
                    id={`edit-note-${client.id}`}
                    name="note"
                    rows={4}
                    defaultValue={client.note ?? ''}
                    placeholder="Doplňující informace o klientovi, preferencích nebo spolupráci."
                    className={`${glassInputClass} min-h-[130px] resize-y sm:min-h-[140px]`}
                  />
                </div>
                </section>
              </div>

              {state.error ? (
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(127,29,29,0.10)]">
                  {state.error}
                </div>
              ) : null}
            </div>

            <div className="clients-modal__footer flex shrink-0 flex-col gap-2.5 border-t border-gray-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.68)_100%)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-5 sm:py-4">
              {canDeleteClient ? (
                <button
                  type="submit"
                  formAction={deleteClientRecord}
                  className="standard-form-modal__danger-action order-2 inline-flex items-center justify-center sm:order-1"
                >
                  SMAZAT KLIENTA
                </button>
              ) : (
                <div className="hidden sm:block" />
              )}

              <div className="order-1 grid grid-cols-2 gap-2.5 sm:order-2 sm:flex sm:gap-3 sm:justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="standard-form-modal__cancel-action inline-flex items-center justify-center"
                >
                  ZRUŠIT
                </button>

                <button
                  type="submit"
                  className="standard-form-modal__primary-action inline-flex items-center justify-center"
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
