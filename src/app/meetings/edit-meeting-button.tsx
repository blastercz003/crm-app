'use client'

import { useActionState, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  updateMeetingModalAction,
  type UpdateMeetingActionState,
} from './actions'
import { MeetingForm } from '@/components/meetings/meeting-form'
import { ModalHeading } from '@/components/ui/modal-heading'

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

type MeetingFormValues = {
  id: string
  client_id?: string | null
  client_contact_id?: string | null
  company_name?: string | null
  contact_person?: string | null
  contact_phone?: string | null
  contact_email?: string | null
  address?: string | null
  title?: string | null
  meeting_datetime?: string | null
  pre_meeting_note?: string | null
  result_note?: string | null
  follow_up_task?: string | null
  follow_up_task_note?: string | null
  follow_up_task_priority?: string | null
  follow_up_task_due_date?: string | null
  status?: 'planned' | 'completed'
}

type EditMeetingButtonProps = {
  meeting: MeetingFormValues
  clients: ClientOption[]
  contacts?: ClientContactOption[]
  className?: string
  label?: string
  onSaved?: () => void
  onOpen?: () => void
  onClosed?: () => void
}

const initialUpdateState: UpdateMeetingActionState = {
  success: false,
  error: null,
}

export function EditMeetingButton({
  meeting,
  clients,
  contacts = [],
  className,
  label = 'UPRAVIT',
  onSaved,
  onOpen,
  onClosed,
}: EditMeetingButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)

  function openModal() {
    onOpen?.()
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  function closeModal() {
    setIsOpen(false)
    onClosed?.()
  }

  const resolvedClassName =
    className ??
    'inline-flex items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-3 py-2 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 ease-out hover:-translate-y-[1px] hover:bg-gray-800'

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={`meetings-page__edit-button ${resolvedClassName}`}
      >
        {label}
      </button>

      {isOpen ? (
        <EditMeetingModal
          key={formKey}
          meeting={meeting}
          clients={clients}
          contacts={contacts}
          onClose={closeModal}
          onSaved={onSaved}
        />
      ) : null}
    </>
  )
}

function EditMeetingModal({
  meeting,
  clients,
  contacts,
  onClose,
  onSaved,
}: {
  meeting: MeetingFormValues
  clients: ClientOption[]
  contacts: ClientContactOption[]
  onClose: () => void
  onSaved?: () => void
}) {
  const [state, formAction] = useActionState(
    updateMeetingModalAction,
    initialUpdateState
  )

  useEffect(() => {
    if (state.success) {
      onSaved?.()
      onClose()
    }
  }, [onClose, onSaved, state.success])

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const modalContent = (
    <div
      className="meetings-modal__overlay fixed inset-0 z-[100] overflow-y-auto bg-zinc-950/38 p-3 backdrop-blur-[5px] lg:backdrop-blur-[6px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex min-h-full items-start justify-center py-3 sm:items-center sm:py-4">
        <div className="standard-form-modal__shell meetings-modal__shell relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-[900px] flex-col overflow-hidden rounded-3xl border border-gray-200/95 bg-[linear-gradient(168deg,rgba(255,255,255,0.96)_0%,rgba(249,250,251,0.92)_42%,rgba(244,244,245,0.88)_100%)] shadow-[0_34px_84px_rgba(24,24,27,0.34)] will-change-transform transform-gpu lg:shadow-[0_40px_96px_rgba(24,24,27,0.38)] sm:max-h-[calc(100dvh-2rem)]">
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
            <ModalHeading section="SCHŮZKY" title="Upravit schůzku" className="min-w-0" />

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
              submitLabel="ULOŽIT ZMĚNY"
              onCancel={onClose}
              cancelLabel="ZRUŠIT"
              initialValues={meeting}
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

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
}
