'use client'

import { useFormStatus } from 'react-dom'

type SendOfferToClientButtonProps = {
  isSent: boolean
}

export function SendOfferToClientButton({ isSent }: SendOfferToClientButtonProps) {
  const { pending } = useFormStatus()
  const isLocked = isSent || pending

  return (
    <button
      type="submit"
      disabled={isLocked}
      className={[
        'offers-detail-page__approval-button offers-detail-page__approval-button--send inline-flex min-h-10 w-full items-center justify-center rounded-xl border px-4 text-sm font-medium transition duration-200 disabled:cursor-not-allowed',
        isLocked
          ? 'offers-detail-page__approval-button--disabled border-zinc-300 bg-zinc-300 text-zinc-600'
          : 'border-zinc-900 bg-zinc-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_12px_24px_rgba(24,24,27,0.24)] hover:-translate-y-[1px] hover:bg-zinc-800',
      ].join(' ')}
    >
      {isLocked ? 'ODESLÁNO KLIENTOVI' : 'ODESLAT KLIENTOVI'}
    </button>
  )
}
