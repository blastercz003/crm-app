import type { Metadata } from 'next'
import Link from 'next/link'
import { unstable_noStore as noStore } from 'next/cache'
import { ArrowLeft, CloudSun } from 'lucide-react'
import { PresenceSectionTracker } from '@/components/presence/presence-section-tracker'
import { getWeatherAlertsWorkspace } from '@/lib/weather-alerts/service'
import { WeatherAlertsDashboard } from './weather-alerts-dashboard'

export const metadata: Metadata = { title: 'Výstrahy počasí' }
export const dynamic = 'force-dynamic'

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function WeatherAlertsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  noStore()
  const params = searchParams ? await searchParams : {}
  const workspace = await getWeatherAlertsWorkspace()

  return (
    <main className="weather-alerts-page min-h-screen bg-[var(--background)] px-3 py-5 text-[var(--foreground)] sm:px-5 lg:px-8 lg:py-8">
      <PresenceSectionTracker section="Výstrahy počasí" route="/weather-alerts" />
      <div className="mx-auto w-full max-w-[1500px]">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4 lg:mb-7">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[18px] border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--accent)] shadow-[inset_0_1px_0_rgba(255,255,255,0.66),0_10px_25px_var(--shadow-soft)] sm:h-14 sm:w-14">
              <CloudSun aria-hidden size={25} />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[var(--text-secondary)]">MONITORING ČHMÚ</p>
              <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-[var(--text-primary)] sm:text-3xl">Výstrahy počasí</h1>
              <p className="mt-1 hidden text-xs text-[var(--text-secondary)] sm:block">Události, které mohou ovlivnit provoz a dodávky elektrické energie.</p>
            </div>
          </div>
          <Link href="/dashboard" className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface)] px-3.5 text-[10px] font-bold uppercase text-[var(--text-secondary)] shadow-[0_8px_20px_var(--shadow-soft)] transition hover:-translate-y-px hover:text-[var(--text-primary)]">
            <ArrowLeft aria-hidden size={15} /> Dashboard
          </Link>
        </header>

        <WeatherAlertsDashboard
          workspace={workspace}
          initialEventId={firstParam(params.event)}
        />
      </div>
    </main>
  )
}
