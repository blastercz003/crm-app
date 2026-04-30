'use client'

import { ReactNode, useMemo, useState } from 'react'

type ActivityTabId = 'meetings' | 'tasks' | 'offers' | 'jobs'

type ActivityTab = {
  id: ActivityTabId
  label: string
  count: number
  tone: string
  activeTone: string
  content: ReactNode
}

type ClientActivityTabsProps = {
  meetingsCount: number
  tasksCount: number
  offersCount: number
  jobsCount: number
  meetingsContent: ReactNode
  tasksContent: ReactNode
  offersContent: ReactNode
  jobsContent: ReactNode
}

export function ClientActivityTabs({
  meetingsCount,
  tasksCount,
  offersCount,
  jobsCount,
  meetingsContent,
  tasksContent,
  offersContent,
  jobsContent,
}: ClientActivityTabsProps) {
  const [activeTab, setActiveTab] = useState<ActivityTabId>('meetings')

  const tabs = useMemo<ActivityTab[]>(
    () => [
      {
        id: 'meetings',
        label: 'Schůzky',
        count: meetingsCount,
        tone: 'bg-amber-50 text-amber-700 ring-amber-100',
        activeTone: 'border-amber-200 bg-amber-50 text-amber-800',
        content: meetingsContent,
      },
      {
        id: 'tasks',
        label: 'Úkoly',
        count: tasksCount,
        tone: 'bg-slate-100 text-slate-700 ring-slate-200',
        activeTone: 'border-slate-300 bg-slate-100 text-slate-900',
        content: tasksContent,
      },
      {
        id: 'offers',
        label: 'Nabídky',
        count: offersCount,
        tone: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
        activeTone: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        content: offersContent,
      },
      {
        id: 'jobs',
        label: 'Zakázky',
        count: jobsCount,
        tone: 'bg-violet-50 text-violet-700 ring-violet-100',
        activeTone: 'border-violet-200 bg-violet-50 text-violet-800',
        content: jobsContent,
      },
    ],
    [
      meetingsCount,
      tasksCount,
      offersCount,
      jobsCount,
      meetingsContent,
      tasksContent,
      offersContent,
      jobsContent,
    ]
  )

  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0]

  return (
    <section className="min-w-0 rounded-3xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-4 py-4 sm:px-5">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          {tabs.map((tab) => {
            const isActive = tab.id === active.id

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex h-10 min-w-0 items-center justify-center gap-2 rounded-2xl border px-3 text-sm font-medium transition ${
                  isActive
                    ? tab.activeTone
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                <span className="truncate">{tab.label}</span>
                <span
                  className={`inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold ring-1 ${tab.tone}`}
                >
                  {tab.count}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      <div className="p-4 sm:p-5">{active.content}</div>
    </section>
  )
}
