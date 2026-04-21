'use client'

import Link from 'next/link'
import { useEffect } from 'react'

export function HandoverProtocolAutoPrint() {
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.print()
    })

    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [])

  return null
}

export function HandoverProtocolPrintToolbar({
  backHref,
  printHref,
}: {
  backHref: string
  printHref: string
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
      <Link
        href={backHref}
        className="inline-flex h-10 items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
      >
        ZPĚT
      </Link>

      <Link
        href={printHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-10 items-center justify-center rounded-2xl bg-zinc-900 px-4 text-sm font-medium text-white transition hover:bg-zinc-800"
      >
        PDF
      </Link>
    </div>
  )
}
