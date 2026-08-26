'use client'

import { useActionState, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
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
import { ModalHeading } from '@/components/ui/modal-heading'
import { useModalMotionClose } from '@/components/ui/modal-motion'
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
    'inline-flex items-center justify-center rounded-2xl border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_26px_rgba(9,48,82,0.32)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-[#1f5f8e] hover:bg-[linear-gradient(160deg,rgba(56,125,177,0.95)_0%,rgba(37,109,163,0.96)_45%,rgba(22,86,138,0.98)_100%)]'

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={`meetings-page__new-button ${resolvedClassName}`}
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
  onClose: closeImmediately,
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
  const onClose = useModalMotionClose(closeImmediately)
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

  const modalContent = (
    <div
      data-modal-motion-root
      className="meetings-modal__overlay fixed inset-0 z-[100] overflow-hidden overscroll-none bg-zinc-950/38 p-3 backdrop-blur-[5px] sm:p-4 lg:backdrop-blur-[6px]"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex h-full min-h-0 items-center justify-center">
        <div
          data-modal-motion-surface
          className="standard-form-modal__shell meetings-modal__shell relative flex w-full max-w-[900px] flex-col overflow-hidden rounded-3xl border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] will-change-transform transform-gpu lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]"
          style={{
            maxHeight:
              'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
          }}
        >
          <div
            aria-hidden="true"
            className="meetings-modal__shell-frame pointer-events-none absolute inset-0 rounded-3xl border border-white/65"
          />
          <div
            aria-hidden="true"
            className="meetings-modal__shell-sheen pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-95"
          />
          <div
            aria-hidden="true"
            className="meetings-modal__shell-halo pointer-events-none absolute inset-x-10 top-1 h-10 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.72),transparent_70%)]"
          />
          <div className="standard-form-modal__header meetings-modal__header flex shrink-0 items-start justify-between gap-4 border-b border-gray-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-4 py-3 sm:px-5 sm:py-4">
            <ModalHeading section="SCHŮZKY" title="Nová schůzka" className="min-w-0" />

            <button
              type="button"
              onClick={onClose}
              className="standard-form-modal__close meetings-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),0_14px_24px_rgba(39,39,42,0.16)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <div className="clients-modal__body meetings-modal__body min-h-0 flex flex-1 flex-col px-4 py-3 sm:px-5 sm:py-4">
            <MeetingForm
              action={formAction}
              submitLabel="ULOŽIT SCHŮZKU"
              onCancel={onClose}
              cancelLabel="ZRUŠIT"
              clients={clients}
              contacts={contacts}
              error={state.error}
              modalMode
              showModalCancel={false}
            />
          </div>
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
}
