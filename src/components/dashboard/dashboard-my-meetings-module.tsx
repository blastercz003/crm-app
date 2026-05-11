'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

type MeetingsFilterKey = 'today' | 'week'

export function DashboardMyMeetingsModule({
  todayContent,
  weekContent,
}: {
  todayContent: ReactNode
  weekContent: ReactNode
}) {
  const [filter, setFilter] = useState<MeetingsFilterKey>('week')
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const filterDropdownRef = useRef<HTMLDivElement | null>(null)

  const activeFilterLabel = useMemo(
    () => (filter === 'today' ? 'SCHŮZKY DNES' : 'SCHŮZKY TENTO TÝDEN'),
    [filter]
  )

  useEffect(() => {
    function handleClickOutside(event: MouseEvent | TouchEvent) {
      if (!filterDropdownRef.current) return
      if (!filterDropdownRef.current.contains(event.target as Node)) {
        setIsFilterOpen(false)
      }
    }

    if (isFilterOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('touchstart', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [isFilterOpen])

  return (
    <div className="space-y-4">
      <div className="relative" ref={filterDropdownRef}>
        <button
          type="button"
          onClick={() => setIsFilterOpen((prev) => !prev)}
          className="flex h-11 w-full items-center justify-between rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-left text-base text-zinc-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)] focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef] sm:h-9 sm:text-sm"
          aria-haspopup="listbox"
          aria-expanded={isFilterOpen}
        >
          <span className="font-medium">{activeFilterLabel}</span>
          <span className="text-xs text-zinc-500">{isFilterOpen ? '▲' : '▼'}</span>
        </button>

        {isFilterOpen ? (
          <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-40 max-h-[260px] overflow-y-auto rounded-xl border border-white/75 bg-[linear-gradient(165deg,rgba(255,255,255,0.96)_0%,rgba(243,247,252,0.9)_100%)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_18px_38px_rgba(15,23,42,0.14)]">
            {[
              { key: 'week', label: 'SCHŮZKY TENTO TÝDEN' },
              { key: 'today', label: 'SCHŮZKY DNES' },
            ].map((item) => {
              const active = item.key === filter
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => {
                    setFilter(item.key as MeetingsFilterKey)
                    setIsFilterOpen(false)
                  }}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm transition ${
                    active
                      ? 'bg-[#2980B9] font-semibold text-white'
                      : 'text-zinc-700 hover:bg-white/75'
                  }`}
                >
                  <span>{item.label}</span>
                  {active ? <span className="text-xs">✓</span> : null}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>

      <div>{filter === 'today' ? todayContent : weekContent}</div>
    </div>
  )
}
