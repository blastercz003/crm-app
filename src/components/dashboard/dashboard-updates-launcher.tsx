'use client'

import { useState } from 'react'
import { DashboardWelcomeOverlay } from '@/components/dashboard/dashboard-welcome-overlay'

type OverlaySummaryItem = {
  label: string
  value: string
  tone?: 'default' | 'highlight' | 'success' | 'warning'
}

type DashboardUpdatesLauncherProps = {
  shouldShow: boolean
  profileName: string
  newTasksCount: number
  completedDelegatedTasksCount: number
  todayMeetingsCount: number
  overdueTasksCount: number
  headline?: string
  description?: string
  summaryItems?: OverlaySummaryItem[]
}

export function DashboardUpdatesLauncher({
  shouldShow,
  profileName,
  newTasksCount,
  completedDelegatedTasksCount,
  todayMeetingsCount,
  overdueTasksCount,
  headline,
  description,
  summaryItems,
}: DashboardUpdatesLauncherProps) {
  const [isManualOpen, setIsManualOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setIsManualOpen(true)}
        className="primary-ambient-glow--blue relative inline-flex min-h-[44px] w-full items-center justify-center overflow-visible rounded-2xl border border-[#2980B9] bg-[#2980B9] px-5 text-sm font-semibold uppercase tracking-[0.08em] text-white transition hover:bg-[#2471A3] lg:min-h-full lg:w-auto lg:self-stretch"
      >
        <span className="relative z-10">NOVINKY</span>
      </button>

      <DashboardWelcomeOverlay
        shouldShow={shouldShow || isManualOpen}
        profileName={profileName}
        newTasksCount={newTasksCount}
        completedDelegatedTasksCount={completedDelegatedTasksCount}
        todayMeetingsCount={todayMeetingsCount}
        overdueTasksCount={overdueTasksCount}
        headline={headline}
        description={description}
        summaryItems={summaryItems}
        onClosed={() => setIsManualOpen(false)}
      />
    </>
  )
}
