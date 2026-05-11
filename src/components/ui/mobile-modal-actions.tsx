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
  visualStyle?: 'default' | 'blaster'
}

export function MobileModalActions({
  submitLabel,
  pendingSubmitLabel,
  cancelLabel = 'ZRUŠIT',
  onCancel,
  cancelHref,
  submitDisabled = false,
  visualStyle = 'default',
}: MobileModalActionsProps) {
  const { pending } = useFormStatus()
  const isSubmitDisabled = pending || submitDisabled

  const isBlaster = visualStyle === 'blaster'

  return (
    <div
      className={`flex shrink-0 flex-nowrap items-center justify-start gap-3 border-t border-gray-100 px-4 py-4 sm:justify-end sm:px-5 ${
        pending ? 'cursor-wait' : ''
      }`}
    >
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className={
            isBlaster
              ? 'inline-flex h-11 w-[152px] shrink-0 items-center justify-center rounded-xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 text-sm font-medium uppercase text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(185,28,28,0.2)] disabled:cursor-not-allowed disabled:opacity-60'
              : 'inline-flex h-11 w-[152px] shrink-0 items-center justify-center rounded-xl border border-red-300 bg-white px-4 text-sm font-medium uppercase text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60'
          }
        >
          {cancelLabel}
        </button>
      ) : cancelHref ? (
        <Link
          href={cancelHref}
          aria-disabled={pending}
          className={`inline-flex h-11 w-[152px] shrink-0 items-center justify-center rounded-xl ${
            isBlaster
              ? 'border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(185,28,28,0.2)]'
              : 'border border-red-300 bg-white text-red-600 transition hover:bg-red-50'
          } px-4 text-sm font-medium uppercase ${
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
        className={`inline-flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-sm font-medium uppercase text-white sm:h-11 sm:min-w-[208px] sm:flex-none disabled:cursor-not-allowed disabled:opacity-60 ${
          isBlaster
            ? 'primary-ambient-glow--blue border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)]'
            : 'primary-ambient-glow--blue bg-[#2980B9] transition hover:bg-[#236f9f]'
        }`}
      >
        {pending ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
        ) : null}
        {pending ? pendingSubmitLabel : submitLabel}
      </button>
    </div>
  )
}
