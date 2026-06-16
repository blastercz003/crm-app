import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import {
  getMeetingCalendarFeedByToken,
  MEETING_CALENDAR_NAME,
} from '@/lib/meetings/calendar-feed'
import { MeetingCalendarLandingActions } from './calendar-landing-actions'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Schůzky do kalendáře',
}

export default async function MeetingCalendarLandingPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const feed = await getMeetingCalendarFeedByToken(token)

  if (!feed) {
    notFound()
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(160deg,#0b1220_0%,#111b2e_52%,#09111f_100%)] px-4 py-6 text-[#e5edf7] sm:px-6 lg:px-8">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-4xl items-center justify-center">
        <section className="w-full rounded-[32px] border border-white/10 bg-[linear-gradient(168deg,rgba(15,23,42,0.96)_0%,rgba(9,15,27,0.98)_52%,rgba(8,13,23,0.99)_100%)] p-4 shadow-[0_36px_84px_rgba(0,0,0,0.42)] sm:p-5">
          <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0.01)_100%)] p-5 sm:p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Kalendář pro schůzky
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#f8fbff] sm:text-4xl">
              {MEETING_CALENDAR_NAME}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300 sm:text-base">
              Tato stránka slouží jako most mezi vaší appkou a nativní aplikací
              Kalendář v telefonu. Na iPhonu je nejlepší otevřít ji v Safari a
              pak použít první tlačítko pro přidání odběru.
            </p>

            <div className="mt-5 rounded-2xl border border-sky-400/15 bg-[linear-gradient(155deg,rgba(18,28,46,0.98)_0%,rgba(10,16,28,0.98)_100%)] p-4 text-sm leading-6 text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_12px_26px_rgba(0,0,0,0.28)]">
              Pokud se stránka otevřela uvnitř aplikace, přepni ji nejdřív do
              Safari. Potom už se kalendářový odkaz přenese do nativní aplikace
              Kalendář mnohem spolehlivěji.
            </div>

            <div className="mt-5">
              <MeetingCalendarLandingActions token={token} />
            </div>

            <div className="mt-5 rounded-2xl border border-white/10 bg-[linear-gradient(155deg,rgba(18,28,46,0.98)_0%,rgba(10,16,28,0.98)_100%)] p-4 text-sm leading-6 text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_12px_26px_rgba(0,0,0,0.28)]">
              <p className="font-medium text-[#f8fbff]">Poznámka</p>
              <p className="mt-2">
                Odběr je soukromý a patří jen tomuto uživateli. Změny a smazání
                schůzek se propsávají automaticky, ale samotný kalendář je
                read-only.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
