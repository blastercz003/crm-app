'use client'

import { CircleAlert, RotateCcw } from 'lucide-react'
import { useEffect } from 'react'

export default function PowerOutagesError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Načtení stránky Odstávky selhalo.', error)
  }, [error])

  return (
    <main className="activities-page power-outages-page relative flex min-h-screen items-center justify-center overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)] px-4 text-[var(--foreground)]">
      <section className="activities-page__panel relative z-10 w-full max-w-lg rounded-[28px] border border-white/70 p-6 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] sm:p-8">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-500"><CircleAlert aria-hidden size={23} /></span>
        <h1 className="mt-4 text-xl font-semibold text-[var(--text-primary)]">Odstávky se nepodařilo načíst</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">Zkontrolujte připojení a zkuste obsah bezpečně načíst znovu.</p>
        <button type="button" onClick={reset} className="mt-5 inline-flex h-11 items-center justify-center gap-2 rounded-2xl border border-zinc-900 bg-zinc-900 px-5 text-xs font-bold uppercase text-white shadow-[0_10px_22px_rgba(24,24,27,0.2)] transition hover:-translate-y-px hover:bg-zinc-800">
          <RotateCcw aria-hidden size={15} /> Zkusit znovu
        </button>
      </section>
    </main>
  )
}
