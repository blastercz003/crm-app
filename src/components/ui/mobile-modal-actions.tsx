'use client'

import Link from 'next/link'
import { useFormStatus } from 'react-dom'

type MobileModalActionsProps = {
  submitLabel: string
  pendingSubmitLabel: string
  cancelLabel?: string
  onCancel?: () => void
  cancelHref?: string
  submitDisabled?: boolean
}

export function MobileModalActions({
  submitLabel,
  pendingSubmitLabel,
  cancelLabel = 'ZRUŠIT',
  onCancel,
  cancelHref,
  submitDisabled = false,
}: MobileModalActionsProps) {
  const { pending } = useFormStatus()
  const isSubmitDisabled = pending || submitDisabled

  return (
    <div
      className={`flex shrink-0 flex-wrap justify-start gap-3 border-t border-gray-100 px-4 py-4 sm:hidden ${
        pending ? 'cursor-wait' : ''
      }`}
    >
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="inline-flex min-h-10 min-w-[152px] items-center justify-center rounded-xl border border-red-300 bg-white px-4 text-sm font-medium uppercase text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {cancelLabel}
        </button>
      ) : cancelHref ? (
        <Link
          href={cancelHref}
          aria-disabled={pending}
          className={`inline-flex min-h-10 min-w-[152px] items-center justify-center rounded-xl border border-red-300 bg-white px-4 text-sm font-medium uppercase text-red-600 transition hover:bg-red-50 ${
            pending ? 'pointer-events-none opacity-60' : ''
          }`}
        >
          {cancelLabel}
        </Link>
      ) : null}

      <button
        type="submit"
        disabled={isSubmitDisabled}
        aria-busy={pending}
        className="primary-ambient-glow--blue inline-flex min-h-10 min-w-[208px] items-center justify-center gap-2 rounded-xl bg-[#2980B9] px-4 text-sm font-medium uppercase text-white transition hover:bg-[#236f9f] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : null}
        {pending ? pendingSubmitLabel : submitLabel}
      </button>
    </div>
  )
}
