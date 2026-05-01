'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  archiveNotification,
  markAllNotificationsRead,
  markNotificationRead,
} from '@/app/notifications/actions'
import type { NotificationCategory, NotificationRow } from '@/lib/notifications/types'
import { setAppBadgeCount } from '@/lib/pwa/appBadge'

type NotificationsModalProps = {
  isOpen: boolean
  notifications: NotificationRow[]
  unreadCount: number
  onUnreadCountChange: (count: number) => void
  onClosed: () => void
}

const CATEGORY_LABELS: Record<NotificationCategory, string> = {
  tasks: 'Úkoly',
  meetings: 'Schůzky',
  offers: 'Nabídky',
  system: 'Systém',
}

const CATEGORY_ORDER: NotificationCategory[] = ['tasks', 'meetings', 'offers', 'system']

function isTodayInPrague(value: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  return formatter.format(new Date(value)) === formatter.format(new Date())
}

function formatNotificationTime(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function NotificationItem({
  notification,
  onOpen,
  onArchive,
  disabled,
}: {
  notification: NotificationRow
  onOpen: (notification: NotificationRow) => void
  onArchive: (notificationId: string) => void
  disabled: boolean
}) {
  const isUnread = !notification.read_at

  return (
    <div
      className={[
        'rounded-2xl border px-4 py-3 transition',
        isUnread
          ? 'border-[#2980B9]/30 bg-[#2980B9]/5'
          : 'border-zinc-200 bg-zinc-50',
      ].join(' ')}
    >
      <div className="flex gap-3">
        <div
          className={[
            'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
            isUnread ? 'bg-[#2980B9]' : 'bg-zinc-300',
          ].join(' ')}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <div
              className={[
                'text-sm text-zinc-950',
                isUnread ? 'font-semibold' : 'font-medium',
              ].join(' ')}
            >
              {notification.title}
            </div>
            <div className="text-xs text-zinc-400">
              {formatNotificationTime(notification.created_at)}
            </div>
          </div>

          {notification.message ? (
            <div
              className={[
                'mt-1 text-sm leading-5',
                isUnread ? 'text-zinc-800' : 'text-zinc-600',
              ].join(' ')}
            >
              {notification.message}
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <span>{CATEGORY_LABELS[notification.category]}</span>
            {notification.actor_name ? <span>Od: {notification.actor_name}</span> : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {notification.href ? (
              <button
                type="button"
                onClick={() => onOpen(notification)}
                disabled={disabled}
                className="inline-flex min-h-9 items-center rounded-xl bg-zinc-900 px-3 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                OTEVŘÍT
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => onArchive(notification.id)}
              disabled={disabled}
              className="inline-flex min-h-9 items-center rounded-xl border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
            >
              ARCHIVOVAT
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function NotificationsModal({
  isOpen,
  notifications,
  unreadCount,
  onUnreadCountChange,
  onClosed,
}: NotificationsModalProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const visibleNotifications = useMemo(
    () =>
      notifications.filter(
        (notification) =>
          !notification.archived_at &&
          (!notification.read_at || isTodayInPrague(notification.created_at))
      ),
    [notifications]
  )

  const groupedNotifications = CATEGORY_ORDER.map((category) => ({
    category,
    notifications: visibleNotifications.filter(
      (notification) => notification.category === category
    ),
  })).filter((group) => group.notifications.length > 0)

  if (!isOpen) return null

  function syncUnreadCount(nextCount: number) {
    const normalizedCount = Math.max(0, nextCount)

    onUnreadCountChange(normalizedCount)
    setAppBadgeCount(normalizedCount).catch(() => {})
  }

  function handleOpenNotification(notification: NotificationRow) {
    if (!notification.href) return

    setErrorMessage(null)
    startTransition(async () => {
      try {
        if (!notification.read_at) {
          await markNotificationRead(notification.id)
          syncUnreadCount(unreadCount - 1)
        }

        onClosed()
        router.push(notification.href!)
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Nepodařilo se otevřít notifikaci.'
        )
      }
    })
  }

  function handleMarkAllRead() {
    setErrorMessage(null)
    startTransition(async () => {
      try {
        await markAllNotificationsRead()
        syncUnreadCount(0)
        router.refresh()
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Nepodařilo se označit notifikace jako přečtené.'
        )
      }
    })
  }

  function handleOpenAllNotifications() {
    onClosed()
    router.push('/notifications')
  }

  function handleArchive(notificationId: string) {
    setErrorMessage(null)
    startTransition(async () => {
      try {
        await archiveNotification(notificationId)
        const archivedNotification = notifications.find(
          (notification) => notification.id === notificationId
        )

        if (archivedNotification && !archivedNotification.read_at) {
          syncUnreadCount(unreadCount - 1)
        }

        router.refresh()
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Nepodařilo se archivovat notifikaci.'
        )
      }
    })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/45 px-4 backdrop-blur-sm">
      <div className="relative flex max-h-[86vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-2xl">
        <button
          type="button"
          onClick={onClosed}
          disabled={isPending}
          aria-label="Zavřít"
          className="absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200 bg-white text-lg text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
        >
          ×
        </button>

        <div className="border-b border-zinc-100 px-6 pb-5 pt-6 md:px-8 md:pt-7">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Notifikační centrum
          </div>
          <h2 className="mt-2 pr-12 text-2xl font-semibold tracking-tight text-zinc-950 md:text-[30px]">
            Tvé aktuální notifikace.
          </h2>
          <div className="mt-2 text-sm text-zinc-500">
            {unreadCount > 0
              ? `Máš ${unreadCount} nových notifikací.`
              : 'Žádné nové notifikace. Dnešní přečtené tu zůstávají do konce dne.'}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 md:px-8">
          {groupedNotifications.length > 0 ? (
            <div className="space-y-5">
              {groupedNotifications.map((group) => (
                <section key={group.category}>
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                    {CATEGORY_LABELS[group.category]}
                  </div>
                  <div className="grid gap-3">
                    {group.notifications.map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onOpen={handleOpenNotification}
                        onArchive={handleArchive}
                        disabled={isPending}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
              Žádné nové notifikace.
            </div>
          )}

          {errorMessage ? (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-3 border-t border-zinc-100 px-6 py-5 md:px-8">
          <button
            type="button"
            onClick={handleOpenAllNotifications}
            className="inline-flex min-h-[46px] items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800"
          >
            ZOBRAZIT VŠE
          </button>

          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={isPending || unreadCount === 0}
            className="primary-ambient-glow--blue inline-flex min-h-[46px] items-center rounded-2xl border border-[#2980B9] bg-[#2980B9] px-5 py-3 text-sm font-medium text-white transition hover:bg-[#2471A3] disabled:cursor-not-allowed disabled:opacity-60"
          >
            OZNAČIT VŠE JAKO PŘEČTENÉ
          </button>
        </div>
      </div>
    </div>
  )
}
