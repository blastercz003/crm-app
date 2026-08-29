'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, CircleAlert, RefreshCw } from 'lucide-react'

export default function WeatherAlertsError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Weather alerts page failed to load', error)
  }, [error])

  return (
    <main className="weather-alerts-page flex min-h-screen items-center justify-center bg-[var(--background)] px-4 py-8 text-[var(--foreground)]">
      <section className="weather-alerts__surface w-full max-w-xl rounded-[28px] border border-[var(--surface-border)] bg-[var(--surface)] p-6 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_22px_60px_var(--shadow-medium)] sm:p-8">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-[20px] border border-red-500/30 bg-red-500/10 text-red-600 [html[data-theme=dark]_&]:text-red-300">
          <CircleAlert aria-hidden size={27} />
        </span>
        <p className="mt-5 text-[10px] font-bold uppercase tracking-[0.15em] text-red-600 [html[data-theme=dark]_&]:text-red-300">Výstrahy počasí</p>
        <h1 className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">Data se nepodařilo načíst</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-secondary)]">Zkuste načtení zopakovat. Ostatní části aplikace zůstávají dostupné.</p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <button type="button" onClick={reset} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 text-xs font-bold uppercase text-white shadow-[0_10px_24px_var(--shadow-medium)]">
            <RefreshCw aria-hidden size={15} /> Zkusit znovu
          </button>
          <Link href="/dashboard" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-5 text-xs font-bold uppercase text-[var(--text-secondary)]">
            <ArrowLeft aria-hidden size={15} /> Dashboard
          </Link>
        </div>
        {error.digest ? <p className="mt-5 text-[10px] text-[var(--text-tertiary)]">Kód chyby: {error.digest}</p> : null}
      </section>
    </main>
  )
}
