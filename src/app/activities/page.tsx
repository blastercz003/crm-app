import type { Metadata } from 'next'
import Link from 'next/link'
import { unstable_noStore as noStore } from 'next/cache'
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileText,
  Mail,
  MessageSquareText,
  Phone,
  RefreshCcw,
  SlidersHorizontal,
  UsersRound,
} from 'lucide-react'
import { PresenceSectionTracker } from '@/components/presence/presence-section-tracker'
import { NewActivityButton } from './new-activity-button'
import { ManualActivityControls } from './manual-activity-controls'
import { ActivityReportButton } from './activity-report-button'
import { ActivityPeriodFilter, type ActivityPeriod } from './activity-period-filter'
import { getActivities, getActivityFilterOptions, getActivityOverview } from '@/lib/activities/service'
import {
  type ActivityListFilters,
  type ActivityListItem,
} from '@/lib/activities/types'

export const metadata: Metadata = { title: 'Obchodní aktivita' }
export const dynamic = 'force-dynamic'

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const PAGE_SIZE = 30
const ACTIVITY_TYPE_OPTIONS = [
  ['phone_call', 'Telefonát'], ['email', 'E-mail'], ['in_person_meeting', 'Osobní jednání'],
  ['work_log', 'Pracovní zápis'], ['other', 'Jiná ruční aktivita'],
  ['offer_created', 'Vytvořená nabídka'], ['offer_status_changed', 'Změna stavu nabídky'],
  ['offer_comment_added', 'Komentář k nabídce'], ['task_created', 'Vytvořený úkol'],
  ['task_completed', 'Dokončený úkol'], ['task_reopened', 'Znovu otevřený úkol'],
  ['meeting_created', 'Vytvořená schůzka'], ['meeting_completed', 'Dokončená schůzka'],
  ['meeting_reopened', 'Znovu otevřená schůzka'], ['meeting_rescheduled', 'Přesunutá schůzka'],
  ['meeting_result_added', 'Doplněný výsledek schůzky'],
] as const
const ACTIVITY_PERIODS: readonly ActivityPeriod[] = ['all', 'today', 'this_week', 'this_month', 'last_30_days', 'custom']

type ActivitiesSearchParams = Record<string, string | string[] | undefined>

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function isOneOf<T extends string>(value: string, options: readonly T[]): value is T {
  return options.includes(value as T)
}

function parsePage(value: string) {
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function getPragueToday() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)))
}

function resolvePeriodDates(period: ActivityPeriod, customFrom: string, customTo: string) {
  if (period === 'custom') return { dateFrom: customFrom, dateTo: customTo }
  if (period === 'all') return { dateFrom: '', dateTo: '' }

  const today = getPragueToday()
  if (period === 'today') {
    const value = formatDateKey(today)
    return { dateFrom: value, dateTo: value }
  }

  if (period === 'this_week') {
    const start = new Date(today)
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
    return { dateFrom: formatDateKey(start), dateTo: formatDateKey(today) }
  }

  if (period === 'this_month') {
    const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
    return { dateFrom: formatDateKey(start), dateTo: formatDateKey(today) }
  }

  const start = new Date(today)
  start.setUTCDate(start.getUTCDate() - 29)
  return { dateFrom: formatDateKey(start), dateTo: formatDateKey(today) }
}

function formatActivityDateTime(value: string | null) {
  if (!value) return 'Bez termínu'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Neznámý čas'
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: PRAGUE_TIME_ZONE,
  }).format(date)
}

function getActivityPresentation(activity: ActivityListItem) {
  if (activity.activity_type === 'phone_call') return { label: 'Telefonát', icon: Phone, color: '#0ea5e9' }
  if (activity.activity_type === 'email') return { label: 'E-mail', icon: Mail, color: '#8b5cf6' }
  if (activity.activity_type === 'offer_comment_added') return { label: 'Komentář', icon: MessageSquareText, color: '#f59e0b' }
  if (activity.activity_type.startsWith('offer_')) return { label: 'Nabídka', icon: FileText, color: '#10b981' }
  if (activity.activity_type === 'task_completed') return { label: 'Hotový úkol', icon: CheckCircle2, color: '#10b981' }
  if (activity.activity_type.startsWith('task_')) return { label: 'Úkol', icon: ClipboardList, color: '#94a3b8' }
  if (activity.activity_type === 'meeting_rescheduled') return { label: 'Změna termínu', icon: RefreshCcw, color: '#f59e0b' }
  if (activity.activity_type.startsWith('meeting_')) return { label: 'Schůzka', icon: UsersRound, color: '#3b82f6' }
  if (activity.status === 'planned') return { label: 'Plánovaná', icon: CalendarClock, color: '#3b82f6' }
  return { label: 'Aktivita', icon: ClipboardList, color: '#94a3b8' }
}

function buildActivitiesHref(params: ActivitiesSearchParams, page: number) {
  const query = new URLSearchParams()
  for (const [key, rawValue] of Object.entries(params)) {
    if (key === 'page') continue
    const value = firstParam(rawValue).trim()
    if (value) query.set(key, value)
  }
  if (page > 1) query.set('page', String(page))
  return query.size ? `/activities?${query.toString()}` : '/activities'
}

function CompactActivity({ activity }: { activity: ActivityListItem }) {
  const presentation = getActivityPresentation(activity)
  const Icon = presentation.icon
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border" style={{ borderColor: `color-mix(in srgb, ${presentation.color} 28%, transparent)`, backgroundColor: `color-mix(in srgb, ${presentation.color} 12%, transparent)`, color: presentation.color }}><Icon aria-hidden size={16} /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{activity.title}</p>
        <p className="mt-1 truncate text-xs text-[var(--text-secondary)]">{activity.client_name ?? 'Bez klienta'} · {formatActivityDateTime(activity.scheduled_for ?? activity.occurred_at)}</p>
      </div>
      {activity.source_path ? <Link href={activity.source_path} className="shrink-0 text-xs font-semibold text-[var(--accent)] hover:underline">Otevřít</Link> : null}
    </div>
  )
}

export default async function ActivitiesPage({ searchParams }: { searchParams?: Promise<ActivitiesSearchParams> }) {
  noStore()
  const params = searchParams ? await searchParams : {}
  const userId = firstParam(params.user)
  const clientId = firstParam(params.client)
  const activityType = firstParam(params.type)
  const customDateFrom = firstParam(params.from)
  const customDateTo = firstParam(params.to)
  const requestedPeriod = firstParam(params.period)
  const period: ActivityPeriod = isOneOf(requestedPeriod, ACTIVITY_PERIODS)
    ? requestedPeriod
    : customDateFrom || customDateTo
      ? 'custom'
      : 'all'
  const { dateFrom, dateTo } = resolvePeriodDates(period, customDateFrom, customDateTo)
  const page = parsePage(firstParam(params.page))
  const filters: ActivityListFilters = {
    page, pageSize: PAGE_SIZE, userId, clientId, activityType, dateFrom, dateTo,
    origin: null,
    status: null,
    sourceType: null,
  }
  const [result, options, overview] = await Promise.all([
    getActivities(filters), getActivityFilterOptions(), getActivityOverview({ userId, clientId }),
  ])
  const title = 'Obchodní aktivita'
  const hasActiveFilters = Boolean(userId || clientId || activityType || period !== 'all')
  const itemFrom = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1
  const itemTo = Math.min(result.page * result.pageSize, result.total)
  const summaryCards = [
    { label: 'Dnes', value: overview.todayCount, note: 'zapsaných událostí', icon: Activity, tone: 'blue' },
    { label: 'Naplánováno', value: overview.plannedCount, note: 'budoucích aktivit', icon: CalendarClock, tone: 'emerald' },
    { label: 'Po termínu', value: overview.overdueCount, note: 'čeká na vyřízení', icon: AlertTriangle, tone: overview.overdueCount ? 'amber' : 'slate' },
    { label: 'Ve výběru', value: result.total, note: hasActiveFilters ? 'dle aktivních filtrů' : 'celkem aktivit', icon: ClipboardList, tone: 'violet' },
  ]
  const renderFilterControls = (periodId: string) => (
    <>
      {result.viewer.isAdmin ? <label className="activities-page__filter-label">Uživatel<div className="activities-page__filter-select-wrap relative min-w-0"><select name="user" defaultValue={userId} className="activities-page__filter-control"><option value="">Všichni uživatelé</option>{options.users.map((user) => <option key={user.id} value={user.id}>{user.name}</option>)}</select><span aria-hidden className="activities-page__filter-chevron pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 text-xs text-zinc-500 lg:block">⌄</span></div></label> : null}
      <label className="activities-page__filter-label">Typ aktivity<div className="activities-page__filter-select-wrap relative min-w-0"><select name="type" defaultValue={activityType} className="activities-page__filter-control"><option value="">Všechny typy</option>{ACTIVITY_TYPE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span aria-hidden className="activities-page__filter-chevron pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 text-xs text-zinc-500 lg:block">⌄</span></div></label>
      <ActivityPeriodFilter id={periodId} defaultPeriod={period} defaultDateFrom={customDateFrom} defaultDateTo={customDateTo} />
    </>
  )

  return (
    <main className="activities-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)] text-[var(--foreground)]">
      <PresenceSectionTracker section="Aktivity" route="/activities" />
      <div aria-hidden className="activities-page__glow activities-page__glow--right pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl" />
      <div aria-hidden className="activities-page__glow activities-page__glow--left pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl" />
      <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="activities-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-end"><h1 className="text-3xl font-semibold leading-none tracking-tight text-[var(--text-primary)]">{title}</h1></div>
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-end lg:w-auto">
              <Link href="/dashboard" className="offers-page__back-button clients-page__back-button inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800">ZPĚT NA DASHBOARD</Link>
              {result.viewer.isAdmin ? <ActivityReportButton users={options.users} /> : null}
              <NewActivityButton clients={options.clients} className="clients-page__new-button" />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 lg:hidden">
          {summaryCards.map((card) => { const Icon = card.icon; return <article key={card.label} className="activities-page__panel rounded-3xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] backdrop-blur-[10px] sm:p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">{card.label}</p><p className="mt-2 text-3xl font-semibold tracking-tight text-[var(--text-primary)]">{card.value}</p><p className="mt-1 text-xs text-[var(--text-secondary)]">{card.note}</p></div><span className="activities-page__summary-icon flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl" data-tone={card.tone}><Icon aria-hidden size={18} /></span></div></article> })}
        </section>

        <section className="activities-page__filters-shell activities-page__panel hidden overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:block">
          <form method="get" className="p-5">
            <div className="flex items-start gap-6 xl:gap-8">
              <div className="min-w-0 flex-1">
                <div className="activities-page__desktop-filters grid grid-cols-2 gap-x-3 gap-y-4 xl:grid-cols-4">
                  {renderFilterControls('activity-period-desktop')}
                </div>
                <div className="offers-page__filters-divider mt-4 flex items-center justify-end gap-2 border-t border-gray-100 pt-3">
                  <button type="submit" className="offers-page__filter-submit inline-flex h-9 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800">POUŽÍT FILTRY</button>
                  <Link href="/activities" className="offers-page__filter-reset offers-page__filter-submit inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]">RESET</Link>
                </div>
              </div>

              <div className="grid w-[250px] shrink-0 grid-cols-2 gap-3 xl:w-[512px] xl:grid-cols-4">
                {summaryCards.map((card) => <article key={card.label} className="offers-page__stats-card activities-page__desktop-stat rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-2.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]"><p className="whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--text-secondary)]">{card.label}</p><p className="mt-1 text-lg font-semibold leading-none text-[var(--text-primary)]">{card.value}</p></article>)}
              </div>
            </div>
          </form>
        </section>

        <section className="grid gap-5 xl:grid-cols-[1.35fr_0.65fr]">
          <article className="activities-page__panel rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-6">
            <div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">DALŠÍ KROKY</p><h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">Nejbližší plánované aktivity</h2></div><span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[var(--accent)]">{overview.plannedCount}</span></div>
            {overview.plannedItems.length ? <div className="grid gap-3 lg:grid-cols-2">{overview.plannedItems.map((activity) => <CompactActivity key={activity.id} activity={activity} />)}</div> : <p className="rounded-2xl border border-dashed border-[var(--surface-border)] px-4 py-7 text-center text-sm text-[var(--text-secondary)]">Žádná budoucí aktivita zatím není naplánovaná.</p>}
          </article>
          <article className="activities-page__panel rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-6"><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">POSLEDNÍ ZÁPIS</p><h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">Poslední aktivita</h2><div className="mt-4">{overview.lastActivity ? <CompactActivity activity={overview.lastActivity} /> : <p className="text-sm text-[var(--text-secondary)]">Zatím bez aktivit.</p>}</div></article>
        </section>

        <details open={hasActiveFilters} className="activities-page__panel group rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:hidden">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 sm:px-6"><span className="flex items-center gap-3 text-sm font-semibold text-[var(--text-primary)]"><SlidersHorizontal aria-hidden size={18} className="text-[var(--accent)]" /> Filtry {hasActiveFilters ? <span className="rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] uppercase tracking-wide text-[var(--accent)]">Aktivní</span> : null}</span><ChevronRight aria-hidden size={18} className="text-[var(--text-secondary)] transition group-open:rotate-90" /></summary>
          <form method="get" className="grid gap-4 border-t border-[var(--surface-border)] px-5 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
            {renderFilterControls('activity-period-mobile')}
            <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-4 lg:justify-end"><Link href="/activities" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--surface-border)] px-4 text-sm font-semibold text-[var(--text-secondary)] hover:bg-[var(--surface-muted)]">Zrušit filtry</Link><button type="submit" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#2980B9] px-5 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(41,128,185,0.22)] hover:bg-[#236f9f]">Použít filtry</button></div>
          </form>
        </details>

        <section className="activities-page__log-shell overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="activities-page__log-header flex flex-col gap-2 border-b border-[var(--surface-border)] px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6"><div><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">CHRONOLOGICKÝ LOG</p><h2 className="mt-1 text-xl font-semibold tracking-tight text-[var(--text-primary)]">Historie aktivit</h2></div><p className="text-xs text-[var(--text-secondary)]">Zobrazeno {itemFrom}–{itemTo} z {result.total} záznamů</p></div>
          {result.items.length === 0 ? <div className="px-6 py-16 text-center"><div className="activities-page__empty-icon mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-sky-100 bg-sky-50 text-[#2980B9]"><ClipboardList aria-hidden size={24} /></div><h2 className="mt-4 text-lg font-semibold text-[var(--text-primary)]">Žádné odpovídající aktivity</h2><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-secondary)]">Změňte filtry, nebo později přidejte novou aktivitu.</p></div> : (
            <div className="activities-page__timeline divide-y divide-[var(--surface-border)]">{result.items.map((activity) => { const presentation = getActivityPresentation(activity); const Icon = presentation.icon; return (
              <article key={activity.id} className="activities-page__activity-row group grid grid-cols-[auto_minmax(0,1fr)] gap-4 px-5 py-5 transition hover:bg-[var(--surface-muted)] sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-6">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border" style={{ borderColor: `color-mix(in srgb, ${presentation.color} 28%, transparent)`, backgroundColor: `color-mix(in srgb, ${presentation.color} 12%, transparent)`, color: presentation.color }}><Icon aria-hidden size={19} /></div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ borderColor: `color-mix(in srgb, ${presentation.color} 28%, transparent)`, backgroundColor: `color-mix(in srgb, ${presentation.color} 12%, transparent)`, color: presentation.color }}>{presentation.label}</span><span className="activities-page__origin-badge rounded-full border border-[var(--surface-border)] bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">{activity.origin === 'automatic' ? 'Automaticky' : 'Ručně'}</span>{activity.origin === 'manual' && activity.status === 'planned' ? <span className="activities-page__status-badge" data-status="planned">Naplánováno</span> : null}{activity.origin === 'manual' && activity.status === 'completed' ? <span className="activities-page__status-badge" data-status="completed">Dokončeno</span> : null}{result.viewer.isAdmin ? <span className="activities-page__user-badge rounded-full border border-[var(--accent-soft)] bg-[var(--accent-soft)] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--accent)]">{activity.user_name ?? 'Neznámý uživatel'}</span> : null}</div>
                  <h3 className="mt-2 text-[15px] font-semibold leading-6 text-[var(--text-primary)]">{activity.title}</h3>
                  {activity.description ? <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">{activity.description}</p> : null}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[var(--text-secondary)]">{activity.client_id && activity.client_name ? <Link href={`/clients/${activity.client_id}`} className="font-medium text-[var(--accent)] hover:underline">{activity.client_name}</Link> : <span>Bez klienta</span>}{activity.source_path ? <Link href={activity.source_path} className="font-medium text-[var(--accent)] hover:underline">Otevřít zdroj</Link> : null}{activity.status === 'planned' && activity.scheduled_for ? <span>Termín: {formatActivityDateTime(activity.scheduled_for)}</span> : null}</div>
                  {activity.origin === 'manual' && activity.user_id === result.viewer.id && (activity.status === 'logged' || activity.status === 'planned') ? <ManualActivityControls activity={activity} clients={options.clients} /> : null}
                </div>
                <time dateTime={activity.occurred_at} className="col-start-2 whitespace-nowrap text-xs font-medium text-[var(--text-secondary)] sm:col-start-auto sm:pt-1 sm:text-right">{formatActivityDateTime(activity.occurred_at)}</time>
              </article>) })}</div>
          )}
          {result.pageCount > 1 ? <nav aria-label="Stránkování aktivit" className="flex items-center justify-between gap-3 border-t border-[var(--surface-border)] px-5 py-4 sm:px-6">{result.page > 1 ? <Link href={buildActivitiesHref(params, result.page - 1)} className="activities-page__page-link"><ChevronLeft aria-hidden size={16} /> Předchozí</Link> : <span />}<span className="text-xs font-medium text-[var(--text-secondary)]">Strana {result.page} z {result.pageCount}</span>{result.page < result.pageCount ? <Link href={buildActivitiesHref(params, result.page + 1)} className="activities-page__page-link">Další <ChevronRight aria-hidden size={16} /></Link> : <span />}</nav> : null}
        </section>
      </div>
    </main>
  )
}
