'use client'

import { useActionState, useEffect, useState } from 'react'
import {
  createMeetingModalAction,
  type CreateMeetingActionState,
} from './actions'
import { MeetingForm } from '@/components/meetings/meeting-form'

type ClientOption = {
  id: string
  name: string
}

type ClientContactOption = {
  id: string
  client_id: string
  name: string
  phone: string | null
  email: string | null
  is_primary: boolean
}

type NewMeetingButtonProps = {
  clients: ClientOption[]
  contacts?: ClientContactOption[]
  className?: string
  label?: string
}

const initialCreateState: CreateMeetingActionState = {
  success: false,
  error: null,
}

export function NewMeetingButton({
  clients,
  contacts = [],
  className,
  label = 'NOVÁ SCHŮZKA',
}: NewMeetingButtonProps) {
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
        <CreateMeetingModal
          key={formKey}
          clients={clients}
          contacts={contacts}
          onClose={closeModal}
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

function CreateMeetingModal({
  clients,
  contacts,
  onClose,
  onToast,
}: {
  clients: ClientOption[]
  contacts: ClientContactOption[]
  onClose: () => void
  onToast: (toast: { type: 'success' | 'error'; message: string }) => void
}) {
  const [state, formAction] = useActionState(
    createMeetingModalAction,
    initialCreateState
  )

  useEffect(() => {
    if (state.success) {
      onToast({
        type: 'success',
        message: 'Schůzka byla vytvořena.',
      })
      onClose()
    }
  }, [onClose, onToast, state.success])

  useEffect(() => {
    if (!state.error) return

    onToast({
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
        <div className="flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                Nová schůzka
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Naplánuj schůzku a případně ji napoj na klienta z databáze.
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

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
            <MeetingForm
              action={formAction}
              submitLabel="ULOŽIT SCHŮZKU"
              onCancel={onClose}
              cancelLabel="ZRUŠIT"
              clients={clients}
              contacts={contacts}
              error={state.error}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
