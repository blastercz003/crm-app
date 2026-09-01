'use client'

import {
  Archive,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Eye,
  MapPin,
  Search,
  SearchCheck,
  Send,
  SlidersHorizontal,
  Store,
  X,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionFeedbackToast, useAnimatedActionToast } from '@/components/ui/action-feedback-toast'
import type {
  PowerOutageDetail,
  PowerOutageListItem,
  PowerOutageMatchStatus,
  PowerOutageSource,
  PowerOutageWorkspace,
} from '@/lib/power-outages/types'
import {
  acknowledgePowerOutageMatchesAction,
  getPowerOutageDetailAction,
} from './actions'
import { PowerOutagePopupLayer } from './power-outage-popups'

type Tab = 'current' | 'archive'
type SourceFilter = 'all' | PowerOutageSource
type MatchFilter = 'visible' | PowerOutageMatchStatus
type TimeFilter = 'all' | 'today' | '7d' | '30d'

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function formatDateTime(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Neuvedeno' : DATE_TIME_FORMATTER.format(date)
}

const MOBILE_DATE_FORMATTER = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
})

const MOBILE_TIME_FORMATTER = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague',
  hour: '2-digit',
  minute: '2-digit',
})

function formatMobilePeriod(startsAt: string, endsAt: string) {
  const starts = new Date(startsAt)
  const ends = new Date(endsAt)
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return 'Termín neuveden'

  const startDate = MOBILE_DATE_FORMATTER.format(starts)
  const endDate = MOBILE_DATE_FORMATTER.format(ends)
  const start = `${startDate} ${MOBILE_TIME_FORMATTER.format(starts)}`
  const end = startDate === endDate
    ? MOBILE_TIME_FORMATTER.format(ends)
    : `${endDate} ${MOBILE_TIME_FORMATTER.format(ends)}`

  return `${start} → ${end}`
}

function normalize(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ')
    .trim()
}

function SourceBadge({ source }: { source: PowerOutageSource }) {
  return (
    <span className="inline-flex h-5 w-[36px] items-center justify-center whitespace-nowrap rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] px-1 text-[7px] font-bold uppercase tracking-[0.06em] text-[var(--accent)] lg:h-6 lg:w-[44px] lg:px-1.5 lg:text-[9px] lg:tracking-[0.08em]">
      {source === 'cez' ? 'ČEZ' : 'EG.D'}
    </span>
  )
}

function MatchBadge({ status }: { status: PowerOutageMatchStatus }) {
  const review = status === 'needs_review'
  const dismissed = status === 'dismissed'
  return (
    <span className={`inline-flex h-5 w-[66px] items-center justify-center whitespace-nowrap rounded-full border px-1.5 text-[7px] font-bold uppercase tracking-[0.035em] lg:h-6 lg:w-[88px] lg:px-2.5 lg:text-[8px] lg:tracking-[0.07em] ${dismissed
      ? 'border-slate-400/45 bg-slate-400/10 text-slate-600 [html[data-theme=dark]_&]:text-slate-300'
      : review
      ? 'border-amber-400/45 bg-amber-400/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300'
      : 'border-emerald-400/40 bg-emerald-400/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300'
    }`}>
      {dismissed ? 'ZAMÍTNUTO' : review ? 'K OVĚŘENÍ' : 'POTVRZENO'}
    </span>
  )
}

function StatusBadge({ item, now }: { item: PowerOutageListItem; now: number }) {
  const starts = new Date(item.startsAt).getTime()
  const ends = new Date(item.endsAt).getTime()
  const active = starts <= now && ends >= now
  const finished = ends < now
  const label = item.sourceStatus === 'cancelled'
    ? 'ZRUŠENA'
    : active
      ? 'PROBÍHÁ'
      : finished
        ? 'UKONČENA'
        : 'PLÁNOVANÁ'
  return (
    <span className="hidden h-5 w-[66px] items-center justify-center whitespace-nowrap rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] px-1.5 text-[7px] font-bold uppercase tracking-[0.035em] text-[var(--accent)] lg:inline-flex lg:h-6 lg:w-[88px] lg:px-2.5 lg:text-[8px] lg:tracking-[0.07em]">
      {label}
    </span>
  )
}

function LinkedJobBadge({ item, mobileOverlay = false }: { item: PowerOutageListItem; mobileOverlay?: boolean }) {
  if (!item.linkedJob) return null

  const additionalCount = Math.max(0, item.linkedJob.matchCount - 1)
  const title = additionalCount > 0
    ? `Zakázka ${item.linkedJob.jobNumber} a ${additionalCount} další vytvořena`
    : `Zakázka ${item.linkedJob.jobNumber} vytvořena`

  return (
    <Link
      href={`/jobs?q=${encodeURIComponent(item.linkedJob.jobNumber)}`}
      aria-label={title}
      title={title}
      className={mobileOverlay
        ? 'absolute -bottom-1 -right-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-emerald-400/55 bg-emerald-100 text-emerald-700 shadow-sm transition hover:scale-105 [html[data-theme=dark]_&]:bg-emerald-950 [html[data-theme=dark]_&]:text-emerald-300'
        : 'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-emerald-400/45 bg-emerald-400/12 text-emerald-700 transition hover:-translate-y-px hover:bg-emerald-400/20 lg:h-6 lg:w-6 [html[data-theme=dark]_&]:text-emerald-300'}
    >
      <Check aria-hidden size={mobileOverlay ? 8 : 13} strokeWidth={3} />
    </Link>
  )
}

function NewOutageIndicator() {
  return (
    <span
      role="status"
      aria-label="Nová odstávka"
      title="Nová odstávka"
      className="absolute -right-1 -top-1 z-10 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white bg-sky-500 shadow-[0_2px_7px_rgba(14,165,233,0.42)] [html[data-theme=dark]_&]:border-slate-950 [html[data-theme=dark]_&]:bg-sky-400 [html[data-theme=dark]_&]:shadow-[0_2px_8px_rgba(56,189,248,0.34)]"
    >
      <span className="relative inline-flex h-1.5 w-1.5 items-center justify-center">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/75 motion-reduce:animate-none" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-white" />
      </span>
    </span>
  )
}

function SelectControl({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
}) {
  return (
    <label className="relative min-w-0">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full appearance-none rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] pl-3 pr-8 text-[11px] font-medium text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
      >
        {children}
      </select>
      <ChevronDown aria-hidden size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
    </label>
  )
}

function MobileOutageCard({
  item,
  isNew,
  now,
  onDetail,
  onAnnouncement,
}: {
  item: PowerOutageListItem
  isNew: boolean
  now: number
  onDetail: () => void
  onAnnouncement: () => void
}) {
  return (
    <article className="power-outages-mobile-card weather-alerts__record-surface rounded-[18px] border px-3 py-2.5">
      <div className="grid min-w-0 grid-cols-[20px_minmax(0,1fr)] gap-x-2">
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-sky-400/20 bg-sky-500/10 text-[var(--accent)]">
          <Zap aria-hidden size={11} />
          {isNew ? <NewOutageIndicator /> : null}
          <LinkedJobBadge item={item} mobileOverlay />
        </span>
        <div className="flex min-w-0 flex-nowrap items-center justify-end gap-1">
            <SourceBadge source={item.source} />
            <MatchBadge status={item.matchStatus} />
            <StatusBadge item={item} now={now} />
        </div>
        <div className="col-span-2 mt-1 flex min-w-0 items-baseline gap-1.5">
          <Store aria-hidden size={11} className="shrink-0 self-center text-[var(--text-secondary)]" />
          <strong className="truncate text-[13px] text-[var(--text-primary)]">{item.store.chainName}</strong>
          <span className="shrink-0 text-[9px] font-bold text-[var(--text-secondary)]">č. {item.store.storeNumber}</span>
        </div>
        <span className="col-span-2 mt-1 flex min-w-0 items-center gap-1.5 text-[10px]">
          <MapPin aria-hidden size={11} className="shrink-0 text-[var(--text-secondary)]" />
          <strong className="shrink-0 font-semibold text-[var(--text-primary)]">{item.store.city}</strong>
          <span className="truncate text-[var(--text-secondary)]">· {item.store.address}</span>
        </span>
        <div className="col-span-2 mt-1.5 flex min-w-0 items-center justify-between gap-2">
          <strong className="min-w-0 truncate text-[10.5px] font-bold tabular-nums text-[var(--text-primary)]">{formatMobilePeriod(item.startsAt, item.endsAt)}</strong>
          <div className="flex shrink-0 gap-1.5">
            <button type="button" onClick={onDetail} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-sky-400/20 bg-sky-500/10 px-2.5 text-[7px] font-bold uppercase tracking-[0.04em] text-[var(--accent)] transition hover:-translate-y-px hover:border-sky-400/35 hover:bg-sky-500/20"><Eye aria-hidden size={12} /> Detail</button>
            <button type="button" onClick={onAnnouncement} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-sky-400/20 bg-sky-500/10 px-2.5 text-[7px] font-bold uppercase tracking-[0.04em] text-[var(--accent)] transition hover:-translate-y-px hover:border-sky-400/35 hover:bg-sky-500/20"><Send aria-hidden size={11} /> Oznámení</button>
          </div>
        </div>
      </div>
    </article>
  )
}

function EmptyState({ tab, filtered }: { tab: Tab; filtered: boolean }) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center px-5 text-center">
      {tab === 'current'
        ? <SearchCheck aria-hidden size={26} className="text-emerald-500" />
        : <Archive aria-hidden size={26} className="text-[var(--accent)]" />}
      <strong className="mt-3 text-sm text-[var(--text-primary)]">
        {filtered
          ? 'Žádná odstávka neodpovídá zvoleným filtrům.'
          : tab === 'current'
            ? 'Aktuálně nebyla nalezena žádná odstávka pro evidované prodejny.'
            : 'V archivu zatím nejsou žádné odstávky.'}
      </strong>
      <span className="mt-1 text-xs text-[var(--text-secondary)]">
        {filtered ? 'Upravte nebo zrušte aktivní filtry.' : 'Data se automaticky průběžně obnovují.'}
      </span>
    </div>
  )
}

export function PowerOutageRecords({ workspace }: { workspace: PowerOutageWorkspace }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast, isVisible: isToastVisible, showToast } = useAnimatedActionToast()
  const [tab, setTab] = useState<Tab>('current')
  const [query, setQuery] = useState('')
  const [chainFilter, setChainFilter] = useState('all')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [matchFilter, setMatchFilter] = useState<MatchFilter>('visible')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [popupMode, setPopupMode] = useState<'detail' | 'announcement' | null>(null)
  const [selectedItem, setSelectedItem] = useState<PowerOutageListItem | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<PowerOutageDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const detailRequestRef = useRef(0)
  const openedDeepLinkRef = useRef<string | null>(null)
  const acknowledgedMatchIdsRef = useRef(new Set<string>())
  const [rememberedNewMatchIds, setRememberedNewMatchIds] = useState<Set<string>>(() => new Set(
    workspace.currentOutages
      .filter((item) => item.isNew && item.matchStatus !== 'dismissed')
      .map((item) => item.matchId),
  ))
  const now = useMemo(() => new Date(workspace.generatedAt).getTime(), [workspace.generatedAt])
  const records = tab === 'current' ? workspace.currentOutages : workspace.archivedOutages
  const hasFilters = Boolean(query.trim()) || chainFilter !== 'all' || sourceFilter !== 'all' || timeFilter !== 'all' || matchFilter !== 'visible'
  const activeFilterCount = [
    Boolean(query.trim()),
    chainFilter !== 'all',
    sourceFilter !== 'all',
    timeFilter !== 'all',
    matchFilter !== 'visible',
  ].filter(Boolean).length
  const newMatchIds = useMemo(() => {
    const next = new Set(rememberedNewMatchIds)
    for (const item of workspace.currentOutages) {
      if (item.isNew && item.matchStatus !== 'dismissed') next.add(item.matchId)
    }
    return next
  }, [rememberedNewMatchIds, workspace.currentOutages])

  useEffect(() => {
    const unseenMatchIds = workspace.currentOutages
      .filter((item) => item.isNew && item.matchStatus !== 'dismissed')
      .map((item) => item.matchId)

    if (unseenMatchIds.length === 0) return

    const pendingMatchIds = unseenMatchIds.filter(
      (matchId) => !acknowledgedMatchIdsRef.current.has(matchId),
    )
    if (pendingMatchIds.length === 0) return

    for (const matchId of pendingMatchIds) {
      acknowledgedMatchIdsRef.current.add(matchId)
    }

    void acknowledgePowerOutageMatchesAction(pendingMatchIds).then((result) => {
      if (result.success) {
        setRememberedNewMatchIds((current) => {
          const next = new Set(current)
          for (const matchId of pendingMatchIds) next.add(matchId)
          return next
        })
        return
      }
      for (const matchId of pendingMatchIds) {
        acknowledgedMatchIdsRef.current.delete(matchId)
      }
      console.error(result.error)
    })
  }, [workspace.currentOutages])

  const filtered = useMemo(() => {
    const normalizedQuery = normalize(query)
    const today = new Date(now)
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)
    const windowDays = timeFilter === '7d' ? 7 : timeFilter === '30d' ? 30 : 0
    const windowEdge = now + (tab === 'current' ? 1 : -1) * windowDays * 24 * 60 * 60 * 1_000

    return records
      .filter((item) => {
        if (chainFilter !== 'all' && item.store.chainName !== chainFilter) return false
        if (sourceFilter !== 'all' && item.source !== sourceFilter) return false
        if (matchFilter === 'visible' && item.matchStatus === 'dismissed') return false
        if (matchFilter !== 'visible' && item.matchStatus !== matchFilter) return false
        if (normalizedQuery) {
          const haystack = normalize([
            item.store.chainName,
            item.store.storeNumber,
            item.store.address,
            item.store.city,
            item.title,
            item.municipality,
            item.district,
            item.region,
          ].filter(Boolean).join(' '))
          if (!haystack.includes(normalizedQuery)) return false
        }

        const starts = new Date(item.startsAt).getTime()
        const ends = new Date(item.endsAt).getTime()
        if (timeFilter === 'today') return starts < tomorrow.getTime() && ends >= today.getTime()
        if (windowDays > 0) {
          return tab === 'current'
            ? ends >= now && starts <= windowEdge
            : ends <= now && ends >= windowEdge
        }
        return true
      })
      .sort((left, right) => {
        if (tab === 'archive') return new Date(right.endsAt).getTime() - new Date(left.endsAt).getTime()
        const rank = (item: PowerOutageListItem) => {
          const starts = new Date(item.startsAt).getTime()
          const ends = new Date(item.endsAt).getTime()
          if (starts <= now && ends >= now) return 0
          if (starts > now) return 1
          return 2
        }
        const rankDifference = rank(left) - rank(right)
        if (rankDifference !== 0) return rankDifference
        if (rank(left) === 2) return new Date(right.endsAt).getTime() - new Date(left.endsAt).getTime()
        return new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime()
      })
  }, [chainFilter, matchFilter, now, query, records, sourceFilter, tab, timeFilter])

  const clearFilters = () => {
    setQuery('')
    setChainFilter('all')
    setSourceFilter('all')
    setTimeFilter('all')
    setMatchFilter('visible')
    setFiltersOpen(false)
  }

  const openAnnouncement = (item: PowerOutageListItem) => {
    detailRequestRef.current += 1
    setSelectedItem(item)
    setSelectedDetail(null)
    setDetailError(null)
    setDetailLoading(false)
    setPopupMode('announcement')
  }

  const openDetail = async (item: PowerOutageListItem) => {
    const requestId = detailRequestRef.current + 1
    detailRequestRef.current = requestId
    setSelectedItem(item)
    setSelectedDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    setPopupMode('detail')
    const result = await getPowerOutageDetailAction(item.matchId)
    if (detailRequestRef.current !== requestId) return
    if (result.success) setSelectedDetail(result.detail)
    else setDetailError(result.error)
    setDetailLoading(false)
  }

  const closePopup = () => {
    detailRequestRef.current += 1
    setPopupMode(null)
    setSelectedItem(null)
    setSelectedDetail(null)
    setDetailError(null)
    setDetailLoading(false)
  }

  const handleStatusChanged = (status: PowerOutageMatchStatus) => {
    showToast({
      title: status === 'confirmed'
        ? 'SHODA POTVRZENA'
        : status === 'dismissed'
          ? 'SHODA ZAMÍTNUTA'
          : 'VRÁCENO K OVĚŘENÍ',
      message: status === 'confirmed'
        ? 'Odstávka je připravena pro upozornění.'
        : status === 'dismissed'
          ? 'Nesprávná shoda byla skryta z běžného přehledu.'
          : 'Záznam byl vrácen mezi shody k ověření.',
      tone: 'success',
    })
    closePopup()
    router.refresh()
  }

  useEffect(() => {
    const matchId = searchParams.get('match')
    if (!matchId || openedDeepLinkRef.current === matchId) return
    const item = [...workspace.currentOutages, ...workspace.archivedOutages]
      .find((record) => record.matchId === matchId)
    if (!item) return
    openedDeepLinkRef.current = matchId
    const requestId = detailRequestRef.current + 1
    detailRequestRef.current = requestId
    void getPowerOutageDetailAction(item.matchId).then((result) => {
      if (detailRequestRef.current !== requestId) return
      setSelectedItem(item)
      setSelectedDetail(result.success ? result.detail : null)
      setDetailError(result.success ? null : result.error)
      setDetailLoading(false)
      setPopupMode('detail')
    })
  }, [searchParams, workspace.archivedOutages, workspace.currentOutages])

  return (
    <section className="activities-page__panel min-w-0 rounded-[28px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5 xl:col-span-3 xl:flex xl:h-0 xl:min-h-full xl:flex-col xl:overflow-hidden">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center xl:grid-cols-[175px_minmax(0,1fr)_160px] xl:gap-2">
        <div className="min-w-0 lg:contents">
          <div className="min-w-0 lg:col-start-1 lg:row-start-1">
            <div className="flex min-w-0 items-center justify-between gap-2 lg:block">
              <span className="text-[7px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)] min-[360px]:text-[9px] min-[360px]:tracking-[0.13em] lg:text-[10px] lg:tracking-[0.14em]">Databáze distributorů</span>
              <div className="weather-alerts__record-surface grid h-8 w-[106px] shrink-0 grid-cols-2 rounded-xl border p-0.5 min-[360px]:h-9 min-[360px]:w-[122px] lg:hidden">
                <button type="button" onClick={() => setTab('current')} aria-pressed={tab === 'current'} className={`rounded-[10px] px-1 text-[6px] font-bold uppercase transition min-[360px]:text-[7px] ${tab === 'current' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>Aktuální</button>
                <button type="button" onClick={() => setTab('archive')} aria-pressed={tab === 'archive'} className={`rounded-[10px] px-1 text-[6px] font-bold uppercase transition min-[360px]:text-[7px] ${tab === 'archive' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>Archiv</button>
              </div>
            </div>
            <h2 className="mt-1 whitespace-nowrap text-xl font-semibold text-[var(--text-primary)]">Přehled odstávek</h2>
          </div>
          <div className="weather-alerts__record-surface hidden h-12 shrink-0 grid-cols-2 rounded-2xl border p-1 lg:col-start-2 lg:row-start-1 lg:grid xl:col-start-3">
            <button type="button" onClick={() => setTab('current')} aria-pressed={tab === 'current'} className={`rounded-xl px-5 text-[10px] font-bold uppercase transition xl:px-3 ${tab === 'current' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>Aktuální</button>
            <button type="button" onClick={() => setTab('archive')} aria-pressed={tab === 'archive'} className={`rounded-xl px-5 text-[10px] font-bold uppercase transition xl:px-3 ${tab === 'archive' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>Archiv</button>
          </div>
        </div>
        <div className="weather-alerts__record-surface rounded-[22px] border p-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 lg:p-1.5 xl:col-span-1 xl:col-start-2 xl:row-start-1">
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="power-outage-mobile-filters"
            className="flex h-8 w-full items-center gap-2 rounded-xl px-2.5 text-left text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)] lg:hidden"
          >
            <SlidersHorizontal aria-hidden size={14} className="shrink-0 text-[var(--accent)]" />
            <span className="flex-1">Filtry</span>
            {activeFilterCount > 0 ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500 px-1.5 text-[8px] text-white">{activeFilterCount}</span> : null}
            <ChevronDown aria-hidden size={14} className={`shrink-0 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} />
          </button>
          <div id="power-outage-mobile-filters" className={`${filtersOpen ? 'grid' : 'hidden'} mt-1.5 gap-2 p-1 sm:grid-cols-2 lg:mt-0 lg:grid lg:p-0 xl:grid-cols-[minmax(120px,1.35fr)_repeat(4,minmax(82px,1fr))] xl:gap-1.5`}>
          <label className="relative min-w-0 sm:col-span-2 xl:col-span-1">
            <span className="sr-only">Vyhledat odstávku</span>
            <Search aria-hidden size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat prodejnu, město nebo ulici…" className="h-10 w-full rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] pl-9 pr-8 text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:border-[var(--accent)]" />
            {query ? <button type="button" onClick={() => setQuery('')} aria-label="Vymazat hledání" className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"><X aria-hidden size={13} /></button> : null}
          </label>
          <SelectControl label="Řetězec" value={chainFilter} onChange={setChainFilter}>
            <option value="all">Všechny řetězce</option>
            {workspace.filters.chains.map((chain) => <option key={chain} value={chain}>{chain}</option>)}
          </SelectControl>
          <SelectControl label="Distributor" value={sourceFilter} onChange={(value) => setSourceFilter(value as SourceFilter)}>
            <option value="all">Všichni distributoři</option>
            <option value="cez">ČEZ</option>
            <option value="egd">EG.D</option>
          </SelectControl>
          <SelectControl label="Termín" value={timeFilter} onChange={(value) => setTimeFilter(value as TimeFilter)}>
            <option value="all">Všechny termíny</option>
            <option value="today">Dnes</option>
            <option value="7d">{tab === 'current' ? 'Následujících 7 dní' : 'Posledních 7 dní'}</option>
            <option value="30d">{tab === 'current' ? 'Následujících 30 dní' : 'Posledních 30 dní'}</option>
          </SelectControl>
          <SelectControl label="Stav shody" value={matchFilter} onChange={(value) => setMatchFilter(value as MatchFilter)}>
            <option value="visible">Běžné shody</option>
            <option value="needs_review">K ověření</option>
            <option value="confirmed">Potvrzené</option>
            <option value="dismissed">Zamítnuté</option>
          </SelectControl>
          </div>
          {hasFilters ? <button type="button" onClick={clearFilters} className={`${filtersOpen ? 'inline-flex' : 'hidden'} mb-1 ml-1 mt-2 h-8 items-center gap-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-3 text-[8px] font-bold uppercase tracking-[0.05em] text-[var(--text-secondary)] lg:hidden`}><X aria-hidden size={12} /> Zrušit filtry</button> : null}
        </div>
      </div>

      <div className="power-outages-records-shell weather-alerts__record-surface mt-3 overflow-visible rounded-[22px] border lg:overflow-hidden xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
        <div className="hidden h-11 items-center justify-between gap-3 border-b border-[var(--surface-border)] px-3.5 sm:px-4 lg:flex">
          <div className="flex min-w-0 items-center gap-2">
            {tab === 'current' ? <CalendarDays aria-hidden size={14} className="shrink-0 text-[var(--accent)]" /> : <Archive aria-hidden size={14} className="shrink-0 text-[var(--accent)]" />}
            <h3 className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">{tab === 'current' ? 'Aktuální nalezené odstávky' : 'Archiv odstávek'}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="hidden items-center gap-1 text-[9px] font-semibold text-[var(--text-secondary)] sm:inline-flex"><Clock3 aria-hidden size={12} />{tab === 'current' ? 'Nejbližší termín první' : 'Nejnovější první'}</span>
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] px-2 text-[9px] font-bold text-[var(--text-secondary)]">{filtered.length}</span>
          </div>
        </div>

        {filtered.length > 0 ? (
          <div className="-mx-2 max-h-[610px] overflow-y-auto px-2 py-1 overscroll-contain [scrollbar-gutter:auto] lg:mx-0 lg:max-h-[500px] lg:px-0 lg:py-0 lg:[scrollbar-gutter:stable] xl:min-h-0 xl:max-h-none xl:flex-1">
            <div className="hidden lg:block">
              <table className="w-full table-fixed border-collapse text-left">
                <thead className="power-outages-table__header sticky top-0 z-10 shadow-[0_1px_0_var(--surface-border)]">
                  <tr className="text-[8px] font-bold uppercase tracking-[0.09em] text-[var(--text-secondary)]">
                    <th className="w-[17%] px-3 py-2.5">Firma / prodejna</th>
                    <th className="w-[16%] px-3 py-2.5">Adresa</th>
                    <th className="w-[8%] px-3 py-2.5">Distributor</th>
                    <th className="w-[14%] px-3 py-2.5">Termín od</th>
                    <th className="w-[14%] px-3 py-2.5">Termín do</th>
                    <th className="w-[22%] px-3 py-2.5">Stav</th>
                    <th className="w-[9%] px-3 py-2.5 text-right">Akce</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--surface-border)]">
                  {filtered.map((item) => (
                    <tr key={item.matchId} className="group transition-colors hover:bg-[var(--surface-muted)]">
                      <td className="px-3 py-3 align-middle">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-[var(--accent)]"><Store aria-hidden size={14} />{newMatchIds.has(item.matchId) ? <NewOutageIndicator /> : null}</span>
                          <span className="min-w-0"><strong className="block truncate text-[11px] text-[var(--text-primary)]">{item.store.chainName}</strong><small className="block truncate text-[9px] font-semibold text-[var(--text-secondary)]">Prodejna č. {item.store.storeNumber}</small></span>
                        </div>
                      </td>
                      <td className="px-3 py-3 align-middle"><span className="block truncate text-[10px] text-[var(--text-primary)]">{item.store.city}</span><small className="block truncate text-[9px] text-[var(--text-secondary)]">{item.store.address}</small></td>
                      <td className="px-3 py-3 align-middle"><SourceBadge source={item.source} /></td>
                      <td className="px-3 py-3 align-middle text-[10px] font-semibold tabular-nums text-[var(--text-primary)]">{formatDateTime(item.startsAt)}</td>
                      <td className="px-3 py-3 align-middle text-[10px] font-semibold tabular-nums text-[var(--text-primary)]">{formatDateTime(item.endsAt)}</td>
                      <td className="px-3 py-3 align-middle"><div className="flex flex-nowrap items-center gap-1"><MatchBadge status={item.matchStatus} /><StatusBadge item={item} now={now} /><LinkedJobBadge item={item} /></div></td>
                      <td className="px-3 py-3 align-middle">
                        <div className="flex justify-end gap-1.5">
                          <button type="button" onClick={() => void openDetail(item)} aria-label={`Otevřít detail odstávky pro prodejnu ${item.store.storeNumber}`} title="Detail odstávky" className="flex h-8 w-8 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-500/10 text-[var(--accent)] transition hover:-translate-y-px hover:border-sky-400/35 hover:bg-sky-500/20"><Eye aria-hidden size={14} /></button>
                          <button type="button" onClick={() => openAnnouncement(item)} aria-label={`Vytvořit oznámení o odstávce pro prodejnu ${item.store.storeNumber}`} title="Oznámení o odstávce" className="flex h-8 w-8 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-500/10 text-[var(--accent)] transition hover:-translate-y-px hover:border-sky-400/35 hover:bg-sky-500/20"><Send aria-hidden size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-2.5 lg:hidden">
              {filtered.map((item) => <MobileOutageCard key={item.matchId} item={item} isNew={newMatchIds.has(item.matchId)} now={now} onDetail={() => void openDetail(item)} onAnnouncement={() => openAnnouncement(item)} />)}
            </div>
          </div>
        ) : <EmptyState tab={tab} filtered={hasFilters} />}
      </div>
      <PowerOutagePopupLayer mode={popupMode} item={selectedItem} detail={selectedDetail} detailLoading={detailLoading} detailError={detailError} onClose={closePopup} onStatusChanged={handleStatusChanged} />
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isToastVisible} /> : null}
    </section>
  )
}
