'use client'

import { useActionState, useEffect, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { createClientModalAction, type CreateClientActionState } from './actions'
import { MobileModalActions } from '@/components/ui/mobile-modal-actions'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'

type NewClientButtonProps = {
  className?: string
  label?: string
}

type ClientToast = {
  type: 'success' | 'error'
  message: string
}

const initialCreateState: CreateClientActionState = {
  success: false,
  error: null,
}

export function NewClientButton({
  className,
  label = 'NOVÝ KLIENT',
}: NewClientButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [toast, setToast] = useState<ClientToast | null>(null)

  function openModal() {
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  function closeModal() {
    setIsOpen(false)
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
    'inline-flex items-center justify-center rounded-2xl bg-[#2980B9] px-4 py-2.5 text-sm font-medium uppercase text-white transition hover:bg-[#236f9f]'

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={`${resolvedClassName} primary-ambient-glow--blue`}
      >
        {label}
      </button>

      {isOpen ? (
        <CreateClientModal key={formKey} onClose={closeModal} onToast={setToast} />
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

export function CreateClientModal({
  onClose,
  onToast,
  onSuccess,
  suppressSuccessToast = false,
}: {
  onClose: () => void
  onToast: (toast: ClientToast) => void
  onSuccess?: (state: CreateClientActionState) => void
  suppressSuccessToast?: boolean
}) {
  const [state, formAction] = useActionState(
    createClientModalAction,
    initialCreateState
  )

  useBodyScrollLock(true)

  useEffect(() => {
    if (state.success) {
      onSuccess?.(state)
      if (!suppressSuccessToast) {
        onToast({
          type: 'success',
          message: 'Klient byl vytvořen.',
        })
      }
      onClose()
    }
  }, [onClose, onSuccess, onToast, state, suppressSuccessToast])

  useEffect(() => {
    if (!state.error) return

    onToast({
      type: 'error',
      message: state.error,
    })
  }, [onToast, state.error])

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
                Nový klient
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Přidej novou firmu do databáze klientů.
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
            <PendingFormLock message="Ukládám klienta, čekej prosím..." />
            <PendingFieldset className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor="name"
                    className="text-sm font-medium text-gray-900"
                  >
                    Název firmy *
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    required
                    placeholder="Např. ABC Stavby s.r.o."
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="ico"
                    className="text-sm font-medium text-gray-900"
                  >
                    IČO
                  </label>
                  <input
                    id="ico"
                    name="ico"
                    type="text"
                    placeholder="Např. 12345678"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="contact_person"
                    className="text-sm font-medium text-gray-900"
                  >
                    Kontaktní osoba
                  </label>
                  <input
                    id="contact_person"
                    name="contact_person"
                    type="text"
                    placeholder="Např. Jan Novák"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="contact_phone"
                    className="text-sm font-medium text-gray-900"
                  >
                    Telefon
                  </label>
                  <input
                    id="contact_phone"
                    name="contact_phone"
                    type="text"
                    placeholder="Např. +420 777 123 456"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="contact_email"
                    className="text-sm font-medium text-gray-900"
                  >
                    E-mail
                  </label>
                  <input
                    id="contact_email"
                    name="contact_email"
                    type="email"
                    placeholder="Např. novak@firma.cz"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor="address"
                    className="text-sm font-medium text-gray-900"
                  >
                    Adresa
                  </label>
                  <input
                    id="address"
                    name="address"
                    type="text"
                    placeholder="Např. Ulice 123, 110 00 Praha"
                    className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <label
                    htmlFor="note"
                    className="text-sm font-medium text-gray-900"
                  >
                    Poznámka
                  </label>
                  <textarea
                    id="note"
                    name="note"
                    rows={5}
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

            <ClientFormActions onClose={onClose} submitLabel="ULOŽIT KLIENTA" />
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

function ClientFormActions({
  onClose,
  submitLabel,
}: {
  onClose: () => void
  submitLabel: string
}) {
  const pendingSubmitLabel =
    submitLabel.trim().length > 0 && submitLabel === submitLabel.toUpperCase()
      ? 'UKLÁDÁM...'
      : 'Ukládám...'

  return (
    <>
      <MobileModalActions
        onCancel={onClose}
        submitLabel={submitLabel}
        pendingSubmitLabel={pendingSubmitLabel}
      />
    </>
  )
}
