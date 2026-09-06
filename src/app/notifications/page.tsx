import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth/getCurrentProfile'
import { createClient } from '@/lib/supabase/server'
import {
  getCurrentUserNotificationStats,
  getCurrentUserNotifications,
} from '@/lib/notifications/getNotifications'
import { AppBadgeSync } from '@/components/pwa/app-badge-sync'
import { SafeRealtimeRefresh } from '@/components/realtime/safe-realtime-refresh'
import { ensureMeetingResultNotifications } from '@/lib/notifications/meetingNotifications'
import type {
  NotificationCategoryFilter,
  NotificationRow,
  NotificationStatusFilter,
} from '@/lib/notifications/types'
import {
  archiveAllReadNotifications,
  archiveNotification,
  deleteNotificationAsAdmin,
  markAllNotificationsRead,
  markNotificationRead,
  openNotification,
} from './actions'

export const metadata: Metadata = {
  title: 'Notifikace',
}

type NotificationsPageProps = {
  searchParams?: Promise<{
    search?: string
    status?: string
    category?: string
  }>
}

type StatCardProps = {
  label: string
  value: number
  variant?: 'primary' | 'dark' | 'success' | 'neutral'
}

const CATEGORY_LABELS: Record<NotificationCategoryFilter, string> = {
  all: 'Vše',
  assets: 'Majetek',
  tasks: 'Úkoly',
  meetings: 'Schůzky',
  offers: 'Nabídky',
  jobs: 'Zakázky',
  activities: 'Aktivity',
  weather: 'Počasí',
  power_outages: 'Odstávky',
  system: 'Systém',
}

const STATUS_LABELS: Record<NotificationStatusFilter, string> = {
  active: 'Vše aktivní',
  unread: 'Nové',
  today: 'Dnešní',
  archive: 'Archiv',
}

function StatCard({ label, value, variant = 'neutral' }: StatCardProps) {
  const className =
    variant === 'primary'
      ? 'border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.26),0_10px_20px_rgba(41,128,185,0.24)]'
      : variant === 'dark'
        ? 'border-zinc-800/90 bg-[linear-gradient(155deg,#3f3f46_0%,#18181b_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.14),0_10px_20px_rgba(24,24,27,0.24)]'
        : variant === 'success'
          ? 'border-emerald-500/80 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_22px_rgba(16,185,129,0.24)]'
          : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]'

  const labelClassName =
    variant === 'neutral'
      ? 'text-zinc-950'
      : variant === 'success'
        ? 'text-current/80'
        : 'text-white'

  return (
    <div
      data-variant={variant}
      className={`notifications-page__stat-card rounded-2xl border px-4 py-3 ${className}`}
    >
      <div className={`notifications-page__stat-label text-[10px] font-semibold uppercase tracking-[0.14em] ${labelClassName}`}>
        {label}
      </div>
      <div className="notifications-page__stat-value mt-1 text-lg font-semibold leading-none tracking-tight text-current">
        {value}
      </div>
    </div>
  )
}

function FilterTab({
  href,
  label,
  active,
}: {
  href: string
  label: string
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={[
        'notifications-page__filter-tab inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition duration-200',
        active
          ? 'border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_18px_rgba(41,128,185,0.22)]'
          : 'border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_14px_rgba(15,23,42,0.07)] hover:-translate-y-[1px] hover:text-zinc-900',
      ].join(' ')}
    >
      {label}
    </Link>
  )
}

function InfoChip({ label }: { label: string }) {
  return (
    <div className="notifications-page__info-chip inline-flex items-center rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] px-3 py-1.5 text-xs text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.07)]">
      {label}
    </div>
  )
}

function isStatusFilter(value: string | undefined): value is NotificationStatusFilter {
  return value === 'active' || value === 'unread' || value === 'today' || value === 'archive'
}

function isCategoryFilter(value: string | undefined): value is NotificationCategoryFilter {
  return (
    value === 'all' ||
    value === 'assets' ||
    value === 'tasks' ||
    value === 'meetings' ||
    value === 'jobs' ||
    value === 'offers' ||
    value === 'activities' ||
    value === 'weather' ||
    value === 'power_outages' ||
    value === 'system'
  )
}

function getNotificationsHref(params: {
  search: string
  status: NotificationStatusFilter
  category: NotificationCategoryFilter
}) {
  const query = new URLSearchParams()

  if (params.search) query.set('search', params.search)
  if (params.status !== 'unread') query.set('status', params.status)
  if (params.category !== 'all') query.set('category', params.category)

  const queryString = query.toString()
  return queryString ? `/notifications?${queryString}` : '/notifications'
}

function formatNotificationDate(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function NotificationCard({
  notification,
  isAdmin,
}: {
  notification: NotificationRow
  isAdmin: boolean
}) {
  const isUnread = !notification.read_at
  const isArchived = Boolean(notification.archived_at)
  const priorityChipClassName =
    notification.priority === 'high'
      ? 'border-red-300/90 bg-red-50/90 text-red-700'
      : notification.priority === 'normal'
        ? 'border-amber-300/90 bg-amber-50/90 text-amber-700'
        : 'border-emerald-300/90 bg-emerald-50/90 text-emerald-700'

  return (
    <article
      className={[
        'notifications-page__card',
        'rounded-[24px] border p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_10px_24px_rgba(15,23,42,0.09)] backdrop-blur-[12px]',
        isUnread
          ? 'border-[#d8e8f6]/92 bg-[linear-gradient(160deg,rgba(247,252,255,0.95)_0%,rgba(233,244,252,0.9)_48%,rgba(241,249,255,0.88)_100%)]'
          : 'border-white/78 bg-[linear-gradient(160deg,rgba(255,255,255,0.96)_0%,rgba(247,250,253,0.90)_52%,rgba(242,247,252,0.86)_100%)]',
        isArchived ? 'opacity-70' : '',
      ].join(' ')}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={[
                'notifications-page__status-chip',
                'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold',
                isUnread
                  ? 'border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24)]'
                  : 'border border-zinc-200/90 bg-zinc-50/90 text-zinc-500',
              ].join(' ')}
            >
              {isUnread ? 'NOVÁ' : isArchived ? 'Archiv' : 'Přečtená'}
            </span>
            <span className="notifications-page__category-chip inline-flex items-center rounded-full border border-[#8dbfe0]/70 bg-[#2980B9]/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#1f5f8f] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
              {CATEGORY_LABELS[notification.category]}
            </span>
            <span className="notifications-page__time ml-auto text-right text-xs text-zinc-400">
              {formatNotificationDate(notification.created_at)}
            </span>
          </div>

          <h2
            className={[
              'notifications-page__title',
              'mt-3 text-lg tracking-tight text-zinc-950',
              isUnread ? 'font-semibold' : 'font-medium',
            ].join(' ')}
          >
            {notification.title}
          </h2>

          {notification.message ? (
            <p className="notifications-page__message mt-2 text-sm leading-6 text-zinc-600">
              {notification.message}
            </p>
          ) : null}

          <div className="notifications-page__meta mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
            {notification.actor_name ? (
              <span className="notifications-page__actor notifications-page__pill notifications-page__pill--actor inline-flex items-center rounded-full border border-zinc-200/90 bg-zinc-100/85 px-2.5 py-1 text-[11px] font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
                Od: <span className="ml-1 font-semibold text-zinc-800">{notification.actor_name}</span>
              </span>
            ) : null}
            {notification.recipient_name ? (
              <span className="notifications-page__recipient notifications-page__pill notifications-page__pill--recipient inline-flex items-center rounded-full border border-zinc-200/90 bg-zinc-100/85 px-2.5 py-1 text-[11px] font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
                Pro: <span className="ml-1 font-semibold text-zinc-800">{notification.recipient_name}</span>
              </span>
            ) : null}
            {notification.priority ? (
              <span
                data-priority={notification.priority}
                className={`notifications-page__priority notifications-page__pill notifications-page__pill--priority inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.72)] ${priorityChipClassName}`}
              >
                Priorita: <span className="ml-1 font-semibold">{notification.priority === 'high' ? 'Vysoká' : notification.priority === 'normal' ? 'Střední' : 'Nízká'}</span>
              </span>
            ) : null}
          </div>
        </div>

        <div className="notifications-page__actions grid shrink-0 grid-cols-2 gap-2 md:flex md:flex-wrap md:justify-end">
          {notification.href ? (
            <form className="w-full md:w-auto" action={openNotification.bind(null, notification.id, notification.href)}>
              <button
                type="submit"
                className="notifications-page__open inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 md:w-auto"
              >
                OTEVŘÍT
              </button>
            </form>
          ) : null}

          {isUnread ? (
            <form className="w-full md:w-auto" action={markNotificationRead.bind(null, notification.id)}>
              <button
                type="submit"
                className="notifications-page__read inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-xs font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:text-zinc-900 md:w-auto"
              >
                PŘEČTENO
              </button>
            </form>
          ) : null}

          {!isArchived ? (
            <form className="w-full md:w-auto" action={archiveNotification.bind(null, notification.id)}>
              <button
                type="submit"
                className="notifications-page__archive inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-xs font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:text-zinc-900 md:w-auto"
              >
                ARCHIVOVAT
              </button>
            </form>
          ) : null}

          {isAdmin ? (
            <form className="w-full md:w-auto" action={deleteNotificationAsAdmin.bind(null, notification.id)}>
              <button
                type="submit"
                className="notifications-page__delete inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-red-300/90 bg-[linear-gradient(155deg,rgba(254,242,242,0.96)_0%,rgba(254,226,226,0.9)_100%)] px-4 text-xs font-medium text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(153,27,27,0.14)] transition duration-200 hover:-translate-y-[1px] hover:bg-[linear-gradient(155deg,rgba(254,242,242,0.98)_0%,rgba(254,226,226,0.94)_100%)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(153,27,27,0.20)] md:w-auto"
              >
                SMAZAT
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export default async function NotificationsPage({ searchParams }: NotificationsPageProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined
  const search = resolvedSearchParams?.search?.trim() ?? ''
  const status: NotificationStatusFilter = isStatusFilter(resolvedSearchParams?.status)
    ? resolvedSearchParams.status
    : 'unread'
  const category: NotificationCategoryFilter = isCategoryFilter(
    resolvedSearchParams?.category
  )
    ? resolvedSearchParams.category
    : 'all'

  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const profile = await getCurrentProfile()

  await ensureMeetingResultNotifications({ supabase, userId: profile.id })

  const [stats, notifications] = await Promise.all([
    getCurrentUserNotificationStats(),
    getCurrentUserNotifications({
      status,
      category,
      search,
      limit: 100,
    }),
  ])

  const isAdmin = profile.role === 'admin'
  const hasActiveMobileFilters = status !== 'unread' || category !== 'all'
  const mobileResetHref = getNotificationsHref({
    search,
    status: 'unread',
    category: 'all',
  })

  return (
    <main className="notifications-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <div
        aria-hidden
        className="notifications-page__glow--primary pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="notifications-page__glow--secondary pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
      />
      <AppBadgeSync count={stats.unread} />
      <SafeRealtimeRefresh scopes={['notifications']} />
      <div className="relative z-10 mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="notifications-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-end">
              <h1 className="text-3xl font-semibold leading-none tracking-tight text-gray-900">
                Moje notifikace
              </h1>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <form
                action="/notifications"
                method="get"
                className="flex w-full gap-3 sm:w-auto"
              >
                <input
                  id="notification-search"
                  name="search"
                  defaultValue={search}
                  placeholder="Název, text, typ notifikace..."
                  className="notifications-page__search-input w-full min-w-0 rounded-2xl border border-gray-200 bg-white/96 px-4 py-2.5 text-sm text-gray-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] outline-none transition duration-200 ease-out placeholder:text-gray-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] sm:w-56 lg:w-72"
                />
                <input type="hidden" name="status" value={status} />
                <input type="hidden" name="category" value={category} />

                <button
                  type="submit"
                  className="notifications-page__search-button rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] px-4 py-2.5 text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_7px_18px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]"
                >
                  HLEDAT
                </button>
              </form>

              <Link
                href="/dashboard"
                className="clients-page__back-button notifications-page__back-button inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800"
              >
                ZPĚT NA DASHBOARD
              </Link>
            </div>
          </div>
        </section>

        <section className="notifications-page__content rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="p-4 md:p-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
              <div className="min-w-0 hidden lg:block">
                <div className="notifications-page__section-label text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                  Zobrazení
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {(['unread', 'today', 'active', 'archive'] as NotificationStatusFilter[]).map(
                    (item) => (
                      <FilterTab
                        key={item}
                        href={getNotificationsHref({ search, status: item, category })}
                        label={STATUS_LABELS[item]}
                        active={status === item}
                      />
                    )
                  )}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <InfoChip label={`Pohled: ${STATUS_LABELS[status]}`} />
                  <InfoChip label={`Kategorie: ${CATEGORY_LABELS[category]}`} />
                  {search ? <InfoChip label={`Hledání: ${search}`} /> : null}
                  {isAdmin ? <InfoChip label="Admin" /> : null}
                </div>
              </div>

              <details className="group print-hidden w-full lg:hidden">
                <summary className="notifications-page__mobile-summary flex h-10 cursor-pointer list-none items-center justify-between gap-2.5 rounded-xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(242,247,252,0.88)_100%)] px-3 text-[12px] font-semibold uppercase tracking-[0.07em] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_16px_rgba(15,23,42,0.08)]">
                  <span className="inline-flex items-center gap-2">
                    FILTRY
                    {hasActiveMobileFilters ? (
                      <span className="inline-flex items-center rounded-full border border-[#8dbfe0]/90 bg-[linear-gradient(155deg,rgba(229,244,252,0.95)_0%,rgba(204,231,247,0.88)_100%)] px-1.5 py-0.5 text-[8px] font-semibold tracking-[0.07em] text-[#236f9f]">
                        FILTR AKTIVNÍ
                      </span>
                    ) : null}
                  </span>
                  <span className="text-xs text-zinc-500 transition group-open:rotate-180">⌄</span>
                </summary>

                <form
                  action="/notifications"
                  method="get"
                  className="notifications-page__mobile-panel mt-2 space-y-3 rounded-2xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]"
                >
                  <input type="hidden" name="search" value={search} />

                  <div>
                    <label
                      htmlFor="status-mobile"
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                    >
                      Zobrazení
                    </label>
                    <select
                      id="status-mobile"
                      name="status"
                      defaultValue={status}
                      className="notifications-page__mobile-select h-9 w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                    >
                      {(['unread', 'today', 'active', 'archive'] as NotificationStatusFilter[]).map(
                        (item) => (
                          <option key={item} value={item}>
                            {STATUS_LABELS[item]}
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="category-mobile"
                      className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500"
                    >
                      Kategorie
                    </label>
                    <select
                      id="category-mobile"
                      name="category"
                      defaultValue={category}
                      className="notifications-page__mobile-select h-9 w-full rounded-xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.94)_0%,rgba(241,245,250,0.88)_100%)] px-3 text-sm text-gray-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                    >
                      {(['all', 'assets', 'tasks', 'meetings', 'jobs', 'offers', 'activities', 'weather', 'power_outages', 'system'] as NotificationCategoryFilter[]).map(
                        (item) => (
                          <option key={item} value={item}>
                            {CATEGORY_LABELS[item]}
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  <div className="notifications-page__mobile-actions flex items-center gap-2 border-t border-gray-100 pt-3">
                    <button
                      type="submit"
                      className="notifications-page__mobile-submit inline-flex h-9 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-4 text-sm font-medium uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800"
                    >
                      POUŽÍT FILTRY
                    </button>

                    <Link
                      href={mobileResetHref}
                      className="notifications-page__mobile-reset inline-flex h-9 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-sm font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]"
                    >
                      RESET
                    </Link>
                  </div>
                </form>
              </details>

              <div className="notifications-page__stats hidden space-y-3 lg:block">
                <div className="grid grid-cols-4 gap-2">
                  <StatCard label="Nové" value={stats.unread} variant="primary" />
                  <StatCard label="Dnes" value={stats.today} variant="dark" />
                  <StatCard label="Aktivní" value={stats.active} />
                  <StatCard label="Archiv" value={stats.archived} variant="success" />
                </div>
              </div>
            </div>

            <div className="notifications-page__category-tabs mt-4 hidden flex-wrap gap-2 border-t border-white/70 pt-4 lg:flex">
              {(['all', 'assets', 'tasks', 'meetings', 'jobs', 'offers', 'activities', 'weather', 'power_outages', 'system'] as NotificationCategoryFilter[]).map(
                (item) => (
                  <FilterTab
                    key={item}
                    href={getNotificationsHref({ search, status, category: item })}
                    label={CATEGORY_LABELS[item]}
                    active={category === item}
                  />
                )
              )}
            </div>

            <div className="notifications-page__bulk-actions mt-4 flex flex-wrap items-center gap-3 pt-4 lg:border-t lg:border-white/70">
              <form action={markAllNotificationsRead}>
                <button
                  type="submit"
                className="notifications-page__mark-all inline-flex min-w-0 h-8 items-center justify-center whitespace-nowrap rounded-xl border border-[#6fa9d1] bg-[linear-gradient(155deg,#4d90c5_0%,#2f77af_100%)] px-2 text-[11px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_18px_rgba(41,128,185,0.22)] transition duration-200 hover:-translate-y-[1px] sm:h-9 sm:px-4 sm:text-sm"
              >
                OZNAČIT VŠE JAKO PŘEČTENÉ
              </button>
              </form>

              <form action={archiveAllReadNotifications}>
                <button
                  type="submit"
                className="notifications-page__archive-all inline-flex min-w-0 h-8 items-center justify-center whitespace-nowrap rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-2 text-[11px] font-medium uppercase text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] sm:h-9 sm:px-4 sm:text-sm"
              >
                ARCHIVOVAT PŘEČTENÉ
              </button>
              </form>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          {notifications.length > 0 ? (
            notifications.map((notification) => (
              <NotificationCard
                key={notification.id}
                notification={notification}
                isAdmin={isAdmin}
              />
            ))
          ) : (
            <div className="notifications-page__empty rounded-[24px] border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.96)_0%,rgba(247,250,253,0.9)_52%,rgba(242,247,252,0.86)_100%)] px-5 py-10 text-sm text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_12px_26px_rgba(15,23,42,0.08)] backdrop-blur-[10px]">
              Pro vybraný filtr tu nejsou žádné notifikace.
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
