'use client'

import {
  CalendarClock,
  CloudLightning,
  CloudRainWind,
  IceCreamBowl,
  Snowflake,
  Waves,
  Wind,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {
  WeatherForecastOutlook,
  WeatherForecastPhenomenonKey,
  WeatherInsightsWorkspace,
} from '@/lib/weather-insights/types'

type ForecastWorkspace = WeatherInsightsWorkspace['forecast']

const PHENOMENON_PRESENTATION: Record<
  WeatherForecastPhenomenonKey,
  { label: string; icon: LucideIcon }
> = {
  wind: { label: 'Silný vítr', icon: Wind },
  thunderstorm: { label: 'Bouřky', icon: CloudLightning },
  heavy_rain: { label: 'Silné srážky', icon: CloudRainWind },
  snow: { label: 'Sněžení', icon: Snowflake },
  icing: { label: 'Námraza a ledovka', icon: IceCreamBowl },
  flood: { label: 'Povodňové jevy', icon: Waves },
}

type ForecastPeriod = {
  key: string
  validFrom: string
  validTo: string
  outlooks: WeatherForecastOutlook[]
}

function formatIssuedAt(value: string | null) {
  if (!value) return 'Vydání zatím není dostupné'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Vydání zatím není dostupné'
  return `Vydáno ${new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)}`
}

function dateParts(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return {
    date,
    day: new Intl.DateTimeFormat('cs-CZ', {
      timeZone: 'Europe/Prague',
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
    }).format(date),
    time: new Intl.DateTimeFormat('cs-CZ', {
      timeZone: 'Europe/Prague',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date),
    dayKey: new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Prague',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date),
  }
}

function formatValidity(validFrom: string, validTo: string) {
  const from = dateParts(validFrom)
  const to = dateParts(validTo)
  if (!from || !to) return 'Platnost neuvedena'
  if (from.dayKey === to.dayKey) {
    return `${from.day} · ${from.time}–${to.time}`
  }
  return `${from.day} ${from.time} – ${to.day} ${to.time}`
}

function periodGroups(outlooks: WeatherForecastOutlook[]) {
  const groups = new Map<string, ForecastPeriod>()
  for (const outlook of outlooks) {
    const key = `${outlook.validFrom}:${outlook.validTo}`
    const group = groups.get(key)
    if (group) {
      group.outlooks.push(outlook)
    } else {
      groups.set(key, {
        key,
        validFrom: outlook.validFrom,
        validTo: outlook.validTo,
        outlooks: [outlook],
      })
    }
  }
  return [...groups.values()].sort(
    (left, right) =>
      new Date(left.validFrom).getTime() - new Date(right.validFrom).getTime(),
  )
}

function periodPhenomena(period: ForecastPeriod) {
  const phenomena = new Map<
    WeatherForecastPhenomenonKey,
    { key: WeatherForecastPhenomenonKey; name: string }
  >()
  for (const outlook of period.outlooks) {
    for (const phenomenon of outlook.relevantPhenomena) {
      if (!phenomena.has(phenomenon.key)) {
        phenomena.set(phenomenon.key, {
          key: phenomenon.key,
          name: PHENOMENON_PRESENTATION[phenomenon.key].label,
        })
      }
    }
  }
  return [...phenomena.values()]
}

function periodAreas(period: ForecastPeriod) {
  if (period.outlooks.some((outlook) => outlook.scopeType === 'national')) {
    return 'Celá Česká republika'
  }
  const areas = [...new Set(period.outlooks.map((outlook) => outlook.regionName))]
    .sort((left, right) => left.localeCompare(right, 'cs'))
  if (areas.length <= 3) return areas.join(', ')
  return `${areas.slice(0, 3).join(', ')} +${areas.length - 3}`
}

function periodSummary(period: ForecastPeriod) {
  const ordered = [...period.outlooks].sort((left, right) => {
    if (left.scopeType !== right.scopeType) return left.scopeType === 'national' ? -1 : 1
    return left.regionName.localeCompare(right.regionName, 'cs')
  })
  for (const outlook of ordered) {
    const structuredComment = outlook.relevantPhenomena.find(
      (phenomenon) =>
        phenomenon.source === 'structured' && phenomenon.textComment,
    )?.textComment
    const summary =
      structuredComment ||
      outlook.headline ||
      outlook.textWeather ||
      outlook.textWind
    if (summary) return summary
  }
  return 'Podrobnější popis ČHMÚ pro toto období není k dispozici.'
}

function ForecastPeriodCard({ period }: { period: ForecastPeriod }) {
  const phenomena = periodPhenomena(period)
  return (
    <article className="weather-alerts__record-surface min-w-0 rounded-[20px] border p-3.5 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong className="text-[11px] font-semibold text-[var(--text-primary)] sm:text-xs">
          {formatValidity(period.validFrom, period.validTo)}
        </strong>
        <span className="inline-flex h-6 items-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] px-2 text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]">
          {period.outlooks.some((outlook) => outlook.scopeType === 'national')
            ? 'Celostátní'
            : 'Regionální'}
        </span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {phenomena.map((phenomenon) => {
          const presentation = PHENOMENON_PRESENTATION[phenomenon.key]
          const Icon = presentation.icon
          return (
            <span
              key={phenomenon.key}
              className="inline-flex h-6 items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-500/10 px-2 text-[8px] font-bold uppercase tracking-[0.06em] text-sky-700 [html[data-theme=dark]_&]:text-sky-300"
            >
              <Icon aria-hidden size={10} />
              {phenomenon.name}
            </span>
          )
        })}
      </div>

      <p className="mt-2.5 line-clamp-3 text-[10px] leading-[16px] text-[var(--text-secondary)] sm:text-[11px] sm:leading-[17px]">
        {periodSummary(period)}
      </p>
      <div className="mt-2.5 border-t border-[var(--surface-border)] pt-2 text-[9px] font-semibold leading-4 text-[var(--text-primary)] sm:text-[10px]">
        {periodAreas(period)}
      </div>
    </article>
  )
}

export function WeatherForecastOutlookPanel({
  forecast,
}: {
  forecast: ForecastWorkspace
}) {
  const periods = periodGroups(forecast.outlooks)

  return (
    <section className="activities-page__panel min-w-0 overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--accent)]">
            <CalendarClock aria-hidden size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Výhled nebezpečných jevů
            </h2>
            <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">
              Jevy důležité pro provoz zachycené v předpovědi ČHMÚ
            </p>
          </div>
        </div>
        <span className="inline-flex h-7 shrink-0 items-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-muted)] px-2.5 text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
          {formatIssuedAt(forecast.issuedAt)}
        </span>
      </div>

      {periods.length > 0 ? (
        <div className="mt-4 max-h-[520px] overflow-y-auto overscroll-contain pr-1">
          <div className="grid min-w-0 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {periods.map((period) => (
              <ForecastPeriodCard key={period.key} period={period} />
            ))}
          </div>
        </div>
      ) : (
        <div className="weather-alerts__record-surface mt-4 flex min-h-[132px] flex-col items-center justify-center rounded-[22px] border px-5 py-4 text-center sm:min-h-[150px]">
          <CalendarClock aria-hidden size={23} className="text-[var(--text-tertiary)]" />
          <strong className="mt-2 text-sm text-[var(--text-primary)]">
            ČHMÚ nyní neuvádí nebezpečný jev ve výhledu.
          </strong>
          <span className="mt-1 max-w-md text-xs leading-5 text-[var(--text-secondary)]">
            Výhled se automaticky doplní, jakmile se v předpovědi objeví sledovaný jev.
          </span>
        </div>
      )}
    </section>
  )
}
