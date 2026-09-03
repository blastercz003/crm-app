import type { Metadata } from 'next'
import Link from 'next/link'
import { unstable_noStore as noStore } from 'next/cache'
import { PresenceSectionTracker } from '@/components/presence/presence-section-tracker'
import { getPowerOutageRuntimeContext } from '@/lib/power-outages/access'
import { getCompletePowerOutageWorkspace } from '@/lib/power-outages/complete-service'
import { getPowerOutageWorkspace } from '@/lib/power-outages/service'
import { CompletePowerOutagesDashboard } from './complete-power-outages-dashboard'
import { PowerOutageModeSwitch, type PowerOutageMode } from './power-outage-mode-switch'
import { PowerOutagesDashboard } from './power-outages-dashboard'
import { PowerOutagesRealtimeRefresh } from './power-outages-realtime-refresh'

export const metadata: Metadata = { title: 'Odstávky' }
export const dynamic = 'force-dynamic'

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function PowerOutagesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  noStore()
  const params = searchParams ? await searchParams : {}
  const { profile } = await getPowerOutageRuntimeContext({ redirectOnDenied: true })
  const completeEnabled = profile.role === 'admin' || process.env.COMPLETE_POWER_OUTAGES_ENABLED === 'true'
  const requestedMode: PowerOutageMode = firstParam(params.mode) === 'complete' ? 'complete' : 'markets'
  const mode: PowerOutageMode = requestedMode === 'complete' && completeEnabled ? 'complete' : 'markets'
  const marketWorkspace = mode === 'markets' ? await getPowerOutageWorkspace() : null
  const completeWorkspace = mode === 'complete' ? await getCompletePowerOutageWorkspace() : null

  return (
    <main className="activities-page power-outages-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)] text-[var(--foreground)]">
      <PresenceSectionTracker section="Odstávky" route="/power-outages" />
      <PowerOutagesRealtimeRefresh scope={mode === 'complete' ? 'complete_power_outages' : 'power_outages'} />
      <div aria-hidden className="activities-page__glow activities-page__glow--right pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl" />
      <div aria-hidden className="activities-page__glow activities-page__glow--left pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl" />

      <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-4 px-4 py-6 sm:px-6 lg:gap-5 lg:px-8">
        <header className="activities-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-3xl font-semibold leading-none tracking-tight text-[var(--text-primary)]">
              <span className="lg:hidden">Monitoring odstávek</span>
              <span className="hidden lg:inline">Monitoring plánovaných odstávek</span>
            </h1>
            <Link href="/dashboard" className="offers-page__back-button clients-page__back-button inline-flex items-center justify-center whitespace-nowrap rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800">ZPĚT NA DASHBOARD</Link>
          </div>
        </header>

        {completeEnabled ? <PowerOutageModeSwitch mode={mode} /> : null}

        {mode === 'markets' && marketWorkspace
          ? <PowerOutagesDashboard workspace={marketWorkspace} />
          : completeWorkspace
            ? <CompletePowerOutagesDashboard workspace={completeWorkspace} />
            : null}
      </div>
    </main>
  )
}
