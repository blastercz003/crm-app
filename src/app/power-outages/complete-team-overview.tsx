'use client'

import {
  BarChart3,
  BriefcaseBusiness,
  CalendarClock,
  ChevronDown,
  CircleAlert,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  RefreshCw,
  Target,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  CompletePowerOutageCurrentUser,
  CompleteTeamOverview,
  CompleteTeamOverviewFilters,
  CompleteTeamOverviewPeriodBasis,
  CompleteTeamOverviewRecord,
  CompleteTeamOverviewRecordPage,
  CompleteTeamOverviewSection,
  CompleteTeamOverviewSelectorKey,
} from '@/lib/power-outages/complete-types'
import { getCompletePowerOutageOwnersAction, getCompletePowerOutageTeamOverviewAction, getCompletePowerOutageTeamRecordsAction } from './actions'
import { PowerOutagePopupShell } from './power-outage-popups'

const selectorOptions: Array<{ value: CompleteTeamOverviewSelectorKey; label: string }> = [
  { value: 'all_confirmed', label: 'VŠECHNY POTVRZENÉ' },
  { value: 'top_v1', label: 'TOP VÝBĚR' },
  { value: 'large_companies', label: 'VELKÉ FIRMY' },
  { value: 'grade_a', label: 'POUZE A' },
  { value: 'grade_b', label: 'POUZE B' },
]

type OverviewPeriodView = 'week' | 'month' | 'year'

const periodViewOptions: Array<{ value: OverviewPeriodView; label: string }> = [
  { value: 'week', label: 'TÝDEN' },
  { value: 'month', label: 'MĚSÍC' },
  { value: 'year', label: 'ROK' },
]

function calendarDateValue(date: Date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getPragueToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function parseCalendarDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function calendarPeriod(view: OverviewPeriodView, anchorValue: string) {
  const anchor = parseCalendarDate(anchorValue)
  if (view === 'year') {
    return {
      from: calendarDateValue(new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1))),
      to: calendarDateValue(new Date(Date.UTC(anchor.getUTCFullYear(), 11, 31))),
    }
  }
  if (view === 'month') {
    return {
      from: calendarDateValue(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))),
      to: calendarDateValue(new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0))),
    }
  }
  const weekday = anchor.getUTCDay() || 7
  const from = new Date(anchor)
  from.setUTCDate(anchor.getUTCDate() - weekday + 1)
  const to = new Date(from)
  to.setUTCDate(from.getUTCDate() + 6)
  return { from: calendarDateValue(from), to: calendarDateValue(to) }
}

function shiftedPeriodAnchor(view: OverviewPeriodView, anchorValue: string, direction: -1 | 1) {
  const current = calendarPeriod(view, anchorValue)
  const anchor = parseCalendarDate(current.from)
  if (view === 'week') anchor.setUTCDate(anchor.getUTCDate() + direction * 7)
  else if (view === 'month') anchor.setUTCMonth(anchor.getUTCMonth() + direction)
  else anchor.setUTCFullYear(anchor.getUTCFullYear() + direction)
  return calendarDateValue(anchor)
}

function formatCalendarPeriod(view: OverviewPeriodView, range: { from: string; to: string }) {
  const from = parseCalendarDate(range.from)
  const to = parseCalendarDate(range.to)
  if (view === 'year') return new Intl.DateTimeFormat('cs-CZ', { year: 'numeric', timeZone: 'UTC' }).format(from)
  if (view === 'month') return new Intl.DateTimeFormat('cs-CZ', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(from)
  const fromLabel = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(from)
  const toLabel = new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(to)
  return `${fromLabel} – ${toLabel}`
}

function toIsoRange(from: string, to: string) {
  const periodFrom = new Date(`${from}T00:00:00`)
  const periodTo = new Date(`${to}T00:00:00`)
  periodTo.setDate(periodTo.getDate() + 1)
  return { periodFrom: periodFrom.toISOString(), periodTo: periodTo.toISOString() }
}

function formatTimestamp(value: string | null) {
  if (!value) return 'Bez aktivity'
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

function communicationLabel(status: CompleteTeamOverviewRecord['communicationStatus']) {
  return ({
    not_contacted: 'NEOSLOVENO', contacted: 'OSLOVENO', unreachable: 'NEZASTIŽENO',
    interested: 'PROJEVEN ZÁJEM', offer_sent: 'NABÍDKA ODESLÁNA',
    job_won: 'ZAKÁZKA VZNIKLA', closed_no_job: 'UZAVŘENO BEZ ZAKÁZKY',
  } as const)[status]
}

function attentionLabel(reason: CompleteTeamOverviewRecord['attentionReason']) {
  return ({
    overdue_follow_up: 'Připomínka je po termínu',
    past_outage_open: 'Odstávka skončila, komunikace zůstala otevřená',
    missing_follow_up: 'Zájem nebo nabídka nemá naplánovaný další krok',
    approaching_uncontacted: 'Odstávka začíná do 72 hodin a firma nebyla oslovena',
    stale_communication: 'Komunikace je déle než 7 dní bez aktivity',
  } as const)[reason ?? 'stale_communication']
}

function MetricCard({ label, value, detail, tone, icon: Icon }: {
  label: string
  value: number
  detail: string
  tone: 'sky' | 'violet' | 'emerald' | 'amber'
  icon: typeof Target
}) {
  const tones = {
    sky: 'border-sky-400/25 bg-sky-500/8 text-sky-600 [html[data-theme=dark]_&]:text-sky-300',
    violet: 'border-violet-400/25 bg-violet-500/8 text-violet-600 [html[data-theme=dark]_&]:text-violet-300',
    emerald: 'border-emerald-400/25 bg-emerald-500/8 text-emerald-600 [html[data-theme=dark]_&]:text-emerald-300',
    amber: 'border-amber-400/25 bg-amber-500/8 text-amber-700 [html[data-theme=dark]_&]:text-amber-300',
  }
  return <article className={`rounded-2xl border p-3.5 ${tones[tone]}`}>
    <div className="flex items-start justify-between gap-3"><span><small className="block text-[8px] font-bold uppercase tracking-[0.09em] text-[var(--text-secondary)]">{label}</small><strong className="mt-1.5 block text-2xl tabular-nums text-[var(--text-primary)]">{value.toLocaleString('cs-CZ')}</strong></span><Icon aria-hidden size={17} /></div>
    <p className="mt-2 text-[8px] leading-4 text-[var(--text-secondary)]">{detail}</p>
  </article>
}

function OverviewSkeleton() {
  return <div className="space-y-4" aria-label="Načítám přehled týmu">
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-[106px] animate-pulse rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)]" />)}</div>
    <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]"><div className="h-64 animate-pulse rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)]" /><div className="h-64 animate-pulse rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)]" /></div>
  </div>
}

function CompleteTeamOverviewPopup({ currentUser, onClose }: { currentUser: CompletePowerOutageCurrentUser; onClose: () => void }) {
  const [periodView, setPeriodView] = useState<OverviewPeriodView>('month')
  const [periodAnchor, setPeriodAnchor] = useState(getPragueToday)
  const dateRange = useMemo(() => calendarPeriod(periodView, periodAnchor), [periodAnchor, periodView])
  const [periodBasis, setPeriodBasis] = useState<CompleteTeamOverviewPeriodBasis>('activity')
  const [ownerId, setOwnerId] = useState('all')
  const [selectorKey, setSelectorKey] = useState<CompleteTeamOverviewSelectorKey>('all_confirmed')
  const [source, setSource] = useState<CompleteTeamOverviewFilters['source']>('all')
  const [owners, setOwners] = useState<Array<{ id: string; name: string }>>([{ id: currentUser.id, name: currentUser.name }])
  const [overview, setOverview] = useState<CompleteTeamOverview | null>(null)
  const [section, setSection] = useState<CompleteTeamOverviewSection>('attention')
  const [recordPage, setRecordPage] = useState<CompleteTeamOverviewRecordPage | null>(null)
  const [recordOffset, setRecordOffset] = useState(0)
  const [recordsLoading, setRecordsLoading] = useState(true)
  const [recordsError, setRecordsError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const range = toIsoRange(dateRange.from, dateRange.to)
    const result = await getCompletePowerOutageTeamOverviewAction({
      ...range,
      periodBasis,
      ownerId: ownerId === 'all' ? null : ownerId,
      selectorKey,
      source,
    })
    if (result.success) setOverview(result.overview)
    else setError(result.error)
    setLoading(false)
  }, [dateRange.from, dateRange.to, ownerId, periodBasis, selectorKey, source])

  const currentFilters = useMemo<CompleteTeamOverviewFilters>(() => ({
    ...toIsoRange(dateRange.from, dateRange.to),
    periodBasis,
    ownerId: ownerId === 'all' ? null : ownerId,
    selectorKey,
    source,
  }), [dateRange.from, dateRange.to, ownerId, periodBasis, selectorKey, source])

  const loadRecords = useCallback(async () => {
    setRecordsLoading(true)
    setRecordsError(null)
    const result = await getCompletePowerOutageTeamRecordsAction({ filters: currentFilters, section, limit: 10, offset: recordOffset })
    if (result.success) setRecordPage(result.records)
    else setRecordsError(result.error)
    setRecordsLoading(false)
  }, [currentFilters, recordOffset, section])

  useEffect(() => {
    void getCompletePowerOutageOwnersAction().then((result) => {
      if (!result.success) return
      setOwners([...new Map([{ id: currentUser.id, name: currentUser.name }, ...result.owners]
        .map((owner) => [owner.id, owner] as const)).values()])
    })
  }, [currentUser.id, currentUser.name])

  useEffect(() => {
    const timer = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadRecords() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadRecords])

  const inputClass = 'h-10 w-full rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-3 text-[10px] font-semibold text-[var(--text-primary)] outline-none focus:border-sky-400'
  const funnel = overview ? [
    { label: 'OSLOVENO', value: overview.funnel.contacted, color: 'bg-sky-500' },
    { label: 'PROJEVEN ZÁJEM', value: overview.funnel.interested, color: 'bg-cyan-500' },
    { label: 'NABÍDKA ODESLÁNA', value: overview.funnel.offerSent, color: 'bg-violet-500' },
    { label: 'ZAKÁZKA VZNIKLA', value: overview.funnel.jobWon, color: 'bg-emerald-500' },
  ] : []
  const otherResults = overview ? [
    { label: 'NEZASTIŽENO', value: overview.funnel.unreachable, color: 'bg-amber-500' },
    { label: 'BEZ ZAKÁZKY', value: overview.funnel.closedNoJob, color: 'bg-slate-500' },
  ] : []
  const funnelMaximum = Math.max(1, ...funnel.map((item) => item.value), ...otherResults.map((item) => item.value))
  const openCandidate = (candidateId: string, mode: 'detail' | 'assignment') => {
    onClose()
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('complete-power-outage:open-candidate', {
      detail: { candidateId, mode },
    })), 180)
  }
  const sections: Array<{ value: CompleteTeamOverviewSection; label: string; count: number | null }> = [
    { value: 'attention', label: 'VYŽADUJE POZORNOST', count: section === 'attention' && recordPage ? recordPage.totalCount : null },
    { value: 'active', label: 'ROZPRACOVANÉ', count: overview?.summary.activeAssignmentCount ?? null },
    { value: 'reminders', label: 'PŘIPOMÍNKY', count: overview?.summary.plannedFollowUpCount ?? null },
    { value: 'outcomes', label: 'VZNIKLÉ ZAKÁZKY', count: overview?.summary.jobWonCount ?? null },
  ]

  return <PowerOutagePopupShell wide titleId="complete-team-overview" eyebrow="KOMPLETNÍ · ADMINISTRÁTORSKÝ PŘEHLED" title="Přehled týmu" icon={<UsersRound aria-hidden size={21} />} onClose={onClose}>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
      <section className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><span><small className="block text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Rozsah přehledu</small><strong className="mt-1 block text-[12px] text-[var(--text-primary)]">Výsledky, práce a návazné kroky týmu</strong></span><button type="button" disabled={loading} onClick={() => void load()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-500/10 px-2.5 text-[8px] font-bold uppercase text-sky-700 transition hover:-translate-y-px disabled:opacity-50 [html[data-theme=dark]_&]:text-sky-300"><RefreshCw aria-hidden size={11} className={loading ? 'animate-spin' : ''} />Obnovit</button></div>
        <div className="mt-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] p-1.5 sm:p-2">
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
            <div className="grid grid-cols-3 rounded-lg bg-[var(--surface-muted)] p-1 lg:w-[300px]">{periodViewOptions.map((option) => <button key={option.value} type="button" aria-pressed={periodView === option.value} onClick={() => { setPeriodView(option.value); setRecordOffset(0) }} className={`h-8 rounded-md px-2 text-[8px] font-bold uppercase tracking-[0.06em] transition ${periodView === option.value ? 'bg-sky-500 text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>{option.label}</button>)}</div>
            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
              <button type="button" onClick={() => { setPeriodAnchor((current) => shiftedPeriodAnchor(periodView, current, -1)); setRecordOffset(0) }} aria-label="Předchozí období" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] transition hover:-translate-y-px hover:text-[var(--text-primary)]"><ChevronLeft aria-hidden size={13} /></button>
              <strong className="min-w-0 flex-1 text-center text-[10px] font-semibold capitalize text-[var(--text-primary)] sm:min-w-[180px] sm:flex-none">{formatCalendarPeriod(periodView, dateRange)}</strong>
              <button type="button" onClick={() => { setPeriodAnchor((current) => shiftedPeriodAnchor(periodView, current, 1)); setRecordOffset(0) }} aria-label="Následující období" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] transition hover:-translate-y-px hover:text-[var(--text-primary)]"><ChevronRight aria-hidden size={13} /></button>
              <button type="button" onClick={() => { setPeriodAnchor(getPragueToday()); setRecordOffset(0) }} className="h-8 shrink-0 rounded-lg border border-sky-400/30 bg-sky-500/10 px-2.5 text-[8px] font-bold uppercase text-sky-700 transition hover:-translate-y-px [html[data-theme=dark]_&]:text-sky-300">Dnes</button>
            </div>
          </div>
        </div>
        <div className="mt-3 grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex flex-col text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]"><span className="h-2.5 leading-none">Uživatel</span><span className="relative mt-1.5 block"><select value={ownerId} onChange={(event) => { setOwnerId(event.target.value); setRecordOffset(0) }} className={`${inputClass} appearance-none pr-8 [-webkit-appearance:none]`}><option value="all">CELÝ TÝM</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select><ChevronDown aria-hidden size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" /></span></label>
          <label className="flex flex-col text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]"><span className="h-2.5 leading-none">AI SELECT</span><span className="relative mt-1.5 block"><select value={selectorKey} onChange={(event) => { setSelectorKey(event.target.value as CompleteTeamOverviewSelectorKey); setRecordOffset(0) }} className={`${inputClass} appearance-none pr-8 [-webkit-appearance:none]`}>{selectorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown aria-hidden size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" /></span></label>
          <label className="flex flex-col text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]"><span className="h-2.5 leading-none">Distributor</span><span className="relative mt-1.5 block"><select value={source} onChange={(event) => { setSource(event.target.value as CompleteTeamOverviewFilters['source']); setRecordOffset(0) }} className={`${inputClass} appearance-none pr-8 [-webkit-appearance:none]`}><option value="all">VŠICHNI</option><option value="cez">ČEZ</option><option value="egd">EG.D</option><option value="pre">PRE</option></select><ChevronDown aria-hidden size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" /></span></label>
          <div className="flex flex-col"><span className="h-2.5 text-[8px] font-bold uppercase leading-none tracking-[0.07em] text-[var(--text-secondary)]">Časový základ</span><div className="mt-1.5 grid h-10 grid-cols-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] p-1">{([{ value: 'activity', label: 'AKTIVITY TÝMU' }, { value: 'outage', label: 'TERMÍN ODSTÁVKY' }] as const).map((option) => <button key={option.value} type="button" onClick={() => { setPeriodBasis(option.value); setRecordOffset(0) }} className={`rounded-lg px-1 text-[7px] font-bold uppercase transition ${periodBasis === option.value ? 'bg-sky-500 text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>{option.label}</button>)}</div></div>
        </div>
      </section>

      {error ? <div className="mt-4 rounded-2xl border border-red-400/30 bg-red-400/10 p-4"><p className="flex items-center gap-2 text-[10px] text-red-700 [html[data-theme=dark]_&]:text-red-300"><CircleAlert aria-hidden size={15} />{error}</p><button type="button" onClick={() => void load()} className="mt-3 text-[8px] font-bold uppercase text-red-700 underline [html[data-theme=dark]_&]:text-red-300">Zkusit znovu</button></div> : loading || !overview ? <div className="mt-4"><OverviewSkeleton /></div> : <>
        <section className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <MetricCard label="ROZPRACOVÁNO" value={overview.summary.activeAssignmentCount} detail={`${overview.summary.assignedUserCount} aktivních uživatelů`} tone="sky" icon={UserRoundCheck} />
          <MetricCard label="OSLOVENO" value={overview.summary.contactedCount} detail={`Z ${overview.summary.recordCount.toLocaleString('cs-CZ')} záznamů ve výběru`} tone="violet" icon={Target} />
          <MetricCard label="VZNIKLÉ ZAKÁZKY" value={overview.summary.jobWonCount} detail="Připsáno uživateli, který výsledek zaznamenal" tone="emerald" icon={BriefcaseBusiness} />
          <MetricCard label="PO TERMÍNU" value={overview.summary.overdueFollowUpCount} detail={`${overview.summary.plannedFollowUpCount.toLocaleString('cs-CZ')} aktuálně naplánovaných kroků`} tone="amber" icon={CalendarClock} />
        </section>

        <div className="mt-4 grid gap-4 lg:grid-cols-[1.35fr_1fr]">
          <section className="overflow-hidden rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)]">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--surface-border)] px-4 py-3"><span><small className="block text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Výsledky podle uživatele</small><strong className="mt-0.5 block text-[11px] text-[var(--text-primary)]">Aktuální práce a výsledky za období</strong></span><UsersRound aria-hidden size={16} className="text-[var(--accent)]" /></div>
            <div className="hidden overflow-hidden sm:block"><table className="w-full table-fixed text-left"><colgroup><col className="w-[27%]" /><col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[10%]" /><col className="w-[12%]" /><col className="w-[12%]" /><col className="w-[15%]" /></colgroup><thead><tr className="text-[6.5px] font-bold uppercase tracking-[0.035em] text-[var(--text-secondary)]"><th className="px-3 py-2.5">Uživatel</th><th className="px-1 py-2.5 text-right">Rozprac.</th><th className="px-1 py-2.5 text-right">Osloveno</th><th className="px-1 py-2.5 text-right">Zájem</th><th className="px-1 py-2.5 text-right">Nabídky</th><th className="px-1 py-2.5 text-right">Zakázky</th><th className="px-3 py-2.5 text-right">Konverze</th></tr></thead><tbody>{overview.users.length ? overview.users.map((user) => <tr key={user.userId} className="border-t border-[var(--surface-border)] text-[9px] text-[var(--text-primary)]"><td className="min-w-0 px-3 py-3"><strong className="block truncate">{user.userName}</strong><small className="mt-0.5 block truncate text-[6.5px] text-[var(--text-secondary)]">{formatTimestamp(user.lastActivityAt)}{user.overdueCount ? ` · ${user.overdueCount} po termínu` : ''}</small></td><td className="px-1 py-3 text-right tabular-nums">{user.activeCount}</td><td className="px-1 py-3 text-right tabular-nums">{user.contactedCount}</td><td className="px-1 py-3 text-right tabular-nums">{user.interestedCount}</td><td className="px-1 py-3 text-right tabular-nums">{user.offerSentCount}</td><td className="px-1 py-3 text-right font-bold tabular-nums text-emerald-600">{user.jobWonCount}</td><td className="px-3 py-3 text-right font-bold tabular-nums">{user.conversionPercent.toLocaleString('cs-CZ')} %</td></tr>) : <tr><td colSpan={7} className="px-4 py-8 text-center text-[9px] text-[var(--text-secondary)]">Ve zvoleném období zatím není evidována aktivita týmu.</td></tr>}</tbody></table></div>
            <div className="divide-y divide-[var(--surface-border)] sm:hidden">{overview.users.length ? overview.users.map((user) => <article key={user.userId} className="p-3"><div className="min-w-0"><strong className="block truncate text-[10px] text-[var(--text-primary)]">{user.userName}</strong><small className="mt-0.5 block truncate text-[7px] text-[var(--text-secondary)]">{formatTimestamp(user.lastActivityAt)}{user.overdueCount ? ` · ${user.overdueCount} po termínu` : ''}</small></div><div className="mt-3 grid grid-cols-3 gap-x-3 gap-y-2">{[
              ['ROZPRAC.', user.activeCount], ['OSLOVENO', user.contactedCount], ['ZÁJEM', user.interestedCount],
              ['NABÍDKY', user.offerSentCount], ['ZAKÁZKY', user.jobWonCount], ['KONVERZE', `${user.conversionPercent.toLocaleString('cs-CZ')} %`],
            ].map(([label, value]) => <span key={label} className="min-w-0"><small className="block truncate text-[6px] font-bold uppercase tracking-[0.04em] text-[var(--text-secondary)]">{label}</small><strong className={`mt-0.5 block text-[10px] tabular-nums ${label === 'ZAKÁZKY' ? 'text-emerald-600' : 'text-[var(--text-primary)]'}`}>{value}</strong></span>)}</div></article>) : <p className="px-4 py-8 text-center text-[9px] text-[var(--text-secondary)]">Ve zvoleném období zatím není evidována aktivita týmu.</p>}</div>
          </section>

          <section className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-4">
            <div className="flex items-start justify-between gap-3"><span><small className="block text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Komunikační funnel</small><strong className="mt-0.5 block text-[11px] text-[var(--text-primary)]">Postup obchodní komunikace</strong></span><BarChart3 aria-hidden size={16} className="text-[var(--accent)]" /></div>
            <div className="mt-4 space-y-4">{funnel.map((item) => <div key={item.label}><div className="flex items-center justify-between gap-3"><small className="text-[7px] font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)]">{item.label}</small><strong className="text-[11px] tabular-nums text-[var(--text-primary)]">{item.value.toLocaleString('cs-CZ')}</strong></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-border)]"><span className={`block h-full min-w-[3px] rounded-full ${item.color}`} style={{ width: `${item.value === 0 ? 0 : Math.max(4, item.value / funnelMaximum * 100)}%` }} /></div></div>)}</div>
            <div className="my-4 flex items-center gap-3"><span className="h-px flex-1 bg-[var(--surface-border)]" /><small className="shrink-0 text-[7px] font-bold uppercase tracking-[0.09em] text-[var(--text-secondary)]">Ostatní výsledky</small><span className="h-px flex-1 bg-[var(--surface-border)]" /></div>
            <div className="space-y-4">{otherResults.map((item) => <div key={item.label}><div className="flex items-center justify-between gap-3"><small className="text-[7px] font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)]">{item.label}</small><strong className="text-[11px] tabular-nums text-[var(--text-primary)]">{item.value.toLocaleString('cs-CZ')}</strong></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-border)]"><span className={`block h-full min-w-[3px] rounded-full ${item.color}`} style={{ width: `${item.value === 0 ? 0 : Math.max(4, item.value / funnelMaximum * 100)}%` }} /></div></div>)}</div>
          </section>
        </div>

        <section className="mt-4 overflow-hidden rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)]">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--surface-border)] px-4 py-3"><span><small className="block text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Pracovní seznamy</small><strong className="mt-0.5 block text-[11px] text-[var(--text-primary)]">Konkrétní záznamy navazující na souhrn</strong></span><ClipboardList aria-hidden size={16} className="text-[var(--accent)]" /></div>
          <div className="grid grid-cols-2 gap-1 border-b border-[var(--surface-border)] p-2 lg:grid-cols-4">{sections.map((option) => <button key={option.value} type="button" onClick={() => { setSection(option.value); setRecordOffset(0) }} className={`min-h-9 rounded-xl px-2 text-[7px] font-bold uppercase transition ${section === option.value ? 'bg-sky-500 text-white shadow-sm' : 'text-[var(--text-secondary)] hover:bg-[var(--surface-strong)] hover:text-[var(--text-primary)]'}`}>{option.label}{option.count !== null ? ` · ${option.count}` : ''}</button>)}</div>
          {recordsError ? <div className="m-3 rounded-xl border border-red-400/25 bg-red-400/8 px-3 py-3 text-[9px] text-red-700 [html[data-theme=dark]_&]:text-red-300">{recordsError}<button type="button" onClick={() => void loadRecords()} className="ml-2 font-bold underline">Zkusit znovu</button></div> : recordsLoading || !recordPage ? <div className="space-y-2 p-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-[74px] animate-pulse rounded-xl bg-[var(--surface-strong)]" />)}</div> : <>
            <div className="divide-y divide-[var(--surface-border)]">{recordPage.items.length ? recordPage.items.map((item) => <article key={item.candidateId} className="grid gap-3 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong className="truncate text-[11px] text-[var(--text-primary)]">{item.companyName}</strong><span className="rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] px-2 py-0.5 text-[7px] font-bold text-[var(--accent)]">{item.source === 'cez' ? 'ČEZ' : item.source === 'egd' ? 'EG.D' : 'PRE'}</span><span className="rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] px-2 py-0.5 text-[7px] font-bold text-[var(--text-secondary)]">{communicationLabel(item.communicationStatus)}</span></div><p className="mt-1 text-[8px] text-[var(--text-secondary)]">{item.ico ? `IČO ${item.ico} · ` : ''}odstávka {formatTimestamp(item.outageStartsAt)}{item.ownerName ? ` · řeší ${item.ownerName}` : ' · nepřiřazeno'}</p>{section === 'attention' && item.attentionReason ? <p className="mt-1.5 text-[8px] font-semibold text-amber-700 [html[data-theme=dark]_&]:text-amber-300">{attentionLabel(item.attentionReason)}</p> : null}{section === 'reminders' ? <p className={`mt-1.5 text-[8px] font-semibold ${item.followUpStatus === 'planned' && item.scheduledFor && new Date(item.scheduledFor) < new Date() ? 'text-red-600 [html[data-theme=dark]_&]:text-red-300' : 'text-sky-700 [html[data-theme=dark]_&]:text-sky-300'}`}>{item.followUpStatus === 'completed' ? `Dokončeno ${formatTimestamp(item.completedAt)}` : `Naplánováno ${formatTimestamp(item.scheduledFor)}${item.followUpOwnerName ? ` · ${item.followUpOwnerName}` : ''}`}</p> : null}{section === 'outcomes' ? <p className="mt-1.5 text-[8px] font-semibold text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300">Zakázku zaznamenal {item.jobWonByName ?? 'uživatel'} · {formatTimestamp(item.jobWonAt)}</p> : null}</div>
              <div className="flex gap-2"><button type="button" onClick={() => openCandidate(item.candidateId, 'assignment')} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-500/10 px-2.5 text-[7px] font-bold uppercase text-sky-700 transition hover:-translate-y-px sm:flex-none [html[data-theme=dark]_&]:text-sky-300"><ClipboardList aria-hidden size={11} />Komunikace</button><button type="button" onClick={() => openCandidate(item.candidateId, 'detail')} aria-label={`Otevřít detail ${item.companyName}`} title="Detail firmy a odstávky" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--surface-border)] bg-[var(--surface-strong)] text-[var(--accent)] transition hover:-translate-y-px"><Eye aria-hidden size={12} /></button></div>
            </article>) : <p className="px-4 py-8 text-center text-[9px] text-[var(--text-secondary)]">Ve zvoleném rozsahu nejsou žádné odpovídající záznamy.</p>}</div>
            <div className="flex items-center justify-between gap-3 border-t border-[var(--surface-border)] px-4 py-3"><span className="text-[8px] text-[var(--text-secondary)]">{recordPage.totalCount ? `${recordPage.offset + 1}–${Math.min(recordPage.offset + recordPage.items.length, recordPage.totalCount)} z ${recordPage.totalCount}` : '0 záznamů'}</span><div className="flex gap-1.5"><button type="button" disabled={recordPage.offset === 0} onClick={() => setRecordOffset(Math.max(0, recordPage.offset - recordPage.limit))} aria-label="Předchozí stránka" className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--surface-border)] bg-[var(--surface-strong)] text-[var(--text-secondary)] disabled:opacity-35"><ChevronLeft aria-hidden size={13} /></button><button type="button" disabled={!recordPage.hasMore} onClick={() => setRecordOffset(recordPage.offset + recordPage.limit)} aria-label="Další stránka" className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--surface-border)] bg-[var(--surface-strong)] text-[var(--text-secondary)] disabled:opacity-35"><ChevronRight aria-hidden size={13} /></button></div></div>
          </>}
        </section>
        <p className="mt-3 text-right text-[7px] text-[var(--text-secondary)]">Aktualizováno {formatTimestamp(overview.generatedAt)}</p>
      </>}
    </div>
  </PowerOutagePopupShell>
}

export function CompleteTeamOverviewButton({ currentUser }: { currentUser: CompletePowerOutageCurrentUser }) {
  const [open, setOpen] = useState(false)
  if (!currentUser.isAdmin) return null
  return <>
    <button type="button" onClick={() => setOpen(true)} className="faktury-page__statistics-button inline-flex items-center justify-center whitespace-nowrap rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.3),0_10px_20px_rgba(24,78,129,0.28)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.36),0_14px_28px_rgba(24,78,129,0.34)] [html[data-theme='dark']_&]:border-[rgba(84,170,232,0.38)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(38,91,140,0.92)_0%,rgba(25,63,103,0.94)_100%)] [html[data-theme='dark']_&]:text-[#f5fbff] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_10px_22px_rgba(0,0,0,0.24)]">PŘEHLED TÝMU</button>
    {open && typeof document !== 'undefined' ? createPortal(<CompleteTeamOverviewPopup currentUser={currentUser} onClose={() => setOpen(false)} />, document.body) : null}
  </>
}
