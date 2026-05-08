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
      className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-[#2980B9] px-4 text-sm font-medium text-white transition hover:bg-[#236f9f] disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPending ? 'UKLÁDÁM NABÍDKU...' : 'ULOŽIT NABÍDKU'}
    </button>
  )
}
