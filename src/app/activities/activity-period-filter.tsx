'use client'

import { useState } from 'react'

export type ActivityPeriod = 'all' | 'today' | 'this_week' | 'this_month' | 'last_30_days' | 'custom'

export function ActivityPeriodFilter({
  id,
  defaultPeriod,
  defaultDateFrom,
  defaultDateTo,
}: {
  id: string
  defaultPeriod: ActivityPeriod
  defaultDateFrom: string
  defaultDateTo: string
}) {
  const [period, setPeriod] = useState<ActivityPeriod>(defaultPeriod)

  return (
    <div className="activities-page__filter-label">
      <label htmlFor={id}>Období</label>
      <div className="activities-page__filter-select-wrap relative min-w-0">
        <select
          id={id}
          name="period"
          value={period}
          onChange={(event) => setPeriod(event.target.value as ActivityPeriod)}
          className="activities-page__filter-control"
        >
          <option value="all">Vše</option>
          <option value="today">Dnes</option>
          <option value="this_week">Tento týden</option>
          <option value="this_month">Tento měsíc</option>
          <option value="last_30_days">Posledních 30 dní</option>
          <option value="custom">Vlastní období</option>
        </select>
        <span aria-hidden className="activities-page__filter-chevron pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 text-xs text-zinc-500 lg:block">⌄</span>
      </div>

      {period === 'custom' ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="min-w-0 text-[10px] font-semibold text-[var(--text-secondary)]">
            Od
            <input type="date" name="from" required defaultValue={defaultDateFrom} className="activities-page__filter-control mt-1" />
          </label>
          <label className="min-w-0 text-[10px] font-semibold text-[var(--text-secondary)]">
            Do
            <input type="date" name="to" required defaultValue={defaultDateTo} className="activities-page__filter-control mt-1" />
          </label>
        </div>
      ) : null}
    </div>
  )
}
