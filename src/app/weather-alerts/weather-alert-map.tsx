'use client'

import { useMemo, useState } from 'react'
import orpMap from '@/lib/weather-alerts/orp-map.json'
import type { WeatherEventListItem } from '@/lib/weather-alerts/types'

type MapTrigger = HTMLElement | SVGElement

type WeatherAlertMapProps = {
  events: WeatherEventListItem[]
  compact?: boolean
  onEventOpen?: (event: WeatherEventListItem, trigger: MapTrigger) => void
}

const SEVERITY_RANK = { yellow: 1, orange: 2, red: 3 } as const

const SEVERITY_STYLE = {
  yellow: 'fill-yellow-300 stroke-yellow-500 [html[data-theme=dark]_&]:fill-yellow-400/75 [html[data-theme=dark]_&]:stroke-yellow-200',
  orange: 'fill-orange-400 stroke-orange-600 [html[data-theme=dark]_&]:fill-orange-500/80 [html[data-theme=dark]_&]:stroke-orange-200',
  red: 'fill-red-500 stroke-red-700 [html[data-theme=dark]_&]:fill-red-500/85 [html[data-theme=dark]_&]:stroke-red-200',
} as const

const ORP_CODES = new Set(orpMap.areas.map((area) => area.code))

function eventAreaCodes(event: WeatherEventListItem) {
  return event.areas
    .filter((area) => area.codeType.toUpperCase() === 'CISORP')
    .map((area) => area.codeValue)
}

function compareEvents(left: WeatherEventListItem, right: WeatherEventListItem) {
  const severityDifference = SEVERITY_RANK[right.severityColor] - SEVERITY_RANK[left.severityColor]
  if (severityDifference !== 0) return severityDifference
  const leftEnd = left.validTo ? Date.parse(left.validTo) : Number.MAX_SAFE_INTEGER
  const rightEnd = right.validTo ? Date.parse(right.validTo) : Number.MAX_SAFE_INTEGER
  return leftEnd - rightEnd
}

export function WeatherAlertMap({ events, compact = false, onEventOpen }: WeatherAlertMapProps) {
  const [focusedCode, setFocusedCode] = useState<string | null>(null)
  const eventByArea = useMemo(() => {
    const result = new Map<string, WeatherEventListItem>()
    for (const event of [...events].sort(compareEvents)) {
      for (const code of eventAreaCodes(event)) {
        if (ORP_CODES.has(code) && !result.has(code)) result.set(code, event)
      }
    }
    return result
  }, [events])

  const focusedArea = focusedCode ? orpMap.areas.find((area) => area.code === focusedCode) : null
  const focusedEvent = focusedCode ? eventByArea.get(focusedCode) : null
  const affectedAreaCount = eventByArea.size

  return (
    <div className={`overflow-hidden rounded-[22px] border border-[var(--surface-border)] bg-[var(--surface-muted)] ${compact ? 'p-3' : 'p-3.5 sm:p-4'}`}>
      {!compact ? (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Mapa zasažených oblastí</h3>
            <p className="mt-0.5 text-[10px] text-[var(--text-secondary)]">
              {affectedAreaCount > 0 ? `${affectedAreaCount} zasažených správních obvodů ORP` : 'Aktuálně bez zasaženého území'}
            </p>
          </div>
          <div className="flex items-center gap-2.5 text-[9px] font-semibold uppercase tracking-[0.07em] text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-yellow-300 ring-1 ring-yellow-500" /> Nízké</span>
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-orange-400 ring-1 ring-orange-600" /> Vysoké</span>
            <span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-full bg-red-500 ring-1 ring-red-700" /> Extrémní</span>
          </div>
        </div>
      ) : null}

      <div className="relative mx-auto w-full max-w-[900px]">
        <svg
          viewBox={orpMap.viewBox.join(' ')}
          role={compact ? undefined : 'img'}
          aria-hidden={compact || undefined}
          aria-label={compact ? undefined : 'Mapa České republiky s územím zasaženým výstrahami ČHMÚ'}
          className={`block h-auto w-full overflow-visible ${compact ? 'max-h-[220px]' : 'max-h-[390px]'}`}
        >
          {orpMap.areas.map((area) => {
            const event = eventByArea.get(area.code)
            const interactive = Boolean(event && onEventOpen)
            const areaLabel = event ? `${area.name}: ${event.headline || event.eventName}` : undefined
            return (
              <path
                key={area.code}
                d={area.path}
                role={interactive ? 'button' : undefined}
                tabIndex={interactive ? 0 : undefined}
                aria-hidden={!interactive || undefined}
                aria-label={interactive ? areaLabel : undefined}
                onPointerEnter={() => event && setFocusedCode(area.code)}
                onPointerLeave={() => setFocusedCode((current) => current === area.code ? null : current)}
                onFocus={() => event && setFocusedCode(area.code)}
                onBlur={() => setFocusedCode((current) => current === area.code ? null : current)}
                onClick={(clickEvent) => event && onEventOpen?.(event, clickEvent.currentTarget)}
                onKeyDown={(keyEvent) => {
                  if (event && onEventOpen && (keyEvent.key === 'Enter' || keyEvent.key === ' ')) {
                    keyEvent.preventDefault()
                    onEventOpen(event, keyEvent.currentTarget)
                  }
                }}
                className={`stroke-[0.65] transition-[fill,stroke,opacity] duration-150 focus:outline-none ${event ? `${SEVERITY_STYLE[event.severityColor]} cursor-pointer hover:brightness-95 focus:stroke-[var(--accent)] focus:stroke-[2.5]` : 'fill-[var(--surface-strong)] stroke-[var(--surface-border)] opacity-80'}`}
                style={{ vectorEffect: 'non-scaling-stroke' }}
              />
            )
          })}
        </svg>

        {focusedArea && focusedEvent && !compact ? (
          <div className="pointer-events-none absolute left-2 top-2 max-w-[min(260px,75%)] rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)]/95 px-3 py-2 shadow-lg backdrop-blur-sm">
            <strong className="block truncate text-[11px] text-[var(--text-primary)]">{focusedArea.name}</strong>
            <span className="mt-0.5 block line-clamp-2 text-[10px] leading-4 text-[var(--text-secondary)]">{focusedEvent.headline || focusedEvent.eventName}</span>
          </div>
        ) : null}
      </div>

      {!compact && affectedAreaCount > 0 ? (
        <p className="mt-1 text-center text-[9px] text-[var(--text-tertiary)]">Kliknutím na zvýrazněnou oblast otevřete detail nejsilnější výstrahy.</p>
      ) : null}
    </div>
  )
}
