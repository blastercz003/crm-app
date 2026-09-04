'use client'

import { CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CompletePowerOutageCurrentUser, CompletePowerOutageSidebarWorkspace, CompletePowerOutageStatistics } from '@/lib/power-outages/complete-types'
import { getCompletePowerOutageOwnersAction, getCompletePowerOutageSidebarAction, getCompletePowerOutageStatisticsAction } from './actions'
import { CompletePowerOutageRecords } from './complete-power-outage-records'
import { CompletePowerOutageSidebar } from './complete-power-outage-sidebar'
import { PowerOutageSummaryStats, type PowerOutageSummaryCard } from './power-outage-summary-stats'

function SidebarSkeleton({ error, onRetry }: { error?: string | null; onRetry?: () => void }) {
  const panelClass = 'activities-page__panel flex h-[380px] min-w-0 flex-col rounded-[24px] border border-white/70 p-4 sm:p-5 lg:h-auto lg:min-h-[210px] lg:p-4'
  const header = (eyebrow: string, title: string) => <div className="flex items-center gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 ${error ? 'text-red-500' : 'text-[var(--accent)]'}`}>{error ? <CircleAlert aria-hidden size={18} /> : <LoaderCircle aria-label={`Načítám panel ${title}`} size={19} className="animate-spin" />}</span><span><small className="block text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">{eyebrow}</small><h3 className="text-base font-semibold text-[var(--text-primary)]">{title}</h3></span></div>
  const loadingClass = error ? '' : 'animate-pulse'
  return <div className="-mt-2 min-w-0 lg:mt-0 xl:h-full">
    <p className="mb-2 flex items-center justify-center text-center text-[10px] text-[var(--text-secondary)] lg:hidden">{error ? 'Provozní data vyžadují opakované načtení.' : 'Načítám provozní panely…'}</p>
    <aside className="power-outages-mobile-aside-carousel grid min-w-0 auto-cols-[100%] grid-flow-col items-stretch gap-3 snap-x snap-mandatory overflow-x-auto overflow-y-hidden rounded-[24px] lg:block lg:space-y-4 lg:overflow-visible lg:rounded-none">
      <div className="min-w-0 snap-start snap-always lg:snap-none"><section className={panelClass}>
        {header('KOMPLETNÍ SBĚR', 'Stav distributorů')}
        <div className="mt-3 flex min-h-0 flex-1 flex-col justify-between gap-2 lg:mt-4 lg:block lg:space-y-2">{Array.from({ length: 4 }, (_, index) => <div key={index} className={`h-[70px] rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] lg:h-[94px] ${loadingClass}`} />)}</div>
        {error ? <button type="button" onClick={onRetry} title={error} className="mt-3 inline-flex h-7 items-center justify-center gap-1.5 self-center rounded-xl px-3 text-[8px] font-bold uppercase text-red-600 transition hover:-translate-y-px [html[data-theme=dark]_&]:text-red-300"><RefreshCw aria-hidden size={12} /> Zkusit znovu</button> : null}
      </section></div>
      <div className="min-w-0 snap-start snap-always lg:snap-none"><section className={panelClass}>
        {header('ARES · MAPY.COM · GOOGLE', 'Vyhledávání firem')}
        <div className="mt-3 flex min-h-0 flex-1 flex-col justify-between gap-2.5 lg:mt-4 lg:block lg:space-y-2.5">{Array.from({ length: 3 }, (_, index) => <div key={index} className={`h-[84px] rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] lg:h-[108px] ${loadingClass}`} />)}</div>
        <div className={`mt-auto h-9 rounded-xl bg-[var(--surface-muted)] lg:mt-3 ${loadingClass}`} />
      </section></div>
      <div className="min-w-0 snap-start snap-always lg:snap-none"><section className={panelClass}>
        {header('DATABÁZE ADRES', 'Pokrytí adres')}
        <div className={`mt-4 h-[88px] rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] ${loadingClass}`} />
        <div className="mt-3 grid grid-cols-3 gap-1.5">{Array.from({ length: 3 }, (_, index) => <div key={index} className={`h-12 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] ${loadingClass}`} />)}</div>
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
