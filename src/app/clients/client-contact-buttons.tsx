'use client'

import { useActionState, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFormStatus } from 'react-dom'
import {
  createClientContactModalAction,
  updateClientContactModalAction,
  type ClientContactActionState,
} from './actions'
import { MobileModalActions } from '@/components/ui/mobile-modal-actions'
import { ModalHeading } from '@/components/ui/modal-heading'
import {
  useModalActionSuccess,
  useModalMotionClose,
} from '@/components/ui/modal-motion'

type ClientContact = {
  id: string
  client_id: string
  name: string
  phone: string | null
  email: string | null
  role: string | null
  note: string | null
  is_primary: boolean
}

type NewClientContactButtonProps = {
  clientId: string
  hasContacts: boolean
  className?: string
  label?: string
}

type EditClientContactButtonProps = {
  contact: ClientContact
  className?: string
  label?: string
}

const initialState: ClientContactActionState = {
  success: false,
  error: null,
}

const glassInputClass =
  'clients-modal__input w-full rounded-2xl border border-gray-200 bg-white/96 px-4 py-3 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]'

export function NewClientContactButton({
  clientId,
  hasContacts,
  className,
  label = 'PŘIDAT OSOBU',
}: NewClientContactButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [toast, setToast] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  function openModal() {
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  useEffect(() => {
    if (!toast) return

    const timeoutId = window.setTimeout(() => {
      setToast(null)
    }, 3200)

    return () => window.clearTimeout(timeoutId)
  }, [toast])

  const resolvedClassName =
    className ??
    'clients-page__contact-add-button inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)]'

  return (
    <>
      <button type="button" onClick={openModal} className={resolvedClassName}>
        {label}
      </button>

      {isOpen ? (
        <ClientContactModal
          key={formKey}
          mode="create"
          clientId={clientId}
          defaultPrimary={!hasContacts}
          onClose={() => setIsOpen(false)}
          onToast={setToast}
        />
      ) : null}

      {toast ? (
        <div className="pointer-events-none fixed right-4 top-4 z-[60] max-w-[calc(100vw-2rem)] sm:right-6 sm:top-6 sm:max-w-sm">
          <div
            className={`rounded-2xl border px-4 py-3 text-sm font-medium shadow-lg ${
              toast.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
            role="status"
            aria-live="polite"
          >
            {toast.message}
          </div>
        </div>
      ) : null}
    </>
  )
}

export function EditClientContactButton({
  contact,
  className,
  label = 'UPRAVIT',
}: EditClientContactButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)

  function openModal() {
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  const resolvedClassName =
    className ??
    'clients-page__contact-edit-button inline-flex items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-3 py-2 text-xs font-medium text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]'

  return (
    <>
      <button type="button" onClick={openModal} className={resolvedClassName}>
        {label}
      </button>

      {isOpen ? (
        <ClientContactModal
          key={formKey}
          mode="edit"
          clientId={contact.client_id}
          contact={contact}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  )
}

function ClientContactModal({
  mode,
  clientId,
  contact,
  defaultPrimary = false,
  onClose: closeImmediately,
  onToast,
}: {
  mode: 'create' | 'edit'
  clientId: string
  contact?: ClientContact
  defaultPrimary?: boolean
  onClose: () => void
  onToast?: (toast: { type: 'success' | 'error'; message: string }) => void
}) {
  const onClose = useModalMotionClose(closeImmediately)
  const [state, formAction] = useActionState(
    mode === 'create'
      ? createClientContactModalAction
      : updateClientContactModalAction,
    initialState
  )

  useModalActionSuccess(state.success, () => {
    onToast?.({
      type: 'success',
      message:
        mode === 'create'
          ? 'Kontaktní osoba byla vytvořena.'
          : 'Kontaktní osoba byla upravena.',
    })
    onClose()
  })

  useEffect(() => {
    if (!state.error) return

    onToast?.({
      type: 'error',
      message: state.error,
    })
  }, [onToast, state.error])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const title = mode === 'create' ? 'Nová kontaktní osoba' : 'Upravit osobu'
  const description =
    mode === 'create'
      ? 'Přidej další osobu k této firmě.'
      : 'Uprav údaje kontaktní osoby.'
  const submitLabel = mode === 'create' ? 'ULOŽIT OSOBU' : 'ULOŽIT ZMĚNY'

  const modalContent = (
    <div
      data-modal-motion-root
      className="clients-modal fixed inset-0 z-[100] overflow-y-auto overscroll-contain bg-zinc-950/38 p-4 [-webkit-overflow-scrolling:touch] backdrop-blur-[5px] lg:backdrop-blur-[6px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        className="flex min-h-[calc(100dvh-2rem)] items-start justify-center py-2 sm:min-h-full sm:items-center sm:py-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1rem)' }}
      >
        <div data-modal-motion-surface className="clients-modal__shell relative flex h-[calc(100dvh-1rem)] min-h-0 w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] sm:h-auto sm:max-h-[calc(100dvh-2rem)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]">
          <div className="clients-modal__header flex shrink-0 items-start justify-between gap-4 border-b border-gray-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <ModalHeading section="KLIENTI" title={title} />
              <p className="clients-modal__subtitle mt-1 text-sm text-gray-500">{description}</p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="clients-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),0_14px_24px_rgba(39,39,42,0.16)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <PendingFormLock message="Ukládám kontaktní osobu, čekej prosím..." />
            <PendingFieldset className="flex min-h-0 flex-1 flex-col">
              <input type="hidden" name="client_id" value={clientId} />
              {contact ? <input type="hidden" name="id" value={contact.id} /> : null}

              <div className="clients-modal__body min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <label
                      htmlFor={`${mode}-contact-name-${contact?.id ?? clientId}`}
                      className="clients-modal__label text-sm font-medium text-gray-900"
                    >
                      Jméno osoby *
                    </label>
                    <input
                      id={`${mode}-contact-name-${contact?.id ?? clientId}`}
                      name="name"
                      type="text"
                      required
                      defaultValue={contact?.name ?? ''}
                      placeholder="Např. Jan Novák"
                      className={glassInputClass}
                    />
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor={`${mode}-contact-phone-${contact?.id ?? clientId}`}
                      className="clients-modal__label text-sm font-medium text-gray-900"
                    >
                      Telefon
                    </label>
                    <input
                      id={`${mode}-contact-phone-${contact?.id ?? clientId}`}
                      name="phone"
                      type="text"
                      defaultValue={contact?.phone ?? ''}
                      placeholder="Např. +420 777 123 456"
                      className={glassInputClass}
                    />
                  </div>

                  <div className="space-y-2">
                    <label
                      htmlFor={`${mode}-contact-email-${contact?.id ?? clientId}`}
                      className="clients-modal__label text-sm font-medium text-gray-900"
                    >
                      E-mail
                    </label>
                    <input
                      id={`${mode}-contact-email-${contact?.id ?? clientId}`}
                      name="email"
                      type="email"
                      defaultValue={contact?.email ?? ''}
                      placeholder="Např. novak@firma.cz"
                      className={glassInputClass}
                    />
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <label
                      htmlFor={`${mode}-contact-role-${contact?.id ?? clientId}`}
                      className="clients-modal__label text-sm font-medium text-gray-900"
                    >
                      Pozice / role
                    </label>
                    <input
                      id={`${mode}-contact-role-${contact?.id ?? clientId}`}
                      name="role"
                      type="text"
                      defaultValue={contact?.role ?? ''}
                      placeholder="Např. provozní, jednatel, nákup"
                      className={glassInputClass}
                    />
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <label
                      htmlFor={`${mode}-contact-note-${contact?.id ?? clientId}`}
                      className="clients-modal__label text-sm font-medium text-gray-900"
                    >
                      Poznámka
                    </label>
                    <textarea
                      id={`${mode}-contact-note-${contact?.id ?? clientId}`}
                      name="note"
                      rows={4}
                      defaultValue={contact?.note ?? ''}
                      placeholder="Doplňující informace ke kontaktu."
                      className={glassInputClass}
                    />
                  </div>

                  <label className="clients-modal__primary-toggle flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50/90 px-4 py-3 text-sm text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(39,39,42,0.08)] sm:col-span-2">
                    {contact?.is_primary ? (
                      <input type="hidden" name="is_primary" value="on" />
                    ) : null}
                    <input
                      type="checkbox"
                      name="is_primary"
                      defaultChecked={contact?.is_primary ?? defaultPrimary}
                      disabled={contact?.is_primary}
                      className="h-4 w-4 accent-[#2980B9]"
                    />
                    <span>Hlavní kontakt firmy</span>
                  </label>
                </div>

                {state.error ? (
                  <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(127,29,29,0.10)]">
                    {state.error}
                  </div>
                ) : null}
              </div>

              <ContactFormActions onClose={onClose} submitLabel={submitLabel} />
            </PendingFieldset>
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

function PendingFormLock({ message }: { message: string }) {
  const { pending } = useFormStatus()

  if (!pending) return null

  return (
    <div className="clients-modal__lock mx-4 mt-3 rounded-2xl border border-[#2980B9]/25 bg-[#2980B9]/10 px-4 py-3 text-sm font-medium text-[#1d5f88] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(24,95,145,0.14)] sm:mx-5 sm:mt-4">
      {message}
    </div>
  )
}

function PendingFieldset({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  const { pending } = useFormStatus()

  return (
    <fieldset
      disabled={pending}
      className={`${className ?? ''} ${pending ? 'cursor-wait opacity-80' : ''}`}
    >
      {children}
    </fieldset>
  )
}

function ContactFormActions({
  onClose,
  submitLabel,
}: {
  onClose: () => void
  submitLabel: string
}) {
  return (
    <MobileModalActions
      onCancel={onClose}
      submitLabel={submitLabel}
      pendingSubmitLabel="UKLÁDÁM..."
      visualStyle="client-modal"
    />
  )
}
