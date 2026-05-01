'use client'

import { useActionState, useEffect, useState } from 'react'
import {
  updateMeetingModalAction,
  type UpdateMeetingActionState,
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
}: EditMeetingButtonProps) {
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
    'inline-flex items-center justify-center rounded-xl bg-black px-3 py-2 text-xs font-medium text-white transition hover:bg-gray-900'

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
        <EditMeetingModal
          key={formKey}
          meeting={meeting}
          clients={clients}
          contacts={contacts}
          onClose={closeModal}
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
}: {
  meeting: MeetingFormValues
  clients: ClientOption[]
  contacts: ClientContactOption[]
  onClose: () => void
}) {
  const [state, formAction] = useActionState(
    updateMeetingModalAction,
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
                Upravit schůzku
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Uprav schůzku a případně ji napoj na klienta z databáze.
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
              submitLabel="ULOŽIT ZMĚNY"
              onCancel={onClose}
              cancelLabel="ZRUŠIT"
              initialValues={meeting}
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
