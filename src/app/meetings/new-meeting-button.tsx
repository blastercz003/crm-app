'use client'

import { useActionState, useEffect, useState } from 'react'
import {
  createMeetingModalAction,
  type CreateMeetingActionState,
} from './actions'
import { MeetingForm } from '@/components/meetings/meeting-form'
import { buildErrorToast, buildMeetingCreatedToast } from '@/components/ui/action-feedback-messages'
import {
  ActionFeedbackToast,
  useAnimatedActionToast,
} from '@/components/ui/action-feedback-toast'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'

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

type MeetingToast = {
  type: 'success' | 'error'
  message: string
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
  const { toast, isVisible: isToastVisible, showToast } = useAnimatedActionToast()

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
          onToast={(nextToast) => showToast(buildErrorToast(nextToast.message))}
          onSuccess={(state) => showToast(buildMeetingCreatedToast(state))}
          suppressSuccessToast
        />
      ) : null}

      {toast ? <ActionFeedbackToast toast={toast} isVisible={isToastVisible} /> : null}
    </>
  )
}

export function CreateMeetingModal({
  clients,
  contacts,
  onClose,
  onToast,
  onSuccess,
  suppressSuccessToast = false,
}: {
  clients: ClientOption[]
  contacts: ClientContactOption[]
  onClose: () => void
  onToast: (toast: MeetingToast) => void
  onSuccess?: (state: CreateMeetingActionState) => void
  suppressSuccessToast?: boolean
}) {
  const [state, formAction] = useActionState(
    createMeetingModalAction,
    initialCreateState
  )

  useBodyScrollLock(true)

  useEffect(() => {
    if (state.success) {
      onSuccess?.(state)
      if (!suppressSuccessToast) {
        onToast({
          type: 'success',
          message: 'Schůzka byla vytvořena.',
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
          className="flex w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl"
          style={{
            maxHeight:
              'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
          }}
        >
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

          <div className="min-h-0 flex flex-1 flex-col px-4 py-3 sm:px-5 sm:py-4">
            <MeetingForm
              action={formAction}
              submitLabel="ULOŽIT SCHŮZKU"
              onCancel={onClose}
              cancelLabel="ZRUŠIT"
              clients={clients}
              contacts={contacts}
              error={state.error}
              modalMode
            />
          </div>
        </div>
      </div>
    </div>
  )
}
