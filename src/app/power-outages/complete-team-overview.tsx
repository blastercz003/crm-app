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

function localDateInput(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function initialDateRange() {
  const to = new Date()
  const from = new Date(to)
  from.setDate(from.getDate() - 29)
  return { from: localDateInput(from), to: localDateInput(to) }
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
  const initial = useMemo(() => initialDateRange(), [])
  const [dateFrom, setDateFrom] = useState(initial.from)
  const [dateTo, setDateTo] = useState(initial.to)
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
    const range = toIsoRange(dateFrom, dateTo)
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
  }, [dateFrom, dateTo, ownerId, periodBasis, selectorKey, source])

  const currentFilters = useMemo<CompleteTeamOverviewFilters>(() => ({
    ...toIsoRange(dateFrom, dateTo),
    periodBasis,
    ownerId: ownerId === 'all' ? null : ownerId,
    selectorKey,
    source,
  }), [dateFrom, dateTo, ownerId, periodBasis, selectorKey, source])

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
  const funnelMaximum = Math.max(1, ...funnel.map((item) => item.value))
  const openCandidate = (candidateId: string, mode: 'detail' | 'assignment') => {
    onClose()
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('complete-power-outage:open-candidate', {
      detail: { candidateId, mode },
    })), 180)
  }
  const sections: Array<{ value: CompleteTeamOverviewSection; label: string; count: number | null }> = [
    { value: 'attention', label: 'VYŽADUJE POZORNOST', count: overview?.summary.overdueFollowUpCount ?? null },
    { value: 'active', label: 'ROZPRACOVANÉ', count: overview?.summary.activeAssignmentCount ?? null },
    { value: 'reminders', label: 'PŘIPOMÍNKY', count: overview?.summary.plannedFollowUpCount ?? null },
    { value: 'outcomes', label: 'VZNIKLÉ ZAKÁZKY', count: overview?.summary.jobWonCount ?? null },
  ]

  return <PowerOutagePopupShell wide titleId="complete-team-overview" eyebrow="KOMPLETNÍ · ADMINISTRÁTORSKÝ PŘEHLED" title="Přehled týmu" icon={<UsersRound aria-hidden size={21} />} onClose={onClose}>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
      <section className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3"><span><small className="block text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Rozsah přehledu</small><strong className="mt-1 block text-[12px] text-[var(--text-primary)]">Výsledky, práce a návazné kroky týmu</strong></span><button type="button" disabled={loading} onClick={() => void load()} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-sky-400/30 bg-sky-500/10 px-2.5 text-[8px] font-bold uppercase text-sky-700 transition hover:-translate-y-px disabled:opacity-50 [html[data-theme=dark]_&]:text-sky-300"><RefreshCw aria-hidden size={11} className={loading ? 'animate-spin' : ''} />Obnovit</button></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]">Od<input type="date" value={dateFrom} max={dateTo} onChange={(event) => { setDateFrom(event.target.value); setRecordOffset(0) }} className={`${inputClass} mt-1.5`} /></label>
          <label className="text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]">Do<input type="date" value={dateTo} min={dateFrom} onChange={(event) => { setDateTo(event.target.value); setRecordOffset(0) }} className={`${inputClass} mt-1.5`} /></label>
          <label className="text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]">Uživatel<span className="relative mt-1.5 block"><select value={ownerId} onChange={(event) => { setOwnerId(event.target.value); setRecordOffset(0) }} className={`${inputClass} appearance-none pr-8 [-webkit-appearance:none]`}><option value="all">CELÝ TÝM</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</select><ChevronDown aria-hidden size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" /></span></label>
          <label className="text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]">AI SELECT<span className="relative mt-1.5 block"><select value={selectorKey} onChange={(event) => { setSelectorKey(event.target.value as CompleteTeamOverviewSelectorKey); setRecordOffset(0) }} className={`${inputClass} appearance-none pr-8 [-webkit-appearance:none]`}>{selectorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown aria-hidden size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" /></span></label>
          <label className="text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]">Distributor<span className="relative mt-1.5 block"><select value={source} onChange={(event) => { setSource(event.target.value as CompleteTeamOverviewFilters['source']); setRecordOffset(0) }} className={`${inputClass} appearance-none pr-8 [-webkit-appearance:none]`}><option value="all">VŠICHNI</option><option value="cez">ČEZ</option><option value="egd">EG.D</option><option value="pre">PRE</option></select><ChevronDown aria-hidden size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" /></span></label>
        </div>
        <div className="mt-3 grid grid-cols-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] p-1 sm:w-[360px]">{([{ value: 'activity', label: 'PODLE AKTIVITY' }, { value: 'outage', label: 'PODLE ODSTÁVKY' }] as const).map((option) => <button key={option.value} type="button" onClick={() => { setPeriodBasis(option.value); setRecordOffset(0) }} className={`h-8 rounded-lg text-[8px] font-bold uppercase transition ${periodBasis === option.value ? 'bg-sky-500 text-white shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>{option.label}</button>)}</div>
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
            <div className="overflow-x-auto"><table className="w-full min-w-[650px] text-left"><thead><tr className="text-[7px] font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)]"><th className="px-4 py-2.5">Uživatel</th><th className="px-2 py-2.5 text-right">Rozprac.</th><th className="px-2 py-2.5 text-right">Osloveno</th><th className="px-2 py-2.5 text-right">Zájem</th><th className="px-2 py-2.5 text-right">Nabídky</th><th className="px-2 py-2.5 text-right">Zakázky</th><th className="px-4 py-2.5 text-right">Konverze</th></tr></thead><tbody>{overview.users.length ? overview.users.map((user) => <tr key={user.userId} className="border-t border-[var(--surface-border)] text-[10px] text-[var(--text-primary)]"><td className="px-4 py-3"><strong className="block">{user.userName}</strong><small className="mt-0.5 block text-[7px] text-[var(--text-secondary)]">{formatTimestamp(user.lastActivityAt)}{user.overdueCount ? ` · ${user.overdueCount} po termínu` : ''}</small></td><td className="px-2 py-3 text-right tabular-nums">{user.activeCount}</td><td className="px-2 py-3 text-right tabular-nums">{user.contactedCount}</td><td className="px-2 py-3 text-right tabular-nums">{user.interestedCount}</td><td className="px-2 py-3 text-right tabular-nums">{user.offerSentCount}</td><td className="px-2 py-3 text-right font-bold tabular-nums text-emerald-600">{user.jobWonCount}</td><td className="px-4 py-3 text-right font-bold tabular-nums">{user.conversionPercent.toLocaleString('cs-CZ')} %</td></tr>) : <tr><td colSpan={7} className="px-4 py-8 text-center text-[9px] text-[var(--text-secondary)]">Ve zvoleném období zatím není evidována aktivita týmu.</td></tr>}</tbody></table></div>
          </section>

          <section className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-4">
            <div className="flex items-start justify-between gap-3"><span><small className="block text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Komunikační funnel</small><strong className="mt-0.5 block text-[11px] text-[var(--text-primary)]">Postup obchodní komunikace</strong></span><BarChart3 aria-hidden size={16} className="text-[var(--accent)]" /></div>
            <div className="mt-4 space-y-4">{funnel.map((item) => <div key={item.label}><div className="flex items-center justify-between gap-3"><small className="text-[7px] font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)]">{item.label}</small><strong className="text-[11px] tabular-nums text-[var(--text-primary)]">{item.value.toLocaleString('cs-CZ')}</strong></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--surface-border)]"><span className={`block h-full min-w-[3px] rounded-full ${item.color}`} style={{ width: `${item.value === 0 ? 0 : Math.max(4, item.value / funnelMaximum * 100)}%` }} /></div></div>)}</div>
            <div className="mt-5 grid grid-cols-2 gap-2"><div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] p-3 text-center"><small className="block text-[7px] font-bold uppercase text-[var(--text-secondary)]">Nezastiženo</small><strong className="mt-1 block text-base tabular-nums text-amber-600">{overview.funnel.unreachable}</strong></div><div className="rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] p-3 text-center"><small className="block text-[7px] font-bold uppercase text-[var(--text-secondary)]">Bez zakázky</small><strong className="mt-1 block text-base tabular-nums text-[var(--text-primary)]">{overview.funnel.closedNoJob}</strong></div></div>
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
    <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-sky-400/35 bg-sky-500/10 px-4 py-2.5 text-sm font-semibold text-sky-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_8px_18px_rgba(14,165,233,0.12)] transition hover:-translate-y-[1px] hover:border-sky-400/55 [html[data-theme=dark]_&]:text-sky-300"><UsersRound aria-hidden size={16} />PŘEHLED TÝMU</button>
    {open && typeof document !== 'undefined' ? createPortal(<CompleteTeamOverviewPopup currentUser={currentUser} onClose={() => setOpen(false)} />, document.body) : null}
  </>
}
