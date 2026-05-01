import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentProfile } from '@/lib/auth/getCurrentProfile'
import { createClient } from '@/lib/supabase/server'
import {
  getCurrentUserNotificationStats,
  getCurrentUserNotifications,
} from '@/lib/notifications/getNotifications'
import { AppBadgeSync } from '@/components/pwa/app-badge-sync'
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
  tasks: 'Úkoly',
  meetings: 'Schůzky',
  offers: 'Nabídky',
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
      ? 'border-[#2980B9] bg-[#2980B9] text-white'
      : variant === 'dark'
        ? 'border-zinc-800 bg-zinc-800 text-white'
        : variant === 'success'
          ? 'border-green-100 bg-green-100 text-green-800'
          : 'border-zinc-200 bg-white text-zinc-950'

  const labelClassName =
    variant === 'neutral'
      ? 'text-zinc-950'
      : variant === 'success'
        ? 'text-current/80'
        : 'text-white'

  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${className}`}>
      <div className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${labelClassName}`}>
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold leading-none tracking-tight text-current">
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
        'inline-flex items-center rounded-full px-4 py-2 text-sm font-medium transition',
        active
          ? 'bg-zinc-900 text-white shadow-sm'
          : 'border border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900',
      ].join(' ')}
    >
      {label}
    </Link>
  )
}

function InfoChip({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-xs text-zinc-500">
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
    value === 'tasks' ||
    value === 'meetings' ||
    value === 'offers' ||
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

  return (
    <article
      className={[
        'rounded-[24px] border bg-white p-5 shadow-sm',
        isUnread ? 'border-[#2980B9]/35' : 'border-zinc-200',
        isArchived ? 'opacity-70' : '',
      ].join(' ')}
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={[
                'inline-flex rounded-full px-2.5 py-1 text-xs font-semibold',
                isUnread
                  ? 'bg-[#2980B9] text-white'
                  : 'border border-zinc-200 bg-zinc-50 text-zinc-500',
              ].join(' ')}
            >
              {isUnread ? 'Nová' : isArchived ? 'Archiv' : 'Přečtená'}
            </span>
            <span className="text-xs font-medium text-zinc-400">
              {CATEGORY_LABELS[notification.category]}
            </span>
            <span className="text-xs text-zinc-400">
              {formatNotificationDate(notification.created_at)}
            </span>
          </div>

          <h2
            className={[
              'mt-3 text-lg tracking-tight text-zinc-950',
              isUnread ? 'font-semibold' : 'font-medium',
            ].join(' ')}
          >
            {notification.title}
          </h2>

          {notification.message ? (
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              {notification.message}
            </p>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-2 text-xs text-zinc-400">
            {notification.actor_name ? <span>Od: {notification.actor_name}</span> : null}
            {notification.recipient_name ? <span>Pro: {notification.recipient_name}</span> : null}
            {notification.priority === 'high' ? <span>Vysoká priorita</span> : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 md:justify-end">
          {notification.href ? (
            <form action={openNotification.bind(null, notification.id, notification.href)}>
              <button
                type="submit"
                className="inline-flex min-h-10 items-center rounded-xl bg-zinc-900 px-4 text-xs font-medium text-white transition hover:bg-zinc-800"
              >
                OTEVŘÍT
              </button>
            </form>
          ) : null}

          {isUnread ? (
            <form action={markNotificationRead.bind(null, notification.id)}>
              <button
                type="submit"
                className="inline-flex min-h-10 items-center rounded-xl border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900"
              >
                PŘEČTENO
              </button>
            </form>
          ) : null}

          {!isArchived ? (
            <form action={archiveNotification.bind(null, notification.id)}>
              <button
                type="submit"
                className="inline-flex min-h-10 items-center rounded-xl border border-zinc-200 bg-white px-4 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900"
              >
                ARCHIVOVAT
              </button>
            </form>
          ) : null}

          {isAdmin ? (
            <form action={deleteNotificationAsAdmin.bind(null, notification.id)}>
              <button
                type="submit"
                className="inline-flex min-h-10 items-center rounded-xl border border-red-200 bg-red-50 px-4 text-xs font-medium text-red-700 transition hover:bg-red-100"
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

  return (
    <main className="min-h-screen bg-gray-50">
      <AppBadgeSync count={stats.unread} />
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
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
                  className="w-full min-w-0 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-gray-300 focus:ring-2 focus:ring-gray-200 sm:w-56 lg:w-72"
                />
                <input type="hidden" name="status" value={status} />
                <input type="hidden" name="category" value={category} />

                <button
                  type="submit"
                  className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  HLEDAT
                </button>
              </form>

              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-2xl bg-black px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800"
              >
                ZPĚT NA DASHBOARD
              </Link>
            </div>
          </div>
        </section>

        <section className="rounded-[26px] border border-zinc-200 bg-white shadow-sm">
          <div className="p-4 md:p-5">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
              <div className="min-w-0">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
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

              <div className="space-y-3">
                <div className="grid grid-cols-4 gap-2">
                  <StatCard label="Nové" value={stats.unread} variant="primary" />
                  <StatCard label="Dnes" value={stats.today} variant="dark" />
                  <StatCard label="Aktivní" value={stats.active} />
                  <StatCard label="Archiv" value={stats.archived} variant="success" />
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-zinc-100 pt-4">
              {(['all', 'tasks', 'meetings', 'offers', 'system'] as NotificationCategoryFilter[]).map(
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

            <div className="mt-4 flex flex-wrap gap-3 border-t border-zinc-100 pt-4">
              <form action={markAllNotificationsRead}>
                <button
                  type="submit"
                  className="inline-flex min-w-0 h-8 items-center justify-center whitespace-nowrap rounded-xl bg-[#2980B9] px-2 text-[11px] font-medium text-white transition hover:bg-[#236f9f] sm:h-9 sm:px-4 sm:text-sm"
                >
                  OZNAČIT VŠE JAKO PŘEČTENÉ
                </button>
              </form>

              <form action={archiveAllReadNotifications}>
                <button
                  type="submit"
                  className="inline-flex min-w-0 h-8 items-center justify-center whitespace-nowrap rounded-xl border border-gray-200 bg-white px-2 text-[11px] font-medium uppercase text-gray-700 transition hover:bg-gray-50 sm:h-9 sm:px-4 sm:text-sm"
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
            <div className="rounded-[24px] border border-dashed border-zinc-300 bg-white px-5 py-10 text-sm text-zinc-500">
              Pro vybraný filtr tu nejsou žádné notifikace.
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
