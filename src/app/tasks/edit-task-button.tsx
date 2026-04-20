'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
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

type TaskFormValues = {
  id: string
  title?: string | null
  note?: string | null
  due_date?: string | null
  status?: string | null
  priority?: string | null
  assigned_to?: string | null
  client_id?: string | null
  company_name?: string | null
  contact_person?: string | null
}

type EditTaskButtonProps = {
  task: TaskFormValues
  users: UserOption[]
  clients: ClientOption[]
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
  className,
  label = 'UPRAVIT',
}: EditTaskButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)

  const updateAction = useMemo(() => {
    return updateTaskModalAction.bind(null, task.id)
  }, [task.id])

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

      {isOpen ? (
        <EditTaskModal
          key={formKey}
          task={task}
          users={users}
          clients={clients}
          action={updateAction}
          onClose={closeModal}
        />
      ) : null}
    </>
  )
}

function EditTaskModal({
  task,
  users,
  clients,
  action,
  onClose,
}: {
  task: TaskFormValues
  users: UserOption[]
  clients: ClientOption[]
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
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition hover:bg-gray-50"
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
              submitLabel="ULOŽIT ZMĚNY"
              onCancel={onClose}
              cancelLabel="ZRUŠIT"
              initialValues={task}
              error={state.error}
              extraActions={
                <form action={deleteTaskAction}>
                  <button
                    type="submit"
                    className="rounded-lg border border-red-200 bg-white px-5 py-3 text-sm font-medium text-red-600 transition hover:bg-red-50"
                  >
                    SMAZAT
                  </button>
                </form>
              }
            />
          </div>
        </div>
      </div>
    </div>
  )
}
