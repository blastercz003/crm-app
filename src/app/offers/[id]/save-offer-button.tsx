'use client'

import { useState } from 'react'

type SaveOfferButtonProps = {
  formId: string
}

export function SaveOfferButton({ formId }: SaveOfferButtonProps) {
  const [isPending, setIsPending] = useState(false)

  function handleSubmit() {
    if (isPending) return

    const form = document.getElementById(formId)
    if (!(form instanceof HTMLFormElement)) return

    setIsPending(true)
    form.requestSubmit()
  }

  return (
    <button
      type="button"
      onClick={handleSubmit}
      disabled={isPending}
      aria-busy={isPending}
      className="offers-detail-page__footer-save inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_24px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_16px_28px_rgba(24,78,129,0.34)] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPending ? 'UKLÁDÁM NABÍDKU...' : 'ULOŽIT NABÍDKU'}
    </button>
  )
}
