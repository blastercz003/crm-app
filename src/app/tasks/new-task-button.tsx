'use client'

import { useActionState, useEffect, useState } from 'react'
import {
  createTaskModalAction,
  type CreateTaskActionState,
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

type NewTaskButtonProps = {
  users: UserOption[]
  clients: ClientOption[]
  className?: string
  label?: string
}

const initialCreateState: CreateTaskActionState = {
  success: false,
  error: null,
}

export default function NewTaskButton({
  users,
  clients,
  className,
  label = 'NOVÝ ÚKOL',
}: NewTaskButtonProps) {
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
        <CreateTaskModal
          key={formKey}
          users={users}
          clients={clients}
          onClose={closeModal}
        />
      ) : null}
    </>
  )
}

function CreateTaskModal({
  users,
  clients,
  onClose,
}: {
  users: UserOption[]
  clients: ClientOption[]
  onClose: () => void
}) {
  const [state, formAction] = useActionState(
    createTaskModalAction,
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
                Nový úkol
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Vytvoř nový úkol a přiřaď ho konkrétnímu uživateli. Úkol může být
                interní nebo navázaný na klienta.
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
              submitLabel="VYTVOŘIT ÚKOL"
              onCancel={onClose}
              cancelLabel="ZRUŠIT"
              error={state.error}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
