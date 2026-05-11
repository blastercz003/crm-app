'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  deleteTask,
  updateTaskModalAction,
  type UpdateTaskActionState,
} from './actions'
import TaskForm from './TaskForm'

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

type TaskFormValues = {
  id: string
  title?: string | null
  note?: string | null
  due_date?: string | null
  status?: string | null
  priority?: string | null
  repeat_interval?: string | null
  assigned_to?: string | null
  client_id?: string | null
  client_contact_id?: string | null
  company_name?: string | null
  contact_person?: string | null
}

type EditTaskButtonProps = {
  task: TaskFormValues
  users: UserOption[]
  clients: ClientOption[]
  contacts?: ClientContactOption[]
  className?: string
  label?: string
}

const initialUpdateState: UpdateTaskActionState = {
  success: false,
  error: null,
}

export default function EditTaskButton({
  task,
  users,
  clients,
  contacts = [],
  className,
  label = 'UPRAVIT',
}: EditTaskButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [isMounted, setIsMounted] = useState(false)

  const updateAction = useMemo(() => {
    return updateTaskModalAction.bind(null, task.id)
  }, [task.id])

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
    'rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950'

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
            <EditTaskModal
              key={formKey}
              task={task}
              users={users}
              clients={clients}
              contacts={contacts}
              action={updateAction}
              onClose={closeModal}
            />,
            document.body
          )
        : null}
    </>
  )
}

function EditTaskModal({
  task,
  users,
  clients,
  contacts,
  action,
  onClose,
}: {
  task: TaskFormValues
  users: UserOption[]
  clients: ClientOption[]
  contacts: ClientContactOption[]
  action: (
    prevState: UpdateTaskActionState,
    formData: FormData
  ) => Promise<UpdateTaskActionState>
  onClose: () => void
}) {
  const [state, formAction] = useActionState(action, initialUpdateState)
  const deleteTaskAction = useMemo(() => deleteTask.bind(null, task.id), [task.id])

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
      className="fixed inset-0 z-[100] overflow-y-auto bg-zinc-950/38 p-3 backdrop-blur-[5px] lg:backdrop-blur-[6px] sm:p-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="flex min-h-full items-start justify-center py-3 sm:items-center sm:py-4">
        <div className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-gray-200/95 bg-[linear-gradient(168deg,rgba(255,255,255,0.96)_0%,rgba(249,250,251,0.92)_42%,rgba(244,244,245,0.88)_100%)] shadow-[0_34px_84px_rgba(24,24,27,0.34)] lg:shadow-[0_40px_96px_rgba(24,24,27,0.38)] sm:max-h-[calc(100dvh-2rem)]">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-3xl border border-white/65"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute -left-[36%] top-0 hidden h-full w-[32%] -skew-x-[18deg] bg-gradient-to-r from-transparent via-white/26 to-transparent lg:block lg:[animation:modal_glass_sweep_5.2s_ease-in-out_infinite]"
          />
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-gray-100 px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
                Upravit úkol
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Změň stav, prioritu, termín, poznámku, přiřazeného uživatele i
                vazbu na klienta.
              </p>
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

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 sm:px-5 sm:py-4">
            <TaskForm
              action={formAction}
              users={users}
              clients={clients}
              contacts={contacts}
              submitLabel="ULOŽIT ZMĚNY"
              onCancel={onClose}
              cancelLabel="ZRUŠIT"
              initialValues={task}
              error={state.error}
              extraActions={
                <button
                  type="submit"
                  formAction={deleteTaskAction}
                  className="rounded-lg border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-5 py-3 text-sm font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(185,28,28,0.2)]"
                >
                  SMAZAT
                </button>
              }
            />
          </div>
        </div>
      </div>
      <style jsx>{`
        @keyframes modal_glass_sweep {
          0% { transform: translateX(-180%) skewX(-18deg); opacity: 0; }
          16% { opacity: 0.42; }
          55% { opacity: 0.22; }
          100% { transform: translateX(440%) skewX(-18deg); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
