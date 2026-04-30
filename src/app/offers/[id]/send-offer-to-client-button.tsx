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
        'inline-flex min-h-10 w-full items-center justify-center rounded-xl px-4 text-sm font-medium transition disabled:cursor-not-allowed',
        isLocked
          ? 'bg-zinc-400 text-white'
          : 'bg-black text-white hover:bg-gray-800',
      ].join(' ')}
    >
      {isLocked ? 'ODESLÁNO KLIENTOVI' : 'ODESLAT KLIENTOVI'}
    </button>
  )
}
