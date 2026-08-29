'use client'

import {
  CloudRain,
  Gauge,
  ThermometerSnowflake,
  ThermometerSun,
  Wind,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type {
  WeatherInsightsWorkspace,
  WeatherObservationExtreme,
  WeatherObservationMetricKey,
} from '@/lib/weather-insights/types'

type ObservationsWorkspace = WeatherInsightsWorkspace['observations']

type MetricPresentation = {
  label: string
  mobileLabel: string
  shortLabel: string
  icon: LucideIcon
  tone: string
  iconSurface: string
}

const METRIC_ORDER: WeatherObservationMetricKey[] = [
  'temperature_max',
  'temperature_min',
  'wind_gust_max',
  'precipitation_max',
]

const METRIC_PRESENTATION: Record<WeatherObservationMetricKey, MetricPresentation> = {
  temperature_max: {
    label: 'Nejvyšší teplota',
    mobileLabel: 'Nejvyšší',
    shortLabel: 'Maximum teploty',
    icon: ThermometerSun,
    tone: 'text-orange-700 [html[data-theme=dark]_&]:text-orange-300',
    iconSurface: 'border-orange-500/25 bg-orange-500/10',
  },
  temperature_min: {
    label: 'Nejnižší teplota',
    mobileLabel: 'Nejnižší',
    shortLabel: 'Minimum teploty',
    icon: ThermometerSnowflake,
    tone: 'text-sky-700 [html[data-theme=dark]_&]:text-sky-300',
    iconSurface: 'border-sky-500/25 bg-sky-500/10',
  },
  wind_gust_max: {
    label: 'Nejsilnější náraz',
    mobileLabel: 'Vítr',
    shortLabel: 'Náraz větru',
    icon: Wind,
    tone: 'text-cyan-700 [html[data-theme=dark]_&]:text-cyan-300',
    iconSurface: 'border-cyan-500/25 bg-cyan-500/10',
  },
  precipitation_max: {
    label: 'Nejvyšší srážky',
    mobileLabel: 'Déšť',
    shortLabel: 'Srážky za hodinu',
    icon: CloudRain,
    tone: 'text-indigo-700 [html[data-theme=dark]_&]:text-indigo-300',
    iconSurface: 'border-indigo-500/25 bg-indigo-500/10',
  },
}

function formatSnapshotTime(value: string | null) {
  if (!value) return 'Čas měření zatím není dostupný'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Čas měření zatím není dostupný'
  return `Měřeno ${new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)}`
}

function formatValue(item: WeatherObservationExtreme) {
  const maximumFractionDigits = Number.isInteger(item.value) ? 0 : 1
  return `${new Intl.NumberFormat('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(item.value)} ${item.unit}`
}

function MetricCard({
  metricKey,
  values,
}: {
  metricKey: WeatherObservationMetricKey
  values: WeatherObservationExtreme[]
}) {
  const presentation = METRIC_PRESENTATION[metricKey]
  const Icon = presentation.icon
  const [primary, ...others] = values

  return (
    <article className="weather-alerts__record-surface min-w-0 rounded-[20px] border p-3 sm:p-3.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border ${presentation.iconSurface} ${presentation.tone}`}>
          <Icon aria-hidden size={16} />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)] sm:text-[11px]">
            <span className="sm:hidden">{presentation.mobileLabel}</span>
            <span className="hidden sm:inline">{presentation.label}</span>
          </h3>
          <span className="block truncate text-[8px] text-[var(--text-tertiary)] sm:text-[9px]">
            {presentation.shortLabel}
          </span>
        </div>
      </div>

      {primary ? (
        <>
          <div className="mt-3 min-w-0">
            <strong className={`block text-[22px] font-semibold leading-none tabular-nums sm:text-2xl ${presentation.tone}`}>
              {formatValue(primary)}
            </strong>
            <span className="mt-1.5 block truncate text-[10px] font-semibold text-[var(--text-primary)] sm:text-[11px]" title={primary.stationName}>
              {primary.stationName}
            </span>
          </div>

          {others.length > 0 ? (
            <div className="mt-3 space-y-1.5 border-t border-[var(--surface-border)] pt-2.5">
              {others.map((item) => (
                <div key={item.id} className="flex min-w-0 items-center gap-2 text-[9px] sm:text-[10px]">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--surface-strong)] text-[7px] font-bold text-[var(--text-tertiary)]">
                    {item.rank}.
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]" title={item.stationName}>
                    {item.stationName}
                  </span>
                  <strong className="shrink-0 tabular-nums text-[var(--text-primary)]">
                    {formatValue(item)}
                  </strong>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <div className="mt-3 flex min-h-[76px] items-center justify-center rounded-xl border border-dashed border-[var(--surface-border)] px-2 text-center text-[9px] leading-4 text-[var(--text-secondary)]">
          Měření zatím není dostupné.
        </div>
      )}
    </article>
  )
}

export function WeatherObservationExtremesPanel({
  observations,
}: {
  observations: ObservationsWorkspace
}) {
  const grouped = new Map<WeatherObservationMetricKey, WeatherObservationExtreme[]>()
  for (const metricKey of METRIC_ORDER) grouped.set(metricKey, [])
  for (const item of observations.extremes) {
    grouped.get(item.metricKey)?.push(item)
  }
  for (const values of grouped.values()) {
    values.sort((left, right) => left.rank - right.rank)
  }
  const hasData = observations.extremes.length > 0

  return (
    <section id="weather-observations" className="activities-page__panel relative min-w-0 scroll-mt-6 overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3 pr-[92px] sm:pr-0">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--accent)]">
            <Gauge aria-hidden size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Naměřené extrémy
            </h2>
            <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">
              Aktuální hodnoty ze stanic ČHMÚ
            </p>
          </div>
        </div>
        <span className="absolute right-4 top-4 inline-flex h-5 shrink-0 items-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-muted)] px-1.5 text-[6px] font-bold uppercase tracking-[0.045em] text-[var(--text-secondary)] sm:static sm:h-7 sm:px-2.5 sm:text-[8px] sm:tracking-[0.08em]">
          {formatSnapshotTime(observations.snapshotAt)}
        </span>
      </div>

      {hasData ? (
        <div className="mt-4 grid min-w-0 grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-3">
          {METRIC_ORDER.map((metricKey) => (
            <MetricCard
              key={metricKey}
              metricKey={metricKey}
              values={grouped.get(metricKey) ?? []}
            />
          ))}
        </div>
      ) : (
        <div className="weather-alerts__record-surface mt-4 flex min-h-[132px] flex-col items-center justify-center rounded-[22px] border px-5 py-4 text-center sm:min-h-[150px]">
          <Gauge aria-hidden size={23} className="text-[var(--text-tertiary)]" />
          <strong className="mt-2 text-sm text-[var(--text-primary)]">
            Naměřené extrémy zatím nejsou načtené.
          </strong>
          <span className="mt-1 max-w-md text-xs leading-5 text-[var(--text-secondary)]">
            Panel se doplní po prvním automatickém načtení měření ČHMÚ.
          </span>
        </div>
      )}
    </section>
  )
}
