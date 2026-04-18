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

type NewMeetingButtonProps = {
  clients: ClientOption[]
  className?: string
  label?: string
}

const initialCreateState: CreateMeetingActionState = {
  success: false,
  error: null,
}

export function NewMeetingButton({
  clients,
  className,
  label = 'NOVÁ SCHŮZKA',
}: NewMeetingButtonProps) {
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
    'inline-flex items-center justify-center rounded-2xl bg-[#2980B9] px-4 py-2.5 text-sm font-medium uppercase text-white transition hover:bg-[#236f9f]'

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
        <CreateMeetingModal
          key={formKey}
          clients={clients}
          onClose={closeModal}
        />
      ) : null}
    </>
  )
}

function CreateMeetingModal({
  clients,
  onClose,
}: {
  clients: ClientOption[]
  onClose: () => void
}) {
  const [state, formAction] = useActionState(
    createMeetingModalAction,
    initialCreateState
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
      className="fixed inset-0 z-50 overflow-y-auto bg-gray-900/45 p-3 sm:p-4"
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
              error={state.error}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
