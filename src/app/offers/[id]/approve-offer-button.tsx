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
        'inline-flex min-h-10 w-full items-center justify-center rounded-xl px-4 text-sm font-medium transition disabled:cursor-not-allowed',
        isApprovedCurrentVersion
          ? 'bg-zinc-300 text-zinc-600'
          : pending
            ? 'bg-zinc-400 text-white'
            : 'bg-emerald-600 text-white hover:bg-emerald-700',
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
