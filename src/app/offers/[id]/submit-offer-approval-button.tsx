'use client'

import { useFormStatus } from 'react-dom'

type SubmitOfferApprovalButtonProps = {
  waitingForApproval: boolean
  staleSubmitted: boolean
}

export function SubmitOfferApprovalButton({
  waitingForApproval,
  staleSubmitted,
}: SubmitOfferApprovalButtonProps) {
  const { pending } = useFormStatus()
  const isLocked = waitingForApproval || pending

  return (
    <button
      type="submit"
      disabled={isLocked}
      className={[
        'inline-flex min-h-10 w-full items-center justify-center rounded-xl px-4 text-sm font-medium transition disabled:cursor-not-allowed',
        isLocked
          ? 'bg-zinc-400 text-white'
          : 'bg-[#2980B9] text-white hover:bg-[#236f9f]',
      ].join(' ')}
    >
      {isLocked
        ? 'ODESLÁNO KE SCHVÁLENÍ'
        : staleSubmitted
          ? 'ODESLAT ZNOVU KE SCHVÁLENÍ'
          : 'ODESLAT KE SCHVÁLENÍ'}
    </button>
  )
}
