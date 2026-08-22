'use client'

import { useEffect, useState } from 'react'
import { NotificationsModal } from '@/components/notifications/notifications-modal'
import type { NotificationRow } from '@/lib/notifications/types'
import { getDashboardNotificationsAction } from '@/app/dashboard/dashboard-lazy-data-actions'

type DashboardUpdatesLauncherProps = {
  unreadCount: number
  receivedInvoicesDueCount?: number
  variant?: 'desktop' | 'mobile'
}

export function DashboardUpdatesLauncher({
  unreadCount,
  receivedInvoicesDueCount = 0,
  variant = 'desktop',
}: DashboardUpdatesLauncherProps) {
  void receivedInvoicesDueCount
  const [isOpen, setIsOpen] = useState(false)
  const [optimisticUnreadCount, setOptimisticUnreadCount] = useState(unreadCount)
  const [notifications, setNotifications] = useState<NotificationRow[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    setOptimisticUnreadCount(unreadCount)
  }, [unreadCount])

  async function openNotifications() {
    setIsOpen(true)
    setIsLoading(true)

    try {
      setNotifications(await getDashboardNotificationsAction())
    } catch {
      setNotifications([])
    } finally {
      setIsLoading(false)
    }
  }

  const buttonClassName =
    variant === 'mobile'
      ? 'dashboard-updates-launcher relative inline-flex min-h-[44px] w-full items-center justify-center overflow-visible rounded-2xl border border-[#2f2f2f]/95 bg-[linear-gradient(160deg,rgba(38,38,38,0.95)_0%,rgba(20,20,20,0.96)_45%,rgba(8,8,8,0.98)_100%)] px-5 text-sm font-semibold uppercase tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_9px_20px_rgba(0,0,0,0.42)] backdrop-blur-xl transition duration-200 ease-out hover:-translate-y-0.5 hover:border-[#3a3a3a] hover:bg-[linear-gradient(160deg,rgba(48,48,48,0.96)_0%,rgba(28,28,28,0.97)_45%,rgba(12,12,12,0.99)_100%)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_12px_24px_rgba(0,0,0,0.52)] active:scale-[0.98] active:bg-[linear-gradient(160deg,rgba(52,52,52,0.97)_0%,rgba(32,32,32,0.98)_45%,rgba(14,14,14,0.99)_100%)] active:shadow-[inset_0_3px_8px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(255,255,255,0.16),0_10px_22px_rgba(0,0,0,0.46)]'
      : 'dashboard-updates-launcher relative inline-flex min-h-full w-[140px] shrink-0 self-stretch items-center justify-center overflow-visible rounded-2xl border border-[#2f2f2f]/95 bg-[linear-gradient(160deg,rgba(38,38,38,0.95)_0%,rgba(20,20,20,0.96)_45%,rgba(8,8,8,0.98)_100%)] px-5 text-sm font-semibold uppercase tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_8px_18px_rgba(0,0,0,0.42)] backdrop-blur-xl transition duration-200 ease-out hover:-translate-y-0.5 hover:border-[#3a3a3a] hover:bg-[linear-gradient(160deg,rgba(48,48,48,0.96)_0%,rgba(28,28,28,0.97)_45%,rgba(12,12,12,0.99)_100%)] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_12px_24px_rgba(0,0,0,0.52)] active:bg-[linear-gradient(160deg,rgba(52,52,52,0.97)_0%,rgba(32,32,32,0.98)_45%,rgba(14,14,14,0.99)_100%)] active:shadow-[inset_0_3px_8px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(255,255,255,0.16),0_10px_22px_rgba(0,0,0,0.46)]'

  return (
    <>
      <button
        type="button"
        onClick={() => void openNotifications()}
        className={buttonClassName}
      >
        <span className="relative z-10">NOTIFIKACE</span>
        {optimisticUnreadCount > 0 ? (
          <span className="absolute -right-2 -top-2 z-20 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full border-2 border-red-600 bg-red-600 px-1.5 text-[11px] font-semibold leading-none text-white">
            {optimisticUnreadCount > 99 ? '99+' : optimisticUnreadCount}
          </span>
        ) : null}
      </button>

      <NotificationsModal
        isOpen={isOpen}
        notifications={notifications}
        unreadCount={optimisticUnreadCount}
        isLoading={isLoading}
        onUnreadCountChange={setOptimisticUnreadCount}
        onClosed={() => setIsOpen(false)}
      />
    </>
  )
}
