'use client'

import { useRouter } from 'next/navigation'

export function AttachmentBackButton() {
  const router = useRouter()

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="inline-flex h-10 items-center justify-center rounded-xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
    >
      ZPĚT
    </button>
  )
}
