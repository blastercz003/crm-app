'use client'

import { CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CompletePowerOutageCurrentUser, CompletePowerOutageSidebarWorkspace, CompletePowerOutageStatistics } from '@/lib/power-outages/complete-types'
import { getCompletePowerOutageOwnersAction, getCompletePowerOutageSidebarAction, getCompletePowerOutageStatisticsAction } from './actions'
import { CompletePowerOutageRecords } from './complete-power-outage-records'
import { CompletePanelStatusBadge } from './complete-panel-status-badge'
import { CompletePowerOutageSidebar } from './complete-power-outage-sidebar'
import { PowerOutageSummaryStats, type PowerOutageSummaryCard } from './power-outage-summary-stats'

function SidebarSkeleton({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
  const panelClass = 'activities-page__panel flex h-[440px] min-w-0 flex-col rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_16px_36px_rgba(15,23,42,0.1)] backdrop-blur-[10px] sm:p-5 lg:h-auto lg:min-h-[210px] lg:p-4'
  const header = (eyebrow: string, title: string) => <div className="flex items-center gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 ${error ? 'text-red-500' : 'text-[var(--accent)]'}`}>{error ? <CircleAlert aria-hidden size={18} /> : <LoaderCircle aria-label={`Načítám panel ${title}`} size={19} className="animate-spin" />}</span><span><small className="block text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">{eyebrow}</small><h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3></span></div>
  const loadingBadge = <CompletePanelStatusBadge label="Načítám" badgeClassName="border-sky-400/30 bg-sky-500/10 text-[var(--accent)]" icon={<LoaderCircle aria-hidden size={11} className="animate-spin" />} />
  const sourceCard = (name: string, newCez = false) => <div key={name} className="weather-alerts__record-surface relative h-full rounded-xl border px-2.5 py-1 lg:h-[94px] lg:px-3 lg:py-2">
    <div className="flex items-center justify-between gap-2"><strong className="text-[13px] text-[var(--text-primary)]">{name}</strong>{loadingBadge}</div>
    <div className="mt-0.5 grid grid-cols-2 gap-2 lg:mt-1"><span className="weather-alerts__record-surface flex h-6 items-center justify-between rounded-lg border px-2.5"><small className="text-[7px] font-bold uppercase leading-none tracking-[0.035em] text-[var(--text-secondary)]">{newCez ? 'Hotovo' : 'Prověřeno'}</small><LoaderCircle aria-label={`Načítám stav ${name}`} size={10} className="animate-spin text-[var(--accent)]" /></span><span className="weather-alerts__record-surface flex h-6 items-center justify-between rounded-lg border px-2.5"><small className="text-[7px] font-bold uppercase leading-none tracking-[0.035em] text-[var(--text-secondary)]">Zbývá</small><span className="text-[11px] font-bold leading-none text-[var(--text-secondary)]">—</span></span></div>
    <div className="absolute bottom-1 left-2.5 right-2.5 flex items-center gap-2 lg:static lg:mt-1.5"><span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-border)]"><i className="block h-full w-2/5 animate-pulse rounded-full bg-sky-500/70" /></span><small className="w-[78px] text-right text-[6px] text-[var(--text-secondary)]">Načítám průběh…</small></div>
  </div>
  const providerCard = (name: string) => <div key={name} className="weather-alerts__record-surface h-full rounded-xl border px-2.5 py-1 lg:h-[126px] lg:px-3 lg:py-2">
    <div className="flex items-center justify-between gap-2"><strong className="text-[13px] text-[var(--text-primary)]">{name}</strong>{loadingBadge}</div>
    <div className="mt-0.5 grid grid-cols-4 gap-1"><span className="rounded-lg border border-[var(--surface-border)] py-1 text-center"><small className="block whitespace-nowrap text-[5px] font-bold uppercase text-emerald-700">S výsledkem</small><span className="text-[10px] font-bold text-[var(--text-secondary)]">—</span></span><span className="rounded-lg border border-[var(--surface-border)] py-1 text-center"><small className="block whitespace-nowrap text-[5px] font-bold uppercase text-amber-700">Bez výsledku</small><span className="text-[10px] font-bold text-[var(--text-secondary)]">—</span></span><span className="rounded-lg border border-[var(--surface-border)] py-1 text-center"><small className="block whitespace-nowrap text-[5px] font-bold uppercase text-sky-700">Opakuje se</small><LoaderCircle aria-label={`Načítám data ${name}`} size={9} className="mx-auto mt-0.5 animate-spin text-[var(--accent)]" /></span><span className="rounded-lg border border-[var(--surface-border)] py-1 text-center"><small className="block whitespace-nowrap text-[5px] font-bold uppercase text-red-600">Ke kontrole</small><span className="text-[10px] font-bold text-[var(--text-secondary)]">—</span></span></div>
    <div className="mt-1"><div className="flex items-center justify-between text-[6px] font-semibold text-[var(--text-secondary)]"><span>PROVĚŘENO —/—</span><span>— %</span></div><div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-[var(--surface-border)]"><i className="block h-full w-2/5 animate-pulse rounded-full bg-sky-500/70" /></div></div>
    <p className="mt-1 hidden text-center text-[7px] leading-3 text-[var(--text-secondary)] lg:block">Načítám dostupnou kapacitu…</p>
  </div>
  return <div className="-mt-2 min-w-0 lg:mt-0 xl:h-full">
    <p className="mb-2 flex items-center justify-center text-center text-[10px] text-[var(--text-secondary)] lg:hidden">{error ? 'Provozní data vyžadují opakované načtení.' : 'Načítám provozní panely…'}</p>
    <aside className="power-outages-mobile-aside-carousel grid min-w-0 auto-cols-[100%] grid-flow-col items-stretch gap-3 snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-[24px] lg:block lg:space-y-4 lg:overflow-visible lg:rounded-none">
      <div className="min-w-0 snap-start snap-always lg:snap-none"><section className={panelClass}>
        {header('KOMPLETNÍ SBĚR', 'Stav distributorů')}
        <div className="mt-3 grid min-h-0 flex-1 grid-rows-4 gap-2 lg:mt-4 lg:block lg:space-y-2">{sourceCard('ČEZ')}{sourceCard('ČEZ – NEW', true)}{sourceCard('EG.D')}{sourceCard('PRE')}</div>
        {error ? <button type="button" onClick={onRetry} title={error} className="mt-3 inline-flex h-7 items-center justify-center gap-1.5 self-center rounded-xl px-3 text-[8px] font-bold uppercase text-red-600 transition hover:-translate-y-px [html[data-theme=dark]_&]:text-red-300"><RefreshCw aria-hidden size={12} /> Zkusit znovu</button> : null}
      </section></div>
      <div className="min-w-0 snap-start snap-always lg:snap-none"><section className={panelClass}>
        {header('ARES · MAPY.COM · GOOGLE', 'Vyhledávání firem')}
        <div className="mt-3 grid min-h-0 flex-1 grid-rows-3 gap-2 lg:mt-4 lg:block lg:space-y-2.5">{providerCard('ARES')}{providerCard('GOOGLE')}{providerCard('MAPY.COM')}</div>
        <div className="mt-auto flex h-9 items-center justify-center gap-2 rounded-xl text-[8px] text-[var(--text-secondary)] lg:mt-3"><LoaderCircle aria-hidden size={12} className="animate-spin text-[var(--accent)]" /> Načítám stav procesů…</div>
      </section></div>
      <div className="min-w-0 snap-start snap-always lg:snap-none"><section className={panelClass}>
        {header('AKTUÁLNÍ ODSTÁVKY', 'Pokrytí adres')}
        <div className="mt-4 h-[88px] rounded-2xl border border-sky-400/25 bg-sky-500/8 p-3.5"><div className="flex items-end justify-between"><span><small className="block text-[7px] font-bold uppercase text-[var(--text-secondary)]">Normalizováno</small><strong className="mt-1 flex items-center gap-1.5 text-[10px] text-[var(--text-primary)]"><LoaderCircle aria-hidden size={11} className="animate-spin text-[var(--accent)]" /> Načítám</strong></span><strong className="text-2xl text-[var(--text-secondary)]">— %</strong></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-border)]"><i className="block h-full w-2/5 animate-pulse rounded-full bg-sky-500/70" /></div></div>
        <div className="mt-3 grid grid-cols-2 gap-1.5">{['Přesné', 'Širší rozsah', 'K pozornosti', 'Čeká'].map((label) => <span key={label} className="flex h-12 flex-col items-center justify-center rounded-xl border border-[var(--surface-border)] text-center"><small className="text-[6px] font-bold uppercase text-[var(--text-secondary)]">{label}</small><LoaderCircle aria-label={`Načítám ${label.toLowerCase()}`} size={11} className="mt-1 animate-spin text-[var(--accent)]" /></span>)}</div>
      </section></div>
    </aside>
  </div>
}

export function CompletePowerOutagesDashboard({ currentUser }: { currentUser: CompletePowerOutageCurrentUser }) {
  const [statistics, setStatistics] = useState<CompletePowerOutageStatistics | null>(null)
  const [statisticsError, setStatisticsError] = useState<string | null>(null)
  const [sidebar, setSidebar] = useState<CompletePowerOutageSidebarWorkspace | null>(null)
  const [sidebarError, setSidebarError] = useState<string | null>(null)
  const [owners, setOwners] = useState<Array<{ id: string; name: string }>>([])
  const statisticsLoading = useRef(false)
  const sidebarLoading = useRef(false)

  const loadStatistics = useCallback(async () => {
    if (statisticsLoading.current) return
    statisticsLoading.current = true
    setStatisticsError(null)
    try {
      const result = await getCompletePowerOutageStatisticsAction()
      if (result.success) setStatistics(result.statistics)
      else setStatisticsError(result.error)
    } finally {
      statisticsLoading.current = false
    }
  }, [])
  const loadSidebar = useCallback(async () => {
    if (sidebarLoading.current) return
    sidebarLoading.current = true
    setSidebarError(null)
    try {
      const result = await getCompletePowerOutageSidebarAction()
      if (result.success) setSidebar(result.workspace)
      else setSidebarError(result.error)
    } finally {
      sidebarLoading.current = false
    }
  }, [])

  useEffect(() => {
    // První stránka tabulky se načítá uvnitř CompletePowerOutageRecords. Souhrn
    // a základ pravého sloupce spouštíme ve stejném renderu, aby na sebe
    // jednotlivé části pracovního prostoru zbytečně nečekaly.
    void loadStatistics()
    void loadSidebar()
    const ownersTimer = window.setTimeout(() => { void getCompletePowerOutageOwnersAction().then((result) => { if (result.success) setOwners(result.owners) }) }, 250)
    const statisticsInterval = window.setInterval(() => { void loadStatistics() }, 90_000)
    const sidebarInterval = window.setInterval(() => { void loadSidebar() }, 60_000)
    return () => {
      window.clearTimeout(ownersTimer)
      window.clearInterval(statisticsInterval); window.clearInterval(sidebarInterval)
    }
  }, [loadSidebar, loadStatistics])

  const confirmedMatchCount = statistics ? Math.max(0, statistics.currentCompanyCount - statistics.needsReviewCount) : 0
  const cards: PowerOutageSummaryCard[] = [
    { label: 'AKTUÁLNÍ ODSTÁVKY', value: statistics?.currentOutageCount ?? null, tone: 'blue' },
    { label: 'NALEZENÉ SHODY', value: statistics?.currentCompanyCount ?? null, tone: 'violet' },
    { label: 'POTVRZENÉ SHODY', value: statistics ? confirmedMatchCount : null, tone: 'emerald', icon: 'check' },
    { label: 'K OVĚŘENÍ', value: statistics?.needsReviewCount ?? null, tone: 'amber', icon: 'review' },
  ]
  return <>
    <PowerOutageSummaryStats cards={cards} error={statisticsError} onRetry={() => void loadStatistics()} />
    <div className="grid items-start gap-5 xl:grid-cols-4 xl:items-stretch xl:gap-3">
      <CompletePowerOutageRecords currentUser={currentUser} owners={owners} />
      {sidebar ? <CompletePowerOutageSidebar workspace={sidebar} onRetry={() => void loadSidebar()} /> : <SidebarSkeleton error={sidebarError} onRetry={() => void loadSidebar()} />}
    </div>
  </>
}
