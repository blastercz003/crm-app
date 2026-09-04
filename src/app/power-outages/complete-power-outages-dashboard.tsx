'use client'

import { CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CompletePowerOutageCurrentUser, CompletePowerOutageSidebarWorkspace, CompletePowerOutageStatistics } from '@/lib/power-outages/complete-types'
import { getCompletePowerOutageOwnersAction, getCompletePowerOutageSidebarAction, getCompletePowerOutageStatisticsAction } from './actions'
import { CompletePowerOutageRecords } from './complete-power-outage-records'
import { CompletePowerOutageSidebar } from './complete-power-outage-sidebar'
import { PowerOutageSummaryStats, type PowerOutageSummaryCard } from './power-outage-summary-stats'

function DeferredError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="flex min-h-36 flex-col items-center justify-center rounded-[24px] border border-red-400/25 bg-red-500/5 px-5 text-center"><CircleAlert aria-hidden size={22} className="text-red-500" /><strong className="mt-2 text-xs text-[var(--text-primary)]">Tuto část se nepodařilo načíst</strong><span className="mt-1 max-w-lg text-[10px] leading-4 text-[var(--text-secondary)]">{message}</span><button type="button" onClick={onRetry} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-3 text-[8px] font-bold uppercase text-[var(--accent)] transition hover:-translate-y-px"><RefreshCw aria-hidden size={12} /> Zkusit znovu</button></div>
}

function SummarySkeleton() {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-[92px] animate-pulse rounded-[24px] border border-[var(--surface-border)] bg-[var(--surface-muted)]" />)}</div>
}

function SidebarSkeleton() {
  return <div className="min-h-[300px] animate-pulse rounded-[28px] border border-[var(--surface-border)] bg-[var(--surface-muted)] xl:h-full"><div className="flex h-full min-h-[300px] items-center justify-center"><span className="inline-flex items-center gap-2 text-[10px] font-semibold text-[var(--text-secondary)]"><LoaderCircle aria-hidden size={16} className="animate-spin text-[var(--accent)]" /> Načítám provozní panely…</span></div></div>
}

export function CompletePowerOutagesDashboard({ currentUser }: { currentUser: CompletePowerOutageCurrentUser }) {
  const [statistics, setStatistics] = useState<CompletePowerOutageStatistics | null>(null)
  const [statisticsError, setStatisticsError] = useState<string | null>(null)
  const [sidebar, setSidebar] = useState<CompletePowerOutageSidebarWorkspace | null>(null)
  const [sidebarError, setSidebarError] = useState<string | null>(null)
  const [owners, setOwners] = useState<Array<{ id: string; name: string }>>([])
  const [recordsReady, setRecordsReady] = useState(false)
  const statisticsLoading = useRef(false)
  const sidebarLoading = useRef(false)
  const handleRecordsReady = useCallback(() => setRecordsReady(true), [])

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
    const fallbackTimer = window.setTimeout(() => setRecordsReady(true), 5_000)
    return () => window.clearTimeout(fallbackTimer)
  }, [])

  useEffect(() => {
    if (!recordsReady) return
    const statisticsTimer = window.setTimeout(() => { void loadStatistics() }, 100)
    const sidebarTimer = window.setTimeout(() => { void loadSidebar() }, 450)
    const ownersTimer = window.setTimeout(() => { void getCompletePowerOutageOwnersAction().then((result) => { if (result.success) setOwners(result.owners) }) }, 800)
    const statisticsInterval = window.setInterval(() => { void loadStatistics() }, 90_000)
    const sidebarInterval = window.setInterval(() => { void loadSidebar() }, 60_000)
    return () => {
      window.clearTimeout(statisticsTimer); window.clearTimeout(sidebarTimer); window.clearTimeout(ownersTimer)
      window.clearInterval(statisticsInterval); window.clearInterval(sidebarInterval)
    }
  }, [loadSidebar, loadStatistics, recordsReady])

  const confirmedMatchCount = statistics ? Math.max(0, statistics.currentCompanyCount - statistics.needsReviewCount) : 0
  const cards: PowerOutageSummaryCard[] = statistics ? [
    { label: 'AKTUÁLNÍ ODSTÁVKY', value: statistics.currentOutageCount, tone: 'blue' },
    { label: 'NALEZENÉ SHODY', value: statistics.currentCompanyCount, tone: 'violet' },
    { label: 'POTVRZENÉ SHODY', value: confirmedMatchCount, tone: 'emerald', icon: 'check' },
    { label: 'K OVĚŘENÍ', value: statistics.needsReviewCount, tone: 'amber', icon: 'review' },
  ] : []
  return <>
    {statistics ? <PowerOutageSummaryStats cards={cards} /> : statisticsError ? <DeferredError message={statisticsError} onRetry={() => void loadStatistics()} /> : <SummarySkeleton />}
    <div className="grid items-start gap-5 xl:grid-cols-4 xl:items-stretch xl:gap-3">
      <CompletePowerOutageRecords currentUser={currentUser} owners={owners} onInitialLoad={handleRecordsReady} />
      {sidebar ? <CompletePowerOutageSidebar workspace={sidebar} /> : sidebarError ? <DeferredError message={sidebarError} onRetry={() => void loadSidebar()} /> : <SidebarSkeleton />}
    </div>
  </>
}
