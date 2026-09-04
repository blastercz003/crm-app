'use client'

import {
  ArrowLeft,
  ArrowRight,
  CalendarClock,
  ChevronRight,
  Clock3,
  CloudLightning,
  CloudRainWind,
  ExternalLink,
  IceCreamBowl,
  MapPin,
  Snowflake,
  Waves,
  Wind,
  X,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useModalMotionClose } from '@/components/ui/modal-motion'
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

function periodIssuedAt(period: ForecastPeriod) {
  return period.outlooks
    .map((outlook) => outlook.issuedAt)
    .sort()
    .at(-1) ?? null
}

function ForecastPeriodCard({
  period,
  onOpen,
}: {
  period: ForecastPeriod
  onOpen: (trigger: HTMLButtonElement) => void
}) {
  const phenomena = periodPhenomena(period)
  const national = period.outlooks.some((outlook) => outlook.scopeType === 'national')
  return (
    <button
      type="button"
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={`Otevřít detail výhledu pro období ${formatValidity(period.validFrom, period.validTo)}`}
      className="weather-alerts__forecast-card weather-alerts__record-surface block w-full min-w-0 rounded-[20px] border p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
    >
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
        <strong className="min-w-0 truncate whitespace-nowrap text-[11px] font-semibold text-[var(--text-primary)] sm:text-xs">
          {formatValidity(period.validFrom, period.validTo)}
        </strong>
        <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
          <span className="inline-flex h-6 shrink-0 items-center whitespace-nowrap rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] px-2 text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]">
            {national ? 'Celostátní' : 'Regionální'}
          </span>
          <ChevronRight aria-hidden size={14} className="text-[var(--text-tertiary)]" />
        </span>
      </div>

      <div className="mt-2 flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-1.5">
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
        <span className="shrink-0 whitespace-nowrap text-[8px] font-semibold text-[var(--text-tertiary)]">
          {formatIssuedAt(periodIssuedAt(period))}
        </span>
      </div>

      {!national ? (
        <div className="mt-2 truncate border-t border-[var(--surface-border)] pt-2 text-[9px] font-semibold leading-4 text-[var(--text-secondary)]">
          {periodAreas(period)}
        </div>
      ) : null}
    </button>
  )
}

function periodAreaNames(period: ForecastPeriod) {
  if (period.outlooks.some((outlook) => outlook.scopeType === 'national')) {
    return ['Celá Česká republika']
  }
  return [...new Set(period.outlooks.map((outlook) => outlook.regionName))]
    .sort((left, right) => left.localeCompare(right, 'cs'))
}

function forecastTextEntries(
  period: ForecastPeriod,
  field: 'headline' | 'textWeather' | 'textWind',
) {
  const entries = new Map<string, Set<string>>()
  for (const outlook of period.outlooks) {
    const text = outlook[field]?.trim()
    if (!text) continue
    const areas = entries.get(text) ?? new Set<string>()
    areas.add(outlook.scopeType === 'national' ? 'Celá Česká republika' : outlook.regionName)
    entries.set(text, areas)
  }
  return [...entries].map(([text, areas]) => ({
    text,
    areas: [...areas].sort((left, right) => left.localeCompare(right, 'cs')),
  }))
}

function detailedPhenomena(period: ForecastPeriod) {
  const entries = new Map<string, { name: string; textComment: string }>()
  for (const outlook of period.outlooks) {
    for (const phenomenon of outlook.dangerousPhenomena) {
      const key = `${phenomenon.name}:${phenomenon.textComment}`
      if (!entries.has(key)) entries.set(key, phenomenon)
    }
  }
  return [...entries.values()]
}

function DetailValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3">
      <span className="block text-[9px] font-bold uppercase tracking-[0.11em] text-[var(--text-tertiary)]">
        {label}
      </span>
      <strong className="mt-1 block text-xs leading-5 text-[var(--text-primary)]">
        {value}
      </strong>
    </div>
  )
}

function ForecastTextSection({
  title,
  entries,
}: {
  title: string
  entries: ReturnType<typeof forecastTextEntries>
}) {
  if (entries.length === 0) return null
  return (
    <div className="mt-5">
      <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
        {title}
      </h3>
      <div className="mt-2 space-y-2">
        {entries.map((entry) => (
          <div key={`${title}:${entry.text}`} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3">
            {entries.length > 1 ? (
              <span className="mb-1.5 block text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--accent)]">
                {entry.areas.join(', ')}
              </span>
            ) : null}
            <p className="whitespace-pre-line text-sm leading-6 text-[var(--text-primary)]">
              {entry.text}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ForecastPeriodPopup({
  period,
  trigger,
  previousPeriod,
  nextPeriod,
  positionLabel,
  onNavigate,
  onClose,
}: {
  period: ForecastPeriod
  trigger: HTMLElement | null
  previousPeriod: ForecastPeriod | null
  nextPeriod: ForecastPeriod | null
  positionLabel: string
  onNavigate: (period: ForecastPeriod) => void
  onClose: () => void
}) {
  const shellRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const requestClose = useModalMotionClose(onClose)
  const phenomena = periodPhenomena(period)
  const areas = periodAreaNames(period)
  const headlines = forecastTextEntries(period, 'headline')
  const weatherTexts = forecastTextEntries(period, 'textWeather')
  const windTexts = forecastTextEntries(period, 'textWind')
  const detailed = detailedPhenomena(period)
  const issuedAt = period.outlooks
    .map((outlook) => outlook.issuedAt)
    .sort()
    .at(-1) ?? null
  const source = period.outlooks.find((outlook) => outlook.sourceUrl)
  const senderName = period.outlooks.find((outlook) => outlook.senderName)?.senderName
    ?? 'Český hydrometeorologický ústav'
  const national = areas.includes('Celá Česká republika')

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    closeRef.current?.focus({ preventScroll: true })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        requestClose()
        return
      }
      if (event.key !== 'Tab' || !shellRef.current) return
      const focusable = [...shellRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      )]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      document.body.style.overscrollBehavior = previousOverscroll
      trigger?.focus({ preventScroll: true })
    }
  }, [requestClose, trigger])

  return (
    <div
      data-modal-motion-root
      className="fixed inset-0 z-[145] flex items-center justify-center bg-slate-950/25 p-2.5 backdrop-blur-[3px] sm:p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) requestClose()
      }}
    >
      <section
        ref={shellRef}
        data-modal-motion-surface
        role="dialog"
        aria-modal="true"
        aria-labelledby="weather-forecast-period-title"
        aria-describedby="weather-forecast-period-description"
        className="weather-alerts-popup weather-alerts__surface activities-manual-preview activities-manual-preview--mobile flex max-h-[calc(100dvh-20px)] min-h-0 w-full max-w-[680px] flex-col overflow-hidden rounded-[26px] border border-[var(--surface-border)] bg-[var(--surface-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.68),0_28px_70px_rgba(15,23,42,0.3)] sm:max-h-[calc(100dvh-48px)]"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-[var(--surface-border)] p-4 sm:p-5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-sky-500/30 bg-sky-500/10 text-sky-700 [html[data-theme=dark]_&]:text-sky-300">
            <CalendarClock aria-hidden size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex h-6 items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-2 text-[8px] font-bold uppercase tracking-[0.07em] text-sky-700 [html[data-theme=dark]_&]:text-sky-300">
                Předběžný výhled ČHMÚ
              </span>
              {phenomena.map((phenomenon) => {
                const presentation = PHENOMENON_PRESENTATION[phenomenon.key]
                const Icon = presentation.icon
                return (
                  <span key={phenomenon.key} className="inline-flex h-6 items-center gap-1.5 rounded-full border border-[var(--surface-border)] bg-[var(--surface-muted)] px-2 text-[8px] font-bold uppercase tracking-[0.06em] text-[var(--text-secondary)]">
                    <Icon aria-hidden size={10} />
                    {phenomenon.name}
                  </span>
                )
              })}
            </div>
            <h2 id="weather-forecast-period-title" className="mt-2 text-lg font-semibold leading-6 text-[var(--text-primary)] sm:text-xl">
              Výhled nebezpečných jevů
            </h2>
          </div>
          <button ref={closeRef} type="button" onClick={requestClose} aria-label="Zavřít detail výhledu" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] shadow-sm transition hover:-translate-y-px hover:text-[var(--text-primary)]">
            <X aria-hidden size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <DetailValue label="Platnost" value={formatValidity(period.validFrom, period.validTo)} />
            <DetailValue label="Vydáno ČHMÚ" value={formatIssuedAt(issuedAt).replace(/^Vydáno\s+/, '')} />
            <DetailValue label="Rozsah" value={national ? 'Celá Česká republika' : `${areas.length} krajů`} />
          </div>

          <div id="weather-forecast-period-description">
            <ForecastTextSection title="Hlavní informace ČHMÚ" entries={headlines} />
            <ForecastTextSection title="Předpověď počasí" entries={weatherTexts} />
            <ForecastTextSection title="Vývoj větru" entries={windTexts} />
          </div>

          {detailed.length > 0 ? (
            <div className="mt-5">
              <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                <Clock3 aria-hidden size={14} /> Nebezpečné jevy v datech ČHMÚ
              </h3>
              <div className="mt-2 space-y-2">
                {detailed.map((phenomenon) => (
                  <div key={`${phenomenon.name}:${phenomenon.textComment}`} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--accent-soft)]/40 px-3.5 py-3">
                    <strong className="text-xs text-[var(--text-primary)]">{phenomenon.name}</strong>
                    {phenomenon.textComment ? (
                      <p className="mt-1.5 text-sm leading-6 text-[var(--text-primary)]">{phenomenon.textComment}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-5">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
              <MapPin aria-hidden size={15} /> Územní rozsah
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {areas.map((area) => (
                <span key={area} className="rounded-full border border-[var(--surface-border)] bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] font-medium leading-4 text-[var(--text-secondary)]">
                  {area}
                </span>
              ))}
            </div>
          </div>

          <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--surface-border)] pt-4">
            <span className="text-[10px] text-[var(--text-tertiary)]">
              Zdroj: {senderName}{source?.sourceFileName ? ` · ${source.sourceFileName}` : ''}
            </span>
            {source?.sourceUrl ? (
              <a href={source.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase text-[var(--accent)] hover:underline">
                Otevřít zdroj ČHMÚ <ExternalLink aria-hidden size={12} />
              </a>
            ) : null}
          </footer>
        </div>

        <nav aria-label="Přechod mezi obdobími výhledu" className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--surface-border)] bg-[var(--surface)] px-4 py-3 sm:px-5">
          <button type="button" disabled={!previousPeriod} onClick={() => previousPeriod && onNavigate(previousPeriod)} className="inline-flex h-10 min-w-0 items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35">
            <ArrowLeft aria-hidden size={14} /><span className="hidden xs:inline">Předchozí</span>
          </button>
          <span className="min-w-0 truncate px-2 text-center text-[10px] font-semibold text-[var(--text-tertiary)]">{positionLabel}</span>
          <button type="button" disabled={!nextPeriod} onClick={() => nextPeriod && onNavigate(nextPeriod)} className="inline-flex h-10 min-w-0 items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35">
            <span className="hidden xs:inline">Další</span><ArrowRight aria-hidden size={14} />
          </button>
        </nav>
      </section>
    </div>
  )
}

export function WeatherForecastOutlookPanel({
  forecast,
  compact = false,
}: {
  forecast: ForecastWorkspace
  compact?: boolean
}) {
  const periods = periodGroups(forecast.outlooks)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [trigger, setTrigger] = useState<HTMLElement | null>(null)
  const selectedIndex = periods.findIndex((period) => period.key === selectedKey)
  const selectedPeriod = selectedIndex >= 0 ? periods[selectedIndex] : null
  const previousPeriod = selectedIndex > 0 ? periods[selectedIndex - 1] : null
  const nextPeriod = selectedIndex >= 0 && selectedIndex < periods.length - 1
    ? periods[selectedIndex + 1]
    : null

  return (
    <section id="weather-outlook" className={`activities-page__panel min-w-0 scroll-mt-6 overflow-hidden rounded-[28px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5 ${compact ? 'weather-alerts__fixed-map-panel xl:flex xl:min-h-0 xl:flex-col' : ''}`}>
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
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
      </div>

      {periods.length > 0 ? (
        <div className={`mt-4 overflow-y-auto overscroll-contain pb-1 pr-1 pt-1 [scrollbar-gutter:stable] xl:p-1.5 ${compact ? 'max-h-[520px] xl:min-h-0 xl:max-h-none xl:flex-1' : 'max-h-[520px]'}`}>
          <div className={`grid min-w-0 gap-2.5 ${compact ? '' : 'md:grid-cols-2 xl:grid-cols-3'}`}>
            {periods.map((period) => (
              <ForecastPeriodCard
                key={period.key}
                period={period}
                onOpen={(button) => {
                  setTrigger(button)
                  setSelectedKey(period.key)
                }}
              />
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

      {selectedPeriod ? createPortal(
        <ForecastPeriodPopup
          period={selectedPeriod}
          trigger={trigger}
          previousPeriod={previousPeriod}
          nextPeriod={nextPeriod}
          positionLabel={`${selectedIndex + 1} / ${periods.length}`}
          onNavigate={(period) => setSelectedKey(period.key)}
          onClose={() => setSelectedKey(null)}
        />,
        document.body,
      ) : null}
    </section>
  )
}
