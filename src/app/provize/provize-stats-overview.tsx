'use client'

import {
  AnimatedStatisticsNumber,
  AnimatedStatisticsProvider,
} from '@/components/ui/animated-statistics-number'

export type ProvizeStatsOverviewItem = {
  label: string
  unpaidValue: number
  paidValue: number
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('cs-CZ', {
    style: 'currency',
    currency: 'CZK',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Math.round(value))
}

export function ProvizeStatsOverview({
  items,
  animationKey,
}: {
  items: ProvizeStatsOverviewItem[]
  animationKey: string
}) {
  return (
    <AnimatedStatisticsProvider key={animationKey}>
      <div className={`mt-3 grid gap-2.5 ${items.length === 1 ? 'flex-1' : ''}`}>
        {items.map((item) => (
          <StatsCard
            key={item.label}
            className={items.length === 1 ? 'h-full' : undefined}
            item={item}
          />
        ))}
      </div>
    </AnimatedStatisticsProvider>
  )
}

function StatsCard({
  className,
  item,
}: {
  className?: string
  item: ProvizeStatsOverviewItem
}) {
  return (
    <article
      className={`rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_20px_rgba(15,23,42,0.08)] [html[data-theme='dark']_&]:border-[rgba(84,170,232,0.22)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(24,45,78,0.56)_0%,rgba(18,36,66,0.48)_52%,rgba(14,28,53,0.52)_100%)] [html[data-theme='dark']_&]:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_14px_28px_rgba(8,20,37,0.24)] ${
        className ?? ''
      }`}
    >
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-500 [html[data-theme='dark']_&]:text-slate-300">
        {item.label}
      </div>
      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
        <StatsValue label="Nevyplacené" value={item.unpaidValue} />
        <StatsValue label="Vyplacené" value={item.paidValue} />
      </div>
    </article>
  )
}

function StatsValue({ label, value }: { label: string; value: number }) {
  const finalValue = formatCurrency(value)

  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.12em] text-gray-500 [html[data-theme='dark']_&]:text-slate-400">
        {label}
      </div>
      <div
        className="mt-0.5 grid w-fit max-w-full text-lg font-semibold text-gray-900 [html[data-theme='dark']_&]:text-[#f8fbff]"
        title={finalValue}
      >
        <span
          aria-hidden="true"
          className="invisible col-start-1 row-start-1 whitespace-nowrap tabular-nums"
        >
          {finalValue}
        </span>
        <span className="col-start-1 row-start-1 whitespace-nowrap">
          <AnimatedStatisticsNumber value={value} formatter={formatCurrency} />
        </span>
      </div>
    </div>
  )
}
