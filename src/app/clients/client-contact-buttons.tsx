'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  createClientContactModalAction,
  updateClientContactModalAction,
  type ClientContactActionState,
} from './actions'

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
    'inline-flex items-center justify-center rounded-2xl bg-[#2980B9] px-4 py-2.5 text-sm font-medium text-white transition hover:bg-[#236f9f]'

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
    'inline-flex items-center justify-center rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-medium text-gray-900 transition hover:bg-gray-100'

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
  onClose,
  onToast,
}: {
  mode: 'create' | 'edit'
  clientId: string
  contact?: ClientContact
  defaultPrimary?: boolean
  onClose: () => void
  onToast?: (toast: { type: 'success' | 'error'; message: string }) => void
}) {
  const [state, formAction] = useActionState(
    mode === 'create'
      ? createClientContactModalAction
      : updateClientContactModalAction,
    initialState
  )

  useEffect(() => {
    if (state.success) {
      onToast?.({
        type: 'success',
        message:
          mode === 'create'
            ? 'Kontaktní osoba byla vytvořena.'
            : 'Kontaktní osoba byla upravena.',
      })
      onClose()
    }
  }, [mode, onClose, onToast, state.success])

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
                {title}
              </h2>
              <p className="mt-1 text-sm text-gray-500">{description}</p>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              aria-label="Zavřít"
            >
              x
            </button>
          </div>

          <form action={formAction} className="flex min-h-0 flex-1 flex-col">
            <PendingFormLock message="Ukládám kontaktní osobu, čekej prosím..." />
            <PendingFieldset className="flex min-h-0 flex-1 flex-col">
            <input type="hidden" name="client_id" value={clientId} />
            {contact ? <input type="hidden" name="id" value={contact.id} /> : null}

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor={`${mode}-contact-name-${contact?.id ?? clientId}`}
                    className="text-sm font-medium text-gray-900"
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
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor={`${mode}-contact-phone-${contact?.id ?? clientId}`}
                    className="text-sm font-medium text-gray-900"
                  >
                    Telefon
                  </label>
                  <input
                    id={`${mode}-contact-phone-${contact?.id ?? clientId}`}
                    name="phone"
                    type="text"
                    defaultValue={contact?.phone ?? ''}
                    placeholder="Např. +420 777 123 456"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor={`${mode}-contact-email-${contact?.id ?? clientId}`}
                    className="text-sm font-medium text-gray-900"
                  >
                    E-mail
                  </label>
                  <input
                    id={`${mode}-contact-email-${contact?.id ?? clientId}`}
                    name="email"
                    type="email"
                    defaultValue={contact?.email ?? ''}
                    placeholder="Např. novak@firma.cz"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor={`${mode}-contact-role-${contact?.id ?? clientId}`}
                    className="text-sm font-medium text-gray-900"
                  >
                    Pozice / role
                  </label>
                  <input
                    id={`${mode}-contact-role-${contact?.id ?? clientId}`}
                    name="role"
                    type="text"
                    defaultValue={contact?.role ?? ''}
                    placeholder="Např. provozní, jednatel, nákup"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor={`${mode}-contact-note-${contact?.id ?? clientId}`}
                    className="text-sm font-medium text-gray-900"
                  >
                    Poznámka
                  </label>
                  <textarea
                    id={`${mode}-contact-note-${contact?.id ?? clientId}`}
                    name="note"
                    rows={4}
                    defaultValue={contact?.note ?? ''}
                    placeholder="Doplňující informace ke kontaktu."
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <label className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700 sm:col-span-2">
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
                <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
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
}

function PendingFormLock({ message }: { message: string }) {
  const { pending } = useFormStatus()

  if (!pending) return null

  return (
    <div className="mx-4 mt-3 rounded-2xl border border-[#2980B9]/25 bg-[#2980B9]/10 px-4 py-3 text-sm font-medium text-[#1d5f88] sm:mx-5 sm:mt-4">
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
  const { pending } = useFormStatus()

  return (
    <div
      className={`flex shrink-0 flex-col gap-3 border-t border-gray-100 px-4 py-3 sm:flex-row sm:justify-end sm:px-5 sm:py-4 ${
        pending ? 'cursor-wait' : ''
      }`}
    >
      <button
        type="button"
        onClick={onClose}
        disabled={pending}
        className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        ZRUŠIT
      </button>

      <button
        type="submit"
        disabled={pending}
        aria-busy={pending}
        className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-75"
      >
        {pending ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : null}
        {pending ? 'UKLÁDÁM...' : submitLabel}
      </button>
    </div>
  )
}
