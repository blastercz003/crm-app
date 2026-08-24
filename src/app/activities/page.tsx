import type { Metadata } from 'next'
import Link from 'next/link'
import { unstable_noStore as noStore } from 'next/cache'
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Clock3,
  FileText,
  ListTodo,
  MessageSquareText,
  UsersRound,
  Wrench,
} from 'lucide-react'
import { PresenceSectionTracker } from '@/components/presence/presence-section-tracker'
import {
  getActivitiesWorkspace,
  getActivitiesWorkspaceFormOptions,
} from '@/lib/activities/workspace-service'
import type { ActivityListItem } from '@/lib/activities/types'
import { getManualActivityById } from '@/lib/activities/service'
import { ActivityReportButton } from './activity-report-button'
import { ManualActivityCard } from './manual-activity-card'
import { NewActivityButton } from './new-activity-button'
import { SystemHistoryModalButton } from './system-history-modal-button'
import NewTaskButton from '@/app/tasks/new-task-button'
import { NewMeetingButton } from '@/app/meetings/new-meeting-button'
import { NewOfferButton } from '@/app/offers/new-offer-button'
import { NewJobButton } from '@/app/jobs/new-job-button'
import { WorkspaceMeetingDetail } from './workspace-meeting-detail'
import { WorkspaceTaskList } from './workspace-task-list'
import { WorkspaceOfferList } from './workspace-offer-list'
import { WorkspaceOfferStatusFilter } from './workspace-offer-status-filter'
import { WorkspaceJobFilter } from './workspace-job-filter'
import { WorkspaceJobList } from './workspace-job-list'
import { WorkspaceUserSwitcher } from './workspace-user-switcher'
import { StickyNotesWorkspace } from './sticky-notes-workspace'
import { WorkspaceNotificationFocus, WorkspaceRealtimeRefresh } from './workspace-realtime-refresh'
import { SystemHistoryLiveBadge } from './system-history-live-badge'
import { WorkspaceSummaryNavigation } from './workspace-summary-navigation'
import { MobileWorkspaceCarousel, type MobileWorkspacePanel } from './mobile-workspace-carousel'
import { ManualActivityList } from './manual-activity-list'
import { ManualActivityCarousel } from './manual-activity-carousel'
import { ActivitiesHelpLauncher } from './activities-help-launcher'

export const metadata: Metadata = { title: 'Obchodní aktivita' }
export const dynamic = 'force-dynamic'

const PRAGUE_TIME_ZONE = 'Europe/Prague'
const WORKSPACE_NEW_BUTTON_CLASS = 'activities-workspace__new-action'

type ActivitiesSearchParams = Record<string, string | string[] | undefined>

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? ''
}

function formatDateTime(value: string | null) {
  if (!value) return 'Bez termínu'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Neznámý termín'
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PRAGUE_TIME_ZONE,
  }).format(date)
}

const WORKSPACE_COUNT_BADGE_CLASS = 'inline-flex min-w-6 items-center justify-center rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-bold leading-4 text-[var(--accent)]'
const WORKSPACE_ICON_COUNT_BADGE_CLASS = 'absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-white/75 bg-[var(--accent-soft)] px-1.5 text-[9px] font-extrabold leading-none text-[var(--accent)] shadow-[0_3px_8px_rgba(15,23,42,0.12)] [html[data-theme=dark]_&]:border-slate-700/80 [html[data-theme=dark]_&]:shadow-[0_3px_9px_rgba(0,0,0,0.32)]'

function CardHeader({
  eyebrow,
  title,
  count,
  icon: Icon,
  action,
}: {
  eyebrow: string
  title: string
  count?: number
  icon: typeof Activity
  action?: React.ReactNode
}) {
  return (
    <header className="flex min-h-11 items-start justify-between gap-1 sm:gap-3">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <span className="activities-workspace__card-icon relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--accent)] sm:h-10 sm:w-10 sm:rounded-2xl">
          <Icon aria-hidden size={18} />
          {count !== undefined ? <span className={WORKSPACE_ICON_COUNT_BADGE_CLASS}>{count}</span> : null}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)] sm:text-[10px] sm:tracking-[0.14em]">{eyebrow}</p>
          <div className="mt-0.5 flex items-center gap-2">
            <h2 className="truncate text-base font-semibold text-[var(--text-primary)] sm:text-lg">{title}</h2>
          </div>
        </div>
      </div>
      {action ? <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">{action}</div> : null}
    </header>
  )
}

function SmallAction({ href, children, primary = false }: {
  href: string
  children: React.ReactNode
  primary?: boolean
}) {
  return (
    <Link
      href={href}
      className={primary
        ? 'activities-workspace__small-action activities-workspace__small-action--primary inline-flex h-8 items-center justify-center rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-2.5 text-[10px] font-bold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_16px_rgba(41,128,185,0.22)] transition duration-200 hover:-translate-y-px sm:px-3'
        : 'activities-workspace__small-action inline-flex h-8 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-2.5 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition duration-200 hover:-translate-y-px hover:text-[var(--text-primary)] sm:px-3'}
    >
      {children}
    </Link>
  )
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="activities-workspace__empty-state flex min-h-28 items-center justify-center rounded-2xl border px-4 text-center text-sm text-[var(--text-secondary)]">
      {children}
    </div>
  )
}

function ActivityRow({
  item,
  automatic = false,
  showUserName = false,
  canManage = false,
  focused = false,
  clients = [],
}: {
  item: ActivityListItem
  automatic?: boolean
  showUserName?: boolean
  canManage?: boolean
  focused?: boolean
  clients?: Parameters<typeof ManualActivityCard>[0]['clients']
}) {
  if (!automatic) {
    return <ManualActivityCard item={item} clients={clients} canManage={canManage} focused={focused} />
  }

  const content = (
    <>
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${automatic ? 'bg-slate-400' : item.status === 'planned' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <strong className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{item.title}</strong>
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-[var(--text-secondary)]">
          {showUserName && item.user_name ? `${item.user_name} · ` : ''}{item.client_name ?? 'Bez klienta'} · {formatDateTime(item.status === 'planned' ? item.scheduled_for : item.occurred_at)}
        </span>
      </span>
      {item.source_path ? <ChevronRight aria-hidden size={15} className="mt-0.5 shrink-0 text-[var(--text-secondary)]" /> : null}
    </>
  )

  const className = `activities-workspace__row flex min-h-[52px] items-start gap-2.5 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2.5 transition hover:-translate-y-px ${focused ? 'activities-workspace__notification-focus' : ''}`
  return item.source_path && !canManage
    ? <Link href={item.source_path} className={className} data-activity-id={item.id}>{content}</Link>
    : <div className={className} data-activity-id={item.id}>{content}</div>
}

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams?: Promise<ActivitiesSearchParams>
}) {
  noStore()
  const params = searchParams ? await searchParams : {}
  const selectedUserId = firstParam(params.user)
  const selectedOfferStatus = firstParam(params.offerStatus)
  const selectedJobPeriod = firstParam(params.jobPeriod)
  const selectedJobStatus = firstParam(params.jobStatus)
  const focusedActivityId = firstParam(params.focus)
  const focusedStickyNoteId = firstParam(params.sticky)
  const [workspace, formOptions, focusedActivity] = await Promise.all([
    getActivitiesWorkspace({ selectedUserId, offerStatus: selectedOfferStatus, jobPeriod: selectedJobPeriod, jobStatus: selectedJobStatus }),
    getActivitiesWorkspaceFormOptions(),
    focusedActivityId ? getManualActivityById(focusedActivityId) : Promise.resolve(null),
  ])
  const canManageManualActivities = workspace.selectedUser.id === workspace.viewer.id
  const plannedActivities = focusedActivity?.status === 'planned' && !workspace.manualActivities.planned.some((item) => item.id === focusedActivity.id)
    ? [focusedActivity, ...workspace.manualActivities.planned]
    : workspace.manualActivities.planned
  const loggedActivities = focusedActivity && focusedActivity.status !== 'planned' && !workspace.manualActivities.logged.some((item) => item.id === focusedActivity.id)
    ? [focusedActivity, ...workspace.manualActivities.logged]
    : workspace.manualActivities.logged

  const summaryCards = [
    { label: 'Aktivity dnes / tento týden', value: `${workspace.kpis.activitiesToday} / ${workspace.kpis.activitiesThisWeek}`, tone: 'blue', targetId: 'pracovni-agenda', targetLabel: 'Pracovní agenda' },
    { label: 'Úkoly po termínu / celkem', value: `${workspace.kpis.overdueTasks} / ${workspace.kpis.activeTasks}`, tone: 'amber', targetId: 'pracovni-ukoly', targetLabel: 'Úkoly' },
    { label: 'Schůzky dnes / celkem', value: `${workspace.kpis.meetingsToday} / ${workspace.kpis.meetingsTotal}`, tone: 'violet', targetId: 'pracovni-schuzky', targetLabel: 'Schůzky' },
    { label: 'Zakázky dnes / celkem', value: `${workspace.kpis.jobsToday} / ${workspace.kpis.jobsTotal}`, tone: 'emerald', targetId: 'pracovni-zakazky', targetLabel: 'Zakázky' },
  ] as const
  const offerEyebrow = workspace.offers.selectedStatus === 'submitted'
    ? 'KE SCHVÁLENÍ'
    : workspace.offers.selectedStatus === 'in_progress'
      ? workspace.offers.mode === 'approval'
        ? 'ROZPRACOVANÉ'
        : 'V ŘEŠENÍ'
      : workspace.offers.selectedStatusLabel.toLocaleUpperCase('cs-CZ')
  const initialMobilePanel: MobileWorkspacePanel = selectedJobPeriod || selectedJobStatus
    ? 'jobs'
    : selectedOfferStatus
      ? 'offers'
      : 'tasks'

  return (
    <main className="activities-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)] text-[var(--foreground)]">
      <PresenceSectionTracker section="Aktivity" route="/activities" />
      <WorkspaceRealtimeRefresh />
      <WorkspaceNotificationFocus activityId={focusedActivityId} stickyNoteId={focusedStickyNoteId} />
      <ActivitiesHelpLauncher />
      <div aria-hidden className="activities-page__glow activities-page__glow--right pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl" />
      <div aria-hidden className="activities-page__glow activities-page__glow--left pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl" />

      <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-4 px-4 py-6 sm:px-6 lg:gap-5 lg:px-8">
        <section className="activities-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-5 xl:grid xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] xl:items-center">
            <div className="min-w-0">
              <h1 className="text-3xl font-semibold leading-none tracking-tight text-[var(--text-primary)]">
                <span className="sm:hidden">Obchodní aktivita</span>
                <span className="hidden sm:inline">Moje obchodní aktivita</span>
              </h1>
            </div>
            <div className={workspace.viewer.isAdmin ? 'hidden justify-start sm:flex lg:justify-center xl:justify-self-center' : 'flex justify-start lg:justify-center xl:justify-self-center'}>
              {workspace.viewer.isAdmin
                ? <WorkspaceUserSwitcher users={workspace.userOptions} selectedUserId={workspace.selectedUser.id} />
                : <span className="inline-flex h-9 min-w-[170px] items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 text-xs font-semibold text-[var(--text-primary)] sm:min-w-[190px]">{workspace.selectedUser.name}</span>}
            </div>
            <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-end lg:justify-center xl:w-auto xl:justify-self-end">
              {workspace.viewer.isAdmin ? <ActivityReportButton users={workspace.userOptions} /> : null}
              <Link href="/dashboard" className="offers-page__back-button clients-page__back-button inline-flex items-center justify-center whitespace-nowrap rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800">ZPĚT NA DASHBOARD</Link>
              <NewActivityButton clients={formOptions.clients} className="activities-page__hero-new-action clients-page__new-button whitespace-nowrap" />
            </div>
          </div>
        </section>

        <WorkspaceSummaryNavigation cards={[...summaryCards]} />

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-12 xl:gap-5">
          <article id="pracovni-agenda" data-workspace-card="manual" className="activities-page__panel activities-workspace__scroll-target relative min-h-[330px] overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:h-[740px] xl:col-span-8">
            <CardHeader eyebrow="VLASTNÍ PRÁCE" title="Pracovní agenda" count={workspace.manualActivities.plannedTotal + workspace.manualActivities.loggedTotal} icon={MessageSquareText} action={<NewActivityButton clients={formOptions.clients} label="NOVÁ" className={WORKSPACE_NEW_BUTTON_CLASS} replaceClassName />} />
            <ManualActivityCarousel initialSection={focusedActivity?.status === 'planned' || !focusedActivity ? 'planned' : 'logged'}>
              <section className="min-w-0">
                <div className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]"><Clock3 aria-hidden size={14} className="text-amber-500" /> Naplánované</h3><span className={WORKSPACE_COUNT_BADGE_CLASS}>{workspace.manualActivities.plannedTotal}</span></div>
                {plannedActivities.length > 0 ? <ManualActivityList key={`${workspace.selectedUser.id}-planned`} kind="planned" userId={workspace.selectedUser.id} initialItems={plannedActivities} initialLoadedCount={workspace.manualActivities.planned.length} initialTotal={workspace.manualActivities.plannedTotal} clients={formOptions.clients} canManage={canManageManualActivities} focusedActivityId={focusedActivityId} /> : <EmptyState>Žádná naplánovaná aktivita.</EmptyState>}
              </section>
              <section className="min-w-0">
                <div className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]"><CheckCircle2 aria-hidden size={14} className="text-emerald-500" /> Poslední zápisy</h3><span className={WORKSPACE_COUNT_BADGE_CLASS}>{workspace.manualActivities.loggedTotal}</span></div>
                {loggedActivities.length > 0 ? <ManualActivityList key={`${workspace.selectedUser.id}-logged`} kind="logged" userId={workspace.selectedUser.id} initialItems={loggedActivities} initialLoadedCount={workspace.manualActivities.logged.length} initialTotal={workspace.manualActivities.loggedTotal} clients={formOptions.clients} canManage={canManageManualActivities} focusedActivityId={focusedActivityId} /> : <EmptyState>Zatím bez ručních zápisů.</EmptyState>}
              </section>
            </ManualActivityCarousel>
          </article>

          <article data-workspace-card="system" className="activities-page__panel relative hidden min-h-[330px] flex-col overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:flex lg:h-[740px] xl:col-span-4">
            <CardHeader eyebrow="AUTOMATICKÉ ZÁZNAMY" title="Poslední události" icon={ClipboardList} action={<SystemHistoryLiveBadge />} />
            <div className="activities-workspace__system-scroll mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain" role="region" aria-label="Poslední automatické události" tabIndex={0}>{workspace.systemHistory.items.map((item) => <ActivityRow key={item.id} item={item} automatic showUserName={workspace.viewer.isAdmin} />)}{workspace.systemHistory.items.length === 0 ? <EmptyState>Systém zatím nezaznamenal žádnou událost.</EmptyState> : null}</div>
            <div className="mt-3 flex shrink-0 items-center justify-between gap-3">
              <p className="flex min-w-0 items-center gap-2 text-[10px] text-[var(--text-secondary)]"><CircleDot aria-hidden size={11} className="shrink-0" /> <span className="truncate">Dnes automaticky zaznamenáno: {workspace.systemHistory.today}</span></p>
              <SystemHistoryModalButton initialItems={workspace.systemHistory.items} total={workspace.systemHistory.total} userId={workspace.selectedUser.id} userName={workspace.viewer.isAdmin ? 'Celý tým' : workspace.selectedUser.name} />
            </div>
          </article>
        </section>

        <StickyNotesWorkspace initialItems={workspace.stickyNotes.items} initialTotal={workspace.stickyNotes.total} counts={workspace.stickyNotes.counts} clients={formOptions.clients} taskUsers={formOptions.taskUsers} taskContacts={formOptions.taskContacts} focusNoteId={focusedStickyNoteId} />

        <MobileWorkspaceCarousel
          initialPanel={initialMobilePanel}
          tabs={[
            { value: 'tasks', label: 'Úkoly' },
            { value: 'meetings', label: 'Schůzky' },
            { value: 'offers', label: 'Nabídky' },
            { value: 'jobs', label: 'Zakázky' },
          ]}
        >
          <article id="pracovni-ukoly" data-workspace-card="tasks" className="activities-page__panel activities-workspace__scroll-target relative flex h-[400px] flex-col overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] xl:col-span-4">
            <CardHeader eyebrow="CO JE POTŘEBA UDĚLAT" title="Úkoly" count={workspace.tasks.activeTotal} icon={ListTodo} action={<><SmallAction href="/tasks">Všechny</SmallAction><NewTaskButton users={formOptions.taskUsers} clients={formOptions.clients} contacts={formOptions.taskContacts} label="NOVÝ" className={WORKSPACE_NEW_BUTTON_CLASS} /></>} />
            <div className="activities-workspace__panel-scroll -mx-3 mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 pb-4 pt-2" role="region" aria-label="Seznam aktivních úkolů" tabIndex={0}><WorkspaceTaskList items={workspace.tasks.items} users={formOptions.taskUsers} clients={formOptions.clients} contacts={formOptions.taskContacts} />{workspace.tasks.items.length === 0 ? <EmptyState>Žádné aktivní úkoly.</EmptyState> : null}</div>
            {workspace.tasks.overdueTotal > 0 ? <p className="mt-3 flex shrink-0 items-center gap-2 text-[11px] font-semibold text-amber-600"><AlertTriangle aria-hidden size={13} /> Po termínu: {workspace.tasks.overdueTotal}</p> : null}
          </article>

          <article id="pracovni-schuzky" data-workspace-card="meetings" className="activities-page__panel activities-workspace__scroll-target relative flex h-[400px] flex-col overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] xl:col-span-4">
            <CardHeader eyebrow="NEJBLIŽŠÍ TERMÍNY" title="Schůzky" count={workspace.meetings.upcomingTotal} icon={UsersRound} action={<><SmallAction href="/meetings">Všechny</SmallAction><NewMeetingButton clients={formOptions.clients} contacts={formOptions.meetingContacts} label="NOVÁ" className={WORKSPACE_NEW_BUTTON_CLASS} /></>} />
            <div className="activities-workspace__panel-scroll -mx-3 mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 pb-4 pt-2" role="region" aria-label="Seznam nadcházejících schůzek" tabIndex={0}>{workspace.meetings.items.map((item) => <WorkspaceMeetingDetail key={item.id} meeting={item} clients={formOptions.clients} contacts={formOptions.meetingContacts} />)}{workspace.meetings.items.length === 0 ? <EmptyState>Žádná nadcházející schůzka.</EmptyState> : null}</div>
          </article>

          <article id="pracovni-nabidky" data-workspace-card="offers" className="activities-page__panel relative flex h-[400px] flex-col overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:col-span-2 xl:col-span-4">
            <CardHeader eyebrow={offerEyebrow} title="Nabídky" count={workspace.offers.total} icon={FileText} action={<>{workspace.offers.available ? <WorkspaceOfferStatusFilter options={workspace.offers.statusOptions} selectedStatus={workspace.offers.selectedStatus} /> : null}<SmallAction href="/offers">Všechny</SmallAction>{workspace.offers.available ? <NewOfferButton label="NOVÁ" className={WORKSPACE_NEW_BUTTON_CLASS} /> : null}</>} />
            <div className="activities-workspace__panel-scroll -mx-3 mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 pb-4 pt-2" role="region" aria-label={`Seznam nabídek: ${workspace.offers.selectedStatusLabel}`} tabIndex={0}><WorkspaceOfferList items={workspace.offers.items} />{workspace.offers.available && workspace.offers.items.length === 0 ? <EmptyState>Žádné nabídky ve zvoleném stavu.</EmptyState> : null}{!workspace.offers.available ? <EmptyState>Pro tuto sekci nemáte oprávnění.</EmptyState> : null}</div>
          </article>
        <section id="pracovni-zakazky" data-workspace-card="jobs" className="activities-page__panel activities-workspace__scroll-target relative flex h-[400px] flex-col overflow-hidden rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] lg:col-span-2 lg:h-[520px] xl:col-span-12">
          <header className="flex min-h-11 flex-row items-start justify-between gap-1 sm:gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3"><span className="activities-workspace__card-icon relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--accent)] sm:h-10 sm:w-10 sm:rounded-2xl"><Wrench aria-hidden size={18} /><span className={WORKSPACE_ICON_COUNT_BADGE_CLASS}>{workspace.jobs.total}</span></span><div className="min-w-0 flex-1"><p className="truncate whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)] sm:text-[10px] sm:tracking-[0.14em]">REALIZACE A VÝJEZDY</p><div className="mt-0.5 flex items-center gap-2"><h2 className="truncate text-base font-semibold text-[var(--text-primary)] sm:text-lg">Zakázky</h2></div></div></div>
            <div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2"><WorkspaceJobFilter selectedPeriod={workspace.jobs.selectedPeriod} selectedStatus={workspace.jobs.selectedStatus} /><SmallAction href="/jobs">Všechny</SmallAction>{workspace.jobs.canEdit ? <NewJobButton isAdmin label="NOVÁ" className={WORKSPACE_NEW_BUTTON_CLASS} /> : null}</div>
          </header>
          <div className="activities-workspace__panel-scroll -mx-3 mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-2" role="region" aria-label="Seznam zakázek" tabIndex={0}>
            {workspace.jobs.available ? <WorkspaceJobList items={workspace.jobs.items} canEdit={workspace.jobs.canEdit} /> : null}
            {workspace.jobs.available && workspace.jobs.items.length === 0 ? <EmptyState>Ve zvoleném období nejsou žádné zakázky.</EmptyState> : null}
            {!workspace.jobs.available ? <EmptyState>Pro tuto sekci nemáte oprávnění.</EmptyState> : null}
          </div>
        </section>
        </MobileWorkspaceCarousel>
      </div>
    </main>
  )
}
