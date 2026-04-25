'use client'

import { useState } from 'react'
import { NotificationsModal } from '@/components/notifications/notifications-modal'
import type { NotificationRow } from '@/lib/notifications/types'

type DashboardUpdatesLauncherProps = {
  notifications: NotificationRow[]
  unreadCount: number
  variant?: 'desktop' | 'mobile'
}

export function DashboardUpdatesLauncher({
  notifications,
  unreadCount,
  variant = 'desktop',
}: DashboardUpdatesLauncherProps) {
  const [isOpen, setIsOpen] = useState(false)

  const buttonClassName =
    variant === 'mobile'
      ? 'primary-ambient-glow--blue relative inline-flex min-h-[44px] w-full items-center justify-center overflow-visible rounded-2xl border border-[#2980B9] bg-[#2980B9] px-5 text-sm font-semibold uppercase tracking-[0.08em] text-white transition hover:bg-[#2471A3]'
      : 'primary-ambient-glow--blue relative inline-flex min-h-full self-stretch items-center justify-center overflow-visible rounded-2xl border border-[#2980B9] bg-[#2980B9] px-5 text-sm font-semibold uppercase tracking-[0.08em] text-white transition hover:bg-[#2471A3]'

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={buttonClassName}
      >
        <span className="relative z-10">NOTIFIKACE</span>
        {unreadCount > 0 ? (
          <span className="absolute -right-2 -top-2 z-20 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-red-600 px-1.5 text-[11px] font-semibold leading-none text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      <NotificationsModal
        isOpen={isOpen}
        notifications={notifications}
        unreadCount={unreadCount}
        onClosed={() => setIsOpen(false)}
      />
    </>
  )
}
