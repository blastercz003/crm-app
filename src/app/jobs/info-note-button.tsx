'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { useFormStatus } from 'react-dom'
import {
  updateJobInfoAction,
  type UpdateJobInfoActionState,
} from './actions'

type InfoNoteButtonProps = {
  jobId: string
  infoNote: string | null
  variant?: 'table' | 'mobile'
}

const initialState: UpdateJobInfoActionState = {
  success: false,
  error: null,
}

export function InfoNoteButton({
  jobId,
  infoNote,
  variant = 'table',
}: InfoNoteButtonProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [formKey, setFormKey] = useState(0)

  function openModal() {
    setFormKey((current) => current + 1)
    setIsOpen(true)
  }

  function closeModal() {
    setIsOpen(false)
  }

  const buttonLabel = infoNote ? 'ZOBRAZIT' : 'PŘIDAT'
  const mobileButtonLabel = infoNote ? 'ZOBRAZIT INFO' : 'PŘIDAT INFO'

  const className =
    variant === 'mobile'
      ? `inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-medium transition ${
          infoNote
            ? 'bg-black text-white hover:bg-gray-800'
            : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
        }`
      : `inline-flex min-w-[88px] items-center justify-center rounded-xl px-3 py-2 text-xs font-medium transition ${
          infoNote
            ? 'bg-black text-white hover:bg-gray-800'
            : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
        }`

  return (
    <>
      <button type="button" onClick={openModal} className={className}>
        {variant === 'mobile' ? mobileButtonLabel : buttonLabel}
      </button>

      {isOpen ? (
        <InfoNoteModal
          key={formKey}
          jobId={jobId}
          initialValue={infoNote}
          onClose={closeModal}
        />
      ) : null}
    </>
  )
}

function InfoNoteModal({
  jobId,
  initialValue,
  onClose,
}: {
  jobId: string
  initialValue: string | null
  onClose: () => void
}) {
  const boundAction = useMemo(
    () => updateJobInfoAction.bind(null, jobId),
    [jobId]
  )

  const [state, formAction] = useActionState(boundAction, initialState)

  useEffect(() => {
    if (state.success) {
      onClose()
    }
  }, [onClose, state.success])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 px-4 py-6 backdrop-blur-sm">
      <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-gray-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-5">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-gray-900">
              Info k zakázce
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Doplň nebo uprav delší poznámku k této zakázce.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-gray-200 bg-white text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            aria-label="Zavřít"
          >
            ✕
          </button>
        </div>

        <form action={formAction} className="flex flex-col">
          <div className="px-6 py-5">
            <label
              htmlFor="job-info-note"
              className="mb-1.5 block text-sm font-medium text-gray-700"
            >
              Poznámka
            </label>

            <textarea
              id="job-info-note"
              name="info_note"
              rows={10}
              defaultValue={initialValue ?? ''}
              placeholder="Sem napiš libovolný delší text k zakázce"
              className="w-full resize-y rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200"
            />

            {state.error ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {state.error}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-gray-200 px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Zrušit
            </button>

            <SaveButton />
          </div>
        </form>
      </div>
    </div>
  )
}

function SaveButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center justify-center rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Ukládám…' : 'Uložit info'}
    </button>
  )
}
