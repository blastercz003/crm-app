'use client'

import { useEffect, useState } from 'react'
import { NotificationsModal } from '@/components/notifications/notifications-modal'
import type { NotificationRow } from '@/lib/notifications/types'

type DashboardUpdatesLauncherProps = {
  notifications: NotificationRow[]
  unreadCount: number
  receivedInvoicesDueCount?: number
  variant?: 'desktop' | 'mobile'
}

export function DashboardUpdatesLauncher({
  notifications,
  unreadCount,
  receivedInvoicesDueCount = 0,
  variant = 'desktop',
}: DashboardUpdatesLauncherProps) {
  void receivedInvoicesDueCount
  const [isOpen, setIsOpen] = useState(false)
  const [optimisticUnreadCount, setOptimisticUnreadCount] = useState(unreadCount)

  useEffect(() => {
    setOptimisticUnreadCount(unreadCount)
  }, [unreadCount])

  const buttonClassName =
    variant === 'mobile'
      ? 'relative inline-flex min-h-[44px] w-full items-center justify-center overflow-visible rounded-2xl border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] px-5 text-sm font-semibold uppercase tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_14px_34px_rgba(9,48,82,0.44)] backdrop-blur-xl transition duration-200 ease-out hover:-translate-y-0.5 hover:border-[#1f5f8e] hover:shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_20px_38px_rgba(9,48,82,0.60)] active:scale-[0.98]'
      : 'relative inline-flex min-h-full self-stretch items-center justify-center overflow-visible rounded-2xl border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] px-5 text-sm font-semibold uppercase tracking-[0.08em] text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_28px_rgba(9,48,82,0.40)] backdrop-blur-xl transition duration-200 ease-out hover:-translate-y-0.5 hover:border-[#1f5f8e] hover:shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_20px_38px_rgba(9,48,82,0.60)]'

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={buttonClassName}
      >
        <span className="relative z-10">NOTIFIKACE</span>
        {optimisticUnreadCount > 0 ? (
          <span className="absolute -right-2 -top-2 z-20 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-red-600 px-1.5 text-[11px] font-semibold leading-none text-white">
            {optimisticUnreadCount > 99 ? '99+' : optimisticUnreadCount}
          </span>
        ) : null}
      </button>

      <NotificationsModal
        isOpen={isOpen}
        notifications={notifications}
        unreadCount={optimisticUnreadCount}
        onUnreadCountChange={setOptimisticUnreadCount}
        onClosed={() => setIsOpen(false)}
      />
    </>
  )
}
