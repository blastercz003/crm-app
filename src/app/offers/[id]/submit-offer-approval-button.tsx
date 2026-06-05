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

      router.push(`/offers/${offerId}?submitted=1`)
    })
  }

  return (
    <button
      type="button"
      onClick={handleSubmitForApproval}
      disabled={isLocked}
      className={[
        'offers-detail-page__approval-button offers-detail-page__approval-button--submit inline-flex min-h-10 w-full items-center justify-center rounded-xl border px-4 text-sm font-medium transition duration-200 disabled:cursor-not-allowed',
        isLocked
          ? 'offers-detail-page__approval-button--disabled border-zinc-300 bg-zinc-300 text-zinc-600'
          : 'border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_24px_rgba(24,78,129,0.28)] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_16px_28px_rgba(24,78,129,0.34)]',
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
