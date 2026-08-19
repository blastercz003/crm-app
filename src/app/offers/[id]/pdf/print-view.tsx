'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function OfferPdfAutoPrint() {
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

export function OfferPdfMobilePreviewControls({ backHref }: { backHref: string }) {
  const router = useRouter()

  useEffect(() => {
    const setScale = () => {
      const scale = Math.min(1, Math.max(0.28, (window.innerWidth - 24) / 794))
      document.documentElement.style.setProperty('--offer-mobile-pdf-scale', String(scale))
    }

    setScale()
    window.addEventListener('resize', setScale)
    window.addEventListener('orientationchange', setScale)

    return () => {
      window.removeEventListener('resize', setScale)
      window.removeEventListener('orientationchange', setScale)
      document.documentElement.style.removeProperty('--offer-mobile-pdf-scale')
    }
  }, [])

  return (
    <div className="fixed inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 flex items-center justify-between gap-2 rounded-2xl border border-white/20 bg-zinc-950/86 p-2 shadow-2xl backdrop-blur-xl print:hidden sm:hidden">
      <button
        type="button"
        onClick={() => router.push(backHref)}
        className="h-10 rounded-xl border border-white/20 bg-white/10 px-3 text-xs font-semibold text-white transition active:bg-white/15"
      >
        ZPĚT
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="h-10 rounded-xl bg-[#398bc2] px-4 text-xs font-semibold text-white transition active:bg-[#2f7eb4]"
      >
        TISK / SDÍLET
      </button>
    </div>
  )
}

export function OfferPdfToolbar({
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
