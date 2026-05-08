'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { submitOfferForApprovalWithAutosave } from '@/app/offers/actions'

type SubmitOfferApprovalButtonProps = {
  offerId: string
  formId: string
  waitingForApproval: boolean
  staleSubmitted: boolean
}

export function SubmitOfferApprovalButton({
  offerId,
  formId,
  waitingForApproval,
  staleSubmitted,
}: SubmitOfferApprovalButtonProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const isLocked = waitingForApproval || isPending

  function handleSubmitForApproval() {
    if (isLocked) return

    const form = document.getElementById(formId)
    if (!(form instanceof HTMLFormElement)) {
      alert('Nepodařilo se načíst formulář nabídky.')
      return
    }

    const formData = new FormData(form)

    startTransition(async () => {
      const result = await submitOfferForApprovalWithAutosave(offerId, formData)

      if (!result.success) {
        alert(result.error ?? 'Nepodařilo se odeslat nabídku ke schválení.')
        return
      }

      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={handleSubmitForApproval}
      disabled={isLocked}
      className={[
        'inline-flex min-h-10 w-full items-center justify-center rounded-xl px-4 text-sm font-medium transition disabled:cursor-not-allowed',
        isLocked
          ? 'bg-zinc-400 text-white'
          : 'bg-[#2980B9] text-white hover:bg-[#236f9f]',
      ].join(' ')}
    >
      {isLocked
        ? waitingForApproval
          ? 'ODESLÁNO KE SCHVÁLENÍ'
          : 'ODESÍLÁM KE SCHVÁLENÍ...'
        : staleSubmitted
          ? 'ODESLAT ZNOVU KE SCHVÁLENÍ'
          : 'ODESLAT KE SCHVÁLENÍ'}
    </button>
  )
}
