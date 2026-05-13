'use client'

import { useActionState, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useFormStatus } from 'react-dom'
import {
  updateJobInfoAction,
  type UpdateJobInfoActionState,
} from './actions'

type InfoNoteButtonProps = {
  jobId: string
  jobNumber: string
  infoNote: string | null
  variant?: 'table' | 'mobile'
  compact?: boolean
}

const initialState: UpdateJobInfoActionState = {
  success: false,
  error: null,
}

export function InfoNoteButton({
  jobId,
  jobNumber,
  infoNote,
  variant = 'table',
  compact = false,
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
  const mobileButtonLabel = infoNote ? 'ZOBRAZIT' : 'PŘIDAT'

  const className =
    variant === 'mobile'
      ? `inline-flex items-center justify-center rounded-xl font-medium transition duration-200 ${
          compact ? 'h-8 min-w-0 w-full px-2 text-[11px]' : 'min-w-[88px] px-3 py-2 text-xs'
        } ${
          infoNote
            ? 'border border-zinc-900 bg-zinc-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] hover:-translate-y-[1px] hover:bg-zinc-800'
            : 'border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]'
        }`
      : `inline-flex min-w-[88px] items-center justify-center rounded-xl px-3 py-2 text-xs font-medium transition duration-200 ${
          infoNote
            ? 'border border-zinc-900 bg-zinc-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] hover:-translate-y-[1px] hover:bg-zinc-800'
            : 'border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]'
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
          jobNumber={jobNumber}
          initialValue={infoNote}
          onClose={closeModal}
        />
      ) : null}
    </>
  )
}

function InfoNoteModal({
  jobId,
  jobNumber,
  initialValue,
  onClose,
}: {
  jobId: string
  jobNumber: string
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

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/38 px-4 py-6 backdrop-blur-[5px] lg:backdrop-blur-[6px]">
      <div className="relative w-full max-w-xl overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] shadow-[0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[0_36px_84px_rgba(24,24,27,0.32)]">
        <div className="flex items-center justify-between border-b border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-5 py-4">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-gray-900 sm:text-xl">
              Info k zakázce
            </h2>
            <div className="mt-2 inline-flex items-center rounded-full border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-1.5 text-xs font-bold tracking-[0.12em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_20px_rgba(24,78,129,0.28)]">
              {jobNumber}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-zinc-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-sm font-medium text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_14px_28px_rgba(39,39,42,0.18)]"
            aria-label="Zavřít"
          >
            ✕
          </button>
        </div>

        <form action={formAction} className="flex flex-col">
          <div className="px-5 py-4">
              <textarea
                id="job-info-note"
                name="info_note"
                rows={6}
                defaultValue={initialValue ?? ''}
                placeholder="Sem napiš libovolný delší text k zakázce"
                className="w-full resize-y rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-4 py-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
              />

            {state.error ? (
              <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {state.error}
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.68)_100%)] px-5 py-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-10 items-center justify-center rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(185,28,28,0.2)]"
            >
              ZRUŠIT
            </button>

            <SaveButton />
          </div>
        </form>
      </div>
    </div>
  )

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(modalContent, document.body)
}

function SaveButton() {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex h-10 items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'UKLÁDÁM…' : 'ULOŽIT INFO'}
    </button>
  )
}
