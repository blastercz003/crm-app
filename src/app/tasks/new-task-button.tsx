'use client'

import { useActionState, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  createTaskModalAction,
  type CreateTaskActionState,
} from './actions'
import { buildErrorToast, buildTaskCreatedToast } from '@/components/ui/action-feedback-messages'
import {
  ActionFeedbackToast,
  useAnimatedActionToast,
} from '@/components/ui/action-feedback-toast'
import TaskForm from './TaskForm'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'

type UserOption = {
  id: string
  name: string | null
  role: string | null
}

type ClientOption = {
  id: string
  name: string
}

type ClientContactOption = {
  id: string
  client_id: string
  name: string
  is_primary: boolean
}

type NewTaskButtonProps = {
  users: UserOption[]
  clients: ClientOption[]
  contacts?: ClientContactOption[]
  className?: string
  label?: string
}

type TaskToast = {
  type: 'success' | 'error'
  message: string
}

const initialCreateState: CreateTaskActionState = {
  success: false,
  error: null,
}

export default function NewTaskButton({
  users,
  clients,
  contacts = [],
  className,
  label = 'NOVÝ ÚKOL',
}: NewTaskButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [isMounted, setIsMounted] = useState(false)
  const { toast, isVisible: isToastVisible, showToast } = useAnimatedActionToast()

  useEffect(() => {
    setIsMounted(true)
  }, [])

  function openModal() {
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  function closeModal() {
    setIsOpen(false)
  }

  const resolvedClassName =
    className ??
    'inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)]'

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={resolvedClassName}
      >
        {label}
      </button>

      {isOpen && isMounted
        ? createPortal(
            <CreateTaskModal
              key={formKey}
              users={users}
              clients={clients}
              contacts={contacts}
              onClose={closeModal}
              onToast={(nextToast) => showToast(buildErrorToast(nextToast.message))}
              onSuccess={(state) => showToast(buildTaskCreatedToast(state))}
              suppressSuccessToast
            />,
            document.body
          )
        : null}

      {toast ? <ActionFeedbackToast toast={toast} isVisible={isToastVisible} /> : null}
    </>
  )
}

export function CreateTaskModal({
  users,
  clients,
  contacts,
  onClose,
  onToast,
  onSuccess,
  suppressSuccessToast = false,
}: {
  users: UserOption[]
  clients: ClientOption[]
  contacts: ClientContactOption[]
  onClose: () => void
  onToast: (toast: TaskToast) => void
  onSuccess?: (state: CreateTaskActionState) => void
  suppressSuccessToast?: boolean
}) {
  const [state, formAction] = useActionState(
    createTaskModalAction,
    initialCreateState
  )

  useBodyScrollLock(true)

  useEffect(() => {
    if (state.success) {
      onSuccess?.(state)
      if (!suppressSuccessToast) {
        onToast({
          type: 'success',
          message: 'Úkol byl vytvořen.',
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
      className="fixed inset-0 z-[100] overflow-y-auto bg-zinc-950/38 p-4 backdrop-blur-[5px] lg:backdrop-blur-[6px] sm:p-4"
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
          className="relative flex w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]"
          style={{
            maxHeight:
              'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)',
          }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-3xl border border-white/65"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent"
          />
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                Nový úkol
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,1),0_14px_24px_rgba(39,39,42,0.16)]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <div className="min-h-0 flex flex-1 flex-col px-4 py-3 sm:px-5 sm:py-4">
            <TaskForm
              action={formAction}
              users={users}
              clients={clients}
              contacts={contacts}
              submitLabel="VYTVOŘIT ÚKOL"
              onCancel={onClose}
              cancelLabel="ZRUŠIT"
              error={state.error}
              modalMode
            />
          </div>
        </div>
      </div>
    </div>
  )
}
