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
    <section className="min-w-0 rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
      <div className="border-b border-white/60 px-4 py-4 sm:px-5">
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
                    : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] text-gray-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]'
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

      <div className="p-4 sm:p-5 xl:max-h-[70vh] xl:overflow-y-auto">
        {active.content}
      </div>
    </section>
  )
}
