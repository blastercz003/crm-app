'use client'

import { useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
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
  assets: 'Majetek',
  tasks: 'Úkoly',
  meetings: 'Schůzky',
  offers: 'Nabídky',
  jobs: 'Zakázky',
  system: 'Systém',
}

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
        'notifications-modal__item group relative overflow-hidden rounded-2xl border px-4 py-3 transition duration-200 ease-out',
        isUnread
          ? 'notifications-modal__item--unread border-[#d8e8f6]/92 bg-[linear-gradient(160deg,rgba(247,252,255,0.95)_0%,rgba(233,244,252,0.9)_48%,rgba(241,249,255,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_10px_24px_rgba(15,23,42,0.09)] backdrop-blur-[12px] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_14px_30px_rgba(15,23,42,0.13)]'
          : 'notifications-modal__item--read border-white/78 bg-[linear-gradient(160deg,rgba(255,255,255,0.96)_0%,rgba(247,250,253,0.90)_52%,rgba(242,247,252,0.86)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_10px_24px_rgba(15,23,42,0.09)] backdrop-blur-[12px] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_14px_30px_rgba(15,23,42,0.13)]',
      ].join(' ')}
    >
      <span
        aria-hidden="true"
        className="notifications-modal__item-top-line pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white/85 to-transparent"
      />
      <span
        aria-hidden="true"
        className="notifications-modal__item-sheen pointer-events-none absolute -left-[40%] top-0 hidden h-full w-[38%] -skew-x-[18deg] bg-gradient-to-r from-transparent via-white/38 to-transparent opacity-0 transition duration-500 ease-out lg:block lg:group-hover:translate-x-[360%] lg:group-hover:opacity-100"
      />
      <div className="flex gap-3">
        <div
          className={[
            'notifications-modal__item-dot mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
            isUnread
              ? 'bg-[#2980B9] lg:shadow-[0_0_0_3px_rgba(41,128,185,0.20),0_0_18px_rgba(41,128,185,0.30)]'
              : 'bg-zinc-300',
          ].join(' ')}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <div
              className={[
                'notifications-modal__item-title text-sm text-zinc-950',
                isUnread ? 'font-semibold' : 'font-medium',
              ].join(' ')}
            >
              {notification.title}
            </div>
            <div className="notifications-modal__item-time text-xs text-zinc-400">
              {formatNotificationTime(notification.created_at)}
            </div>
          </div>

          {notification.message ? (
            <div
              className={[
                'notifications-modal__item-message mt-1 text-sm leading-5',
                isUnread ? 'text-zinc-800' : 'text-zinc-600',
              ].join(' ')}
            >
              {notification.message}
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="notifications-modal__item-category inline-flex items-center rounded-full border border-[#8dbfe0]/70 bg-[#2980B9]/12 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[#1f5f8f] shadow-[inset_0_1px_0_rgba(255,255,255,0.75)]">
              {CATEGORY_LABELS[notification.category]}
            </span>
            {notification.actor_name ? (
              <span className="notifications-modal__item-actor inline-flex items-center rounded-full border border-zinc-200/90 bg-zinc-100/85 px-2.5 py-1 text-[11px] font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
                Od: <span className="ml-1 font-semibold text-zinc-800">{notification.actor_name}</span>
              </span>
            ) : null}
            {notification.recipient_name ? (
              <span className="notifications-modal__item-recipient inline-flex items-center rounded-full border border-zinc-200/90 bg-zinc-100/85 px-2.5 py-1 text-[11px] font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
                Pro: <span className="ml-1 font-semibold text-zinc-800">{notification.recipient_name}</span>
              </span>
            ) : null}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {notification.href && notification.type !== 'manual_admin' ? (
              <button
                type="button"
                onClick={() => onOpen(notification)}
                disabled={disabled}
                className="notifications-modal__item-open inline-flex min-h-9 items-center rounded-xl border border-zinc-900 bg-zinc-900 px-3 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_22px_rgba(24,24,27,0.30)] transition duration-200 ease-out hover:-translate-y-[1px] hover:bg-zinc-800 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_14px_28px_rgba(24,24,27,0.36)] disabled:cursor-not-allowed disabled:opacity-60"
              >
                OTEVŘÍT
              </button>
            ) : null}

            <button
              type="button"
              onClick={() => onArchive(notification.id)}
              disabled={disabled}
              className="notifications-modal__item-archive inline-flex min-h-9 items-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-xs font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 ease-out hover:-translate-y-[1px] hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-60"
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
      )
        .slice()
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ),
    [notifications]
  )

  if (typeof document === 'undefined' || !isOpen) return null

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

  return createPortal(
    <div className="notifications-modal__overlay fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/38 px-4 backdrop-blur-[5px] lg:backdrop-blur-[6px]">
      <div className="notifications-modal__dialog relative flex max-h-[86vh] w-full max-w-[720px] flex-col overflow-hidden rounded-[28px] border border-zinc-200/95 bg-[linear-gradient(168deg,rgba(255,255,255,0.96)_0%,rgba(249,250,251,0.92)_42%,rgba(244,244,245,0.88)_100%)] shadow-[0_34px_84px_rgba(24,24,27,0.34)] lg:shadow-[0_40px_96px_rgba(24,24,27,0.38)]">
        <div
          aria-hidden="true"
          className="notifications-modal__dialog-frame pointer-events-none absolute inset-0 rounded-[28px] border border-white/65"
        />
        <div
          aria-hidden="true"
          className="notifications-modal__top-line pointer-events-none absolute inset-x-7 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-100"
        />
        <div
          aria-hidden="true"
          className="notifications-modal__top-glow pointer-events-none absolute inset-x-10 top-1 h-10 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.72),transparent_70%)]"
        />
        <button
          type="button"
          onClick={onClosed}
          disabled={isPending}
          aria-label="Zavřít"
          className="notifications-modal__close-button absolute right-4 top-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-zinc-200/95 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(245,245,246,0.88)_100%)] text-lg text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_10px_22px_rgba(39,39,42,0.14)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-zinc-300 hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.98),0_14px_28px_rgba(39,39,42,0.18)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          ×
        </button>

        <div className="notifications-modal__header border-b border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.70)_0%,rgba(255,255,255,0.24)_100%)] px-6 pb-5 pt-6 md:px-8 md:pt-7">
          <div className="notifications-modal__eyebrow text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Notifikační centrum
          </div>
          <h2 className="notifications-modal__title mt-2 pr-12 text-2xl font-semibold tracking-tight text-zinc-950 md:text-[30px]">
            Tvé aktuální notifikace.
          </h2>
          <div className="notifications-modal__subtitle mt-2 text-sm text-zinc-500">
            {unreadCount > 0
              ? `Máš ${unreadCount} nových notifikací.`
              : 'Žádné nové notifikace.'}
          </div>
        </div>

        <div className="notifications-modal__body min-h-0 flex-1 overflow-y-auto px-6 py-5 md:px-8">
          {visibleNotifications.length > 0 ? (
            <div className="grid gap-3">
              {visibleNotifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onOpen={handleOpenNotification}
                  onArchive={handleArchive}
                  disabled={isPending}
                />
              ))}
            </div>
          ) : (
            <div className="notifications-modal__empty rounded-2xl border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.96)_0%,rgba(247,250,253,0.90)_52%,rgba(242,247,252,0.86)_100%)] px-4 py-8 text-sm text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_10px_24px_rgba(15,23,42,0.09)] backdrop-blur-[12px]">
              Žádné nové notifikace.
            </div>
          )}

          {errorMessage ? (
            <div className="notifications-modal__error mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage}
            </div>
          ) : null}
        </div>

        <div className="notifications-modal__footer flex flex-nowrap items-center gap-3 border-t border-zinc-100/90 bg-[linear-gradient(180deg,rgba(255,255,255,0.24)_0%,rgba(255,255,255,0.68)_100%)] px-6 py-5 md:px-8">
          <button
            type="button"
            onClick={handleOpenAllNotifications}
            className="notifications-modal__footer-primary inline-flex min-h-[46px] min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-3 text-[13px] font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_14px_30px_rgba(24,24,27,0.30)] transition duration-200 ease-out hover:-translate-y-[1px] hover:bg-zinc-800 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_18px_36px_rgba(24,24,27,0.36)]"
          >
            ZOBRAZIT VŠE
          </button>

          <button
            type="button"
            onClick={handleMarkAllRead}
            disabled={isPending || unreadCount === 0}
            className="notifications-modal__footer-secondary inline-flex min-h-[46px] min-w-0 flex-1 items-center justify-center whitespace-nowrap rounded-2xl border border-[#2980B9] bg-[#2980B9] px-4 py-3 text-[13px] font-medium text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.48),0_14px_30px_rgba(24,95,145,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:border-[#2471A3] hover:bg-[#2471A3] hover:shadow-[inset_0_1px_0_rgba(170,217,247,0.52),0_18px_36px_rgba(24,95,145,0.40)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? (
              <span>UKLÁDÁM...</span>
            ) : (
              <>
                <span className="sm:hidden">VŠE PŘEČTENO</span>
                <span className="hidden sm:inline">OZNAČIT VŠE JAKO PŘEČTENÉ</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
    ,
    document.body
  )
}
