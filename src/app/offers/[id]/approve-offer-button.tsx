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
          ? 'border-[#d6dee8] bg-[linear-gradient(165deg,rgba(255,255,255,0.98)_0%,rgba(247,249,252,0.94)_100%)] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.82),inset_0_-1px_0_rgba(148,163,184,0.12)] opacity-80'
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
