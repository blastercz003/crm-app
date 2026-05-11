'use client'

import { useFormStatus } from 'react-dom'

type ApproveOfferButtonProps = {
  isApprovedCurrentVersion: boolean
}

export function ApproveOfferButton({
  isApprovedCurrentVersion,
}: ApproveOfferButtonProps) {
  const { pending } = useFormStatus()
  const isLocked = isApprovedCurrentVersion || pending

  return (
    <button
      type="submit"
      disabled={isLocked}
      className={[
        'inline-flex min-h-10 w-full items-center justify-center rounded-xl border px-4 text-sm font-medium transition duration-200 disabled:cursor-not-allowed',
        isApprovedCurrentVersion
          ? 'border-zinc-300 bg-zinc-300 text-zinc-600'
          : pending
            ? 'border-zinc-400 bg-zinc-400 text-white'
            : 'border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(16,185,129,0.24)] hover:-translate-y-[1px]',
      ].join(' ')}
    >
      {isApprovedCurrentVersion
        ? 'SCHVÁLENO'
        : pending
          ? 'SCHVALUJI...'
          : 'SCHVÁLIT NABÍDKU'}
    </button>
  )
}
