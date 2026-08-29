'use client'

import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BellOff,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  CloudLightning,
  CloudRainWind,
  Filter,
  History,
  IceCreamBowl,
  MapPin,
  Radio,
  RefreshCw,
  Snowflake,
  Smartphone,
  Waves,
  Wind,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from 'react'
import { createPortal } from 'react-dom'
import { useModalMotionClose } from '@/components/ui/modal-motion'
import { getCurrentPushSubscription, supportsPushNotifications } from '@/app/settings/password/push-subscription-client'
import { getWeatherEventDetailAction, getWeatherSourceStatusAction, updateWeatherNotificationPreferencesAction } from './actions'
import { WeatherAlertMap } from './weather-alert-map'
import { WeatherSummaryStats, type WeatherSummaryCard } from './weather-summary-stats'
import type {
  WeatherAlertsWorkspace,
  WeatherEventDetail,
  WeatherEventListItem,
  WeatherHazardType,
  WeatherNotificationPreferences,
  WeatherSourceStatus,
} from '@/lib/weather-alerts/types'

const HAZARD_PRESENTATION: Record<
  WeatherHazardType,
  { label: string; icon: typeof Wind }
> = {
  wind: { label: 'Silný vítr', icon: Wind },
  snow: { label: 'Sníh', icon: Snowflake },
  ice_load: { label: 'Námraza', icon: IceCreamBowl },
  thunderstorm: { label: 'Bouřky', icon: CloudLightning },
  rain: { label: 'Silné srážky', icon: CloudRainWind },
  flood: { label: 'Povodňové jevy', icon: Waves },
}

const SEVERITY_PRESENTATION = {
  yellow: {
    label: 'Nízký stupeň nebezpečí',
    short: 'ŽLUTÁ',
    dot: 'bg-yellow-400',
    border: 'border-yellow-400/45',
    surface: 'bg-yellow-400/10',
    text: 'text-yellow-700 [html[data-theme=dark]_&]:text-yellow-300',
  },
  orange: {
    label: 'Vysoký stupeň nebezpečí',
    short: 'ORANŽOVÁ',
    dot: 'bg-orange-500',
    border: 'border-orange-500/50',
    surface: 'bg-orange-500/10',
    text: 'text-orange-700 [html[data-theme=dark]_&]:text-orange-300',
  },
  red: {
    label: 'Extrémní stupeň nebezpečí',
    short: 'ČERVENÁ',
    dot: 'bg-red-600',
    border: 'border-red-500/55',
    surface: 'bg-red-500/10',
    text: 'text-red-700 [html[data-theme=dark]_&]:text-red-300',
  },
} as const

type HazardFilter = 'all' | WeatherHazardType
type SeverityFilter = 'all' | WeatherEventListItem['severityColor']

const HAZARD_FILTER_OPTIONS: Array<{ value: HazardFilter; label: string }> = [
  { value: 'all', label: 'Všechny jevy' },
  ...Object.entries(HAZARD_PRESENTATION).map(([value, presentation]) => ({
    value: value as WeatherHazardType,
    label: presentation.label,
  })),
]

const SEVERITY_FILTER_OPTIONS: Array<{ value: SeverityFilter; label: string }> = [
  { value: 'all', label: 'Všechny stupně' },
  { value: 'yellow', label: 'Žlutá' },
  { value: 'orange', label: 'Oranžová' },
  { value: 'red', label: 'Červená' },
]

function formatDateTime(value: string | null, fallback = 'Neuvedeno') {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    weekday: 'short',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatShortDateTime(value: string | null) {
  if (!value) return 'Neuvedeno'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Neuvedeno'
  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function uniqueAreaNames(event: WeatherEventListItem) {
  return [...new Set(event.areas.map((area) => area.name).filter(Boolean))]
}

function readableBodyText(value: string) {
  return value.replace(
    /([.!?])(?=[A-ZÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ])/g,
    '$1 ',
  )
}

function StatusBadge({ event }: { event: WeatherEventListItem }) {
  const status = event.status === 'cancelled'
    ? { label: 'ZRUŠENÁ', className: 'border-red-500/35 bg-red-500/10 text-red-700 [html[data-theme=dark]_&]:text-red-300' }
    : event.status === 'ended'
      ? { label: 'UKONČENÁ', className: 'border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)]' }
      : event.currentVersionNumber > 1
        ? { label: 'AKTUALIZOVANÁ', className: 'border-violet-500/35 bg-violet-500/10 text-violet-700 [html[data-theme=dark]_&]:text-violet-300' }
        : { label: 'NOVÁ', className: 'border-sky-500/35 bg-sky-500/10 text-sky-700 [html[data-theme=dark]_&]:text-sky-300' }
  return (
    <span className={`inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-full border px-1.5 text-[7px] font-bold tracking-[0.05em] sm:h-6 sm:px-2.5 sm:text-[9px] sm:tracking-[0.09em] ${status.className}`}>
      {status.label}
    </span>
  )
}

function SeverityBadge({ event }: { event: WeatherEventListItem }) {
  const severity = SEVERITY_PRESENTATION[event.severityColor]
  return (
    <span className={`inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-1.5 text-[7px] font-bold tracking-[0.05em] sm:h-6 sm:gap-1.5 sm:px-2.5 sm:text-[9px] sm:tracking-[0.09em] ${severity.border} ${severity.surface} ${severity.text}`}>
      <span className={`h-1 w-1 rounded-full sm:h-1.5 sm:w-1.5 ${severity.dot}`} />
      {severity.short}
    </span>
  )
}

function HazardBadge({ event }: { event: WeatherEventListItem }) {
  const hazard = HAZARD_PRESENTATION[event.hazardType]
  const Icon = hazard.icon
  return (
    <span className="inline-flex h-5 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-[var(--surface-border)] bg-[var(--surface-muted)] px-1.5 text-[7px] font-bold uppercase tracking-[0.05em] text-[var(--text-secondary)] sm:h-6 sm:gap-1.5 sm:px-2.5 sm:text-[9px] sm:tracking-[0.09em]">
      <Icon aria-hidden size={12} className="h-2.5 w-2.5 shrink-0 text-[var(--accent)] sm:h-3 sm:w-3" />
      {hazard.label}
    </span>
  )
}

function EventCard({
  event,
  onOpen,
  onPreview,
  onPreviewEnd,
}: {
  event: WeatherEventListItem
  onOpen: (event: WeatherEventListItem, trigger: HTMLButtonElement) => void
  onPreview: (event: WeatherEventListItem) => void
  onPreviewEnd: (event: WeatherEventListItem) => void
}) {
  const hazard = HAZARD_PRESENTATION[event.hazardType]
  const Icon = hazard.icon
  const desktopPreviewAvailable = () => window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)').matches
  return (
    <button
      type="button"
      onClick={(clickEvent) => onOpen(event, clickEvent.currentTarget)}
      onPointerEnter={(pointerEvent) => {
        if (pointerEvent.pointerType === 'mouse' && desktopPreviewAvailable()) onPreview(event)
      }}
      onPointerLeave={(pointerEvent) => {
        if (pointerEvent.pointerType === 'mouse') onPreviewEnd(event)
      }}
      onFocus={() => {
        if (desktopPreviewAvailable()) onPreview(event)
      }}
      onBlur={() => onPreviewEnd(event)}
      className="activities-workspace__row weather-alerts__event-card weather-alerts__record-surface group flex min-h-[68px] min-w-0 max-w-full flex-col overflow-hidden rounded-[18px] border p-2.5 text-left sm:min-h-[82px] sm:rounded-[22px] sm:p-3.5"
    >
      <div className="flex min-w-0 items-start gap-2.5 sm:gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--accent)] sm:h-9 sm:w-9 sm:rounded-xl">
          <Icon aria-hidden size={18} className="h-[15px] w-[15px] sm:h-[18px] sm:w-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-nowrap items-center gap-1 sm:flex-wrap sm:gap-2">
            <StatusBadge event={event} />
            <SeverityBadge event={event} />
            <HazardBadge event={event} />
          </span>
          <strong className="mt-1 block line-clamp-2 text-[12px] font-semibold leading-4 text-[var(--text-primary)] sm:mt-1.5 sm:text-[14px] sm:leading-[18px]">
            {event.headline || event.eventName}{' '}
            <span className="whitespace-nowrap font-medium text-[var(--text-secondary)]">(do {formatShortDateTime(event.validTo)})</span>
          </strong>
        </span>
        <ChevronRight aria-hidden size={18} className="h-4 w-4 shrink-0 self-center text-[var(--text-tertiary)] transition group-hover:translate-x-0.5 group-hover:text-[var(--accent)] sm:mt-3 sm:h-[18px] sm:w-[18px] sm:self-auto" />
      </div>
    </button>
  )
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3">
      <div className="text-[9px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]">{label}</div>
      <div className="mt-1 text-sm font-medium leading-5 text-[var(--text-primary)]">{value}</div>
    </div>
  )
}

const CHANGE_REASON_LABELS: Record<string, string> = {
  new_event: 'Nová výstraha',
  severity_increased: 'Zvýšení stupně',
  severity_decreased: 'Snížení stupně',
  area_expanded: 'Rozšíření území',
  area_changed: 'Změna území',
  onset_advanced: 'Dřívější začátek',
  onset_changed: 'Změna začátku',
  validity_changed: 'Změna platnosti',
  content_changed: 'Aktualizace obsahu',
  status_changed: 'Změna stavu',
}

const PARAMETER_LABELS: Record<string, string> = {
  awareness_level: 'Úroveň výstrahy',
  awareness_type: 'Typ nebezpečí',
  eventendingtime: 'Předpokládaný konec',
  event_ending_time: 'Předpokládaný konec',
  situation: 'Meteorologická situace',
}

function readableParameterLabel(key: string) {
  return PARAMETER_LABELS[key.toLowerCase()] ?? key.replaceAll('_', ' ')
}

function EventPopup({
  event,
  detail,
  detailLoading,
  detailError,
  trigger,
  previousEvent,
  nextEvent,
  positionLabel,
  onNavigate,
  onClose,
}: {
  event: WeatherEventListItem
  detail: WeatherEventDetail | null
  detailLoading: boolean
  detailError: string | null
  trigger: HTMLElement | SVGElement | null
  previousEvent: WeatherEventListItem | null
  nextEvent: WeatherEventListItem | null
  positionLabel: string
  onNavigate: (event: WeatherEventListItem) => void
  onClose: () => void
}) {
  const shellRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const requestClose = useModalMotionClose(onClose)
  const hazard = HAZARD_PRESENTATION[event.hazardType]
  const Icon = hazard.icon
  const severity = SEVERITY_PRESENTATION[event.severityColor]
  const areas = uniqueAreaNames(event)
  const affectedOrpCount = new Set(event.areas.filter((area) => area.codeType.toUpperCase() === 'CISORP').map((area) => area.codeValue)).size
  const parameterEntries = Object.entries(detail?.parameters ?? {})
    .filter(([key, value]) => !/(^|_)(id|sha|code|language)($|_)/i.test(key) && (Array.isArray(value) ? value.length > 0 : Boolean(value)))
    .slice(0, 8)

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const previousOverscroll = document.body.style.overscrollBehavior
    document.body.style.overflow = 'hidden'
    document.body.style.overscrollBehavior = 'none'
    closeRef.current?.focus({ preventScroll: true })

    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') {
        keyEvent.preventDefault()
        requestClose()
        return
      }
      if (keyEvent.key !== 'Tab' || !shellRef.current) return
      const focusable = [...shellRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (keyEvent.shiftKey && document.activeElement === first) {
        keyEvent.preventDefault()
        last.focus()
      } else if (!keyEvent.shiftKey && document.activeElement === last) {
        keyEvent.preventDefault()
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
      onPointerDown={(pointerEvent) => {
        if (pointerEvent.target === pointerEvent.currentTarget) requestClose()
      }}
    >
      <section
        ref={shellRef}
        data-modal-motion-surface
        role="dialog"
        aria-modal="true"
        aria-labelledby={`weather-event-${event.id}`}
        aria-describedby={`weather-event-description-${event.id}`}
        className="weather-alerts-popup weather-alerts__surface activities-manual-preview activities-manual-preview--mobile flex max-h-[calc(100dvh-20px)] min-h-0 w-full max-w-[680px] flex-col overflow-hidden rounded-[26px] border border-[var(--surface-border)] bg-[var(--surface-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.68),0_28px_70px_rgba(15,23,42,0.3)] sm:max-h-[calc(100dvh-48px)]"
      >
        <header className="flex shrink-0 items-start gap-3 border-b border-[var(--surface-border)] p-4 sm:p-5">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${severity.border} ${severity.surface} ${severity.text}`}>
            <Icon aria-hidden size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge event={event} />
              <SeverityBadge event={event} />
              <HazardBadge event={event} />
            </div>
            <h2 id={`weather-event-${event.id}`} className="mt-2 text-lg font-semibold leading-6 text-[var(--text-primary)] sm:text-xl">
              {event.headline || event.eventName}
            </h2>
          </div>
          <button ref={closeRef} type="button" onClick={requestClose} aria-label="Zavřít detail výstrahy" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] shadow-sm transition hover:-translate-y-px hover:text-[var(--text-primary)]">
            <X aria-hidden size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
          <WeatherAlertMap events={[event]} compact />

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <DetailRow label="Začátek" value={formatDateTime(event.onsetAt)} />
            <DetailRow label="Platnost do" value={formatDateTime(event.validTo)} />
            <DetailRow label="Vydáno ČHMÚ" value={detailLoading ? 'Načítám…' : formatDateTime(detail?.issuedAt ?? null)} />
            <DetailRow label="Účinnost od" value={detailLoading ? 'Načítám…' : formatDateTime(detail?.effectiveAt ?? null)} />
            <DetailRow label="Druh jevu" value={hazard.label} />
            <DetailRow label="Stupeň" value={severity.label} />
          </div>

          <div id={`weather-event-description-${event.id}`} className="mt-5">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Oficiální popis</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[var(--text-primary)]">{event.description ? readableBodyText(event.description) : 'ČHMÚ podrobný popis neuvedl.'}</p>
          </div>

          <div className="mt-5 rounded-2xl border border-[var(--surface-border)] bg-[var(--accent-soft)]/45 p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Doporučení ČHMÚ</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[var(--text-primary)]">{event.instruction ? readableBodyText(event.instruction) : 'Pro tuto výstrahu nebylo zveřejněno samostatné doporučení.'}</p>
          </div>

          {event.criterion || parameterEntries.length > 0 ? (
            <div className="mt-5">
              <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]"><Radio aria-hidden size={14} /> Intenzita a dostupné parametry</h3>
              {event.criterion ? <p className="mt-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3 text-sm leading-6 text-[var(--text-primary)]">{event.criterion}</p> : null}
              {parameterEntries.length > 0 ? <div className="mt-2 grid gap-2 sm:grid-cols-2">{parameterEntries.map(([key, value]) => <DetailRow key={key} label={readableParameterLabel(key)} value={Array.isArray(value) ? value.join(', ') : value} />)}</div> : null}
            </div>
          ) : null}

          <div className="mt-5">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
              <MapPin aria-hidden size={15} /> Zasažené kraje a ORP
            </h3>
            <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{affectedOrpCount} zasažených správních obvodů ORP</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {areas.length > 0 ? areas.map((area) => (
                <span key={area} className="rounded-full border border-[var(--surface-border)] bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] font-medium leading-4 text-[var(--text-secondary)]">{area}</span>
              )) : <span className="text-sm text-[var(--text-secondary)]">ČHMÚ území blíže neurčil.</span>}
            </div>
          </div>

          <div className="mt-5">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]"><History aria-hidden size={14} /> Historie aktualizací</h3>
            {detailLoading ? (
              <div className="mt-2 space-y-2" aria-label="Načítám historii aktualizací">{[0, 1].map((item) => <div key={item} className="h-[72px] animate-pulse rounded-2xl bg-[var(--surface-muted)]" />)}</div>
            ) : detailError ? (
              <div className="mt-2 rounded-2xl border border-red-500/25 bg-red-500/10 px-3.5 py-3 text-xs text-red-700 [html[data-theme=dark]_&]:text-red-300">{detailError}</div>
            ) : detail?.versions.length ? (
              <ol className="mt-2 space-y-2">{detail.versions.map((version) => {
                const versionSeverity = SEVERITY_PRESENTATION[version.severityColor]
                return <li key={version.id} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className="flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${versionSeverity.dot}`} /><strong className="text-xs text-[var(--text-primary)]">Verze {version.versionNumber}</strong>{version.versionNumber === detail.currentVersionNumber ? <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[8px] font-bold uppercase text-[var(--accent)]">Aktuální</span> : null}</span><span className="flex items-center gap-1 text-[10px] text-[var(--text-tertiary)]"><Clock3 aria-hidden size={12} /> {formatDateTime(version.issuedAt)}</span></div><div className="mt-2 flex flex-wrap gap-1.5">{(version.changeReasons.length > 0 ? version.changeReasons : ['content_changed']).map((reason) => <span key={reason} className="rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] px-2 py-0.5 text-[9px] text-[var(--text-secondary)]">{CHANGE_REASON_LABELS[reason] ?? reason}</span>)}<span className="rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] px-2 py-0.5 text-[9px] text-[var(--text-secondary)]">{version.affectedAreaCount} ORP</span></div></li>
              })}</ol>
            ) : <p className="mt-2 text-xs text-[var(--text-secondary)]">Historie aktualizací zatím není dostupná.</p>}
          </div>

          <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--surface-border)] pt-4">
            <span className="text-[10px] text-[var(--text-tertiary)]">Zdroj: Český hydrometeorologický ústav (ČHMÚ)</span>
            {event.sourceWebUrl ? <a href={event.sourceWebUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold uppercase text-[var(--accent)] hover:underline">Otevřít zdroj ČHMÚ</a> : null}
          </footer>
        </div>

        <nav aria-label="Přechod mezi výstrahami" className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--surface-border)] bg-[var(--surface)] px-4 py-3 sm:px-5">
          <button type="button" disabled={!previousEvent} onClick={() => previousEvent && onNavigate(previousEvent)} className="inline-flex h-10 min-w-0 items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"><ArrowLeft aria-hidden size={14} /><span className="hidden xs:inline">Předchozí</span></button>
          <span className="min-w-0 truncate px-2 text-center text-[10px] font-semibold text-[var(--text-tertiary)]">{positionLabel}</span>
          <button type="button" disabled={!nextEvent} onClick={() => nextEvent && onNavigate(nextEvent)} className="inline-flex h-10 min-w-0 items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"><span className="hidden xs:inline">Další</span><ArrowRight aria-hidden size={14} /></button>
        </nav>
      </section>
    </div>
  )
}

type PushDeviceState = 'checking' | 'enabled' | 'missing' | 'prompt' | 'blocked' | 'unsupported'

function PushPermissionStatus() {
  const [state, setState] = useState<PushDeviceState>('checking')

  useEffect(() => {
    let active = true
    const check = async () => {
      if (!supportsPushNotifications()) {
        if (active) setState('unsupported')
        return
      }
      if (Notification.permission === 'denied') {
        if (active) setState('blocked')
        return
      }
      if (Notification.permission !== 'granted') {
        if (active) setState('prompt')
        return
      }
      const subscription = await getCurrentPushSubscription()
      if (active) setState(subscription ? 'enabled' : 'missing')
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void check()
    }
    void check()
    window.addEventListener('focus', refreshWhenVisible)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      active = false
      window.removeEventListener('focus', refreshWhenVisible)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [])

  const presentation = {
    checking: { label: 'Zjišťuji stav', text: 'Kontroluji oprávnění tohoto zařízení.', tone: 'text-[var(--text-secondary)]', dot: 'bg-slate-400' },
    enabled: { label: 'Aktivní', text: 'PWA oznámení jsou na tomto zařízení zapnutá.', tone: 'text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300', dot: 'bg-emerald-500' },
    missing: { label: 'Vyžaduje zapnutí', text: 'Prohlížeč oznámení povoluje, zařízení ale není přihlášené k odběru.', tone: 'text-amber-700 [html[data-theme=dark]_&]:text-amber-300', dot: 'bg-amber-500' },
    prompt: { label: 'Nepovoleno', text: 'Oznámení zatím nebyla v tomto prohlížeči povolena.', tone: 'text-amber-700 [html[data-theme=dark]_&]:text-amber-300', dot: 'bg-amber-500' },
    blocked: { label: 'Blokováno', text: 'Oznámení jsou v nastavení prohlížeče nebo zařízení zablokovaná.', tone: 'text-red-700 [html[data-theme=dark]_&]:text-red-300', dot: 'bg-red-500' },
    unsupported: { label: 'Nedostupné', text: 'Tento prohlížeč nebo způsob otevření aplikace PWA oznámení nepodporuje.', tone: 'text-[var(--text-secondary)]', dot: 'bg-slate-400' },
  }[state]

  return (
    <div className="weather-alerts__record-surface mt-4 rounded-2xl border p-3.5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] text-[var(--accent)]"><Smartphone aria-hidden size={17} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-xs font-semibold text-[var(--text-primary)]">PWA oznámení na zařízení</strong>
            <span className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] px-2 py-1 text-[8px] font-bold uppercase tracking-[0.08em] ${presentation.tone}`}><i className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} />{presentation.label}</span>
          </div>
          <p className="mt-1.5 text-[11px] leading-4 text-[var(--text-secondary)]">{presentation.text}</p>
          {state !== 'checking' && state !== 'enabled' && state !== 'unsupported' ? <Link href="/settings/password" className="mt-2 inline-flex text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--accent)] hover:underline">Spravovat oznámení zařízení</Link> : null}
        </div>
      </div>
    </div>
  )
}

function NotificationSettings({ initialPreferences }: { initialPreferences: WeatherNotificationPreferences }) {
  const [preferences, setPreferences] = useState(initialPreferences)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const save = (next: WeatherNotificationPreferences) => {
    const previous = preferences
    setPreferences(next)
    setPending(true)
    setMessage(null)
    startTransition(async () => {
      const result = await updateWeatherNotificationPreferencesAction({
        notificationsEnabled: next.notificationsEnabled,
        includeYellowWarnings: next.includeYellowWarnings,
      })
      setPending(false)
      if (!result.success) {
        setPreferences(previous)
        setMessage(result.error)
        return
      }
      setPreferences(result.preferences)
      setMessage('Nastavení bylo uloženo.')
    })
  }

  return (
    <section className="activities-page__panel h-full rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--accent)]">
          {preferences.notificationsEnabled ? <Bell aria-hidden size={19} /> : <BellOff aria-hidden size={19} />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Upozornění na výstrahy</h2>
        </div>
        <button
          type="button"
          role="switch"
          aria-label="Zapnout upozornění na výstrahy počasí"
          aria-checked={preferences.notificationsEnabled}
          disabled={pending}
          onClick={() => save({ ...preferences, notificationsEnabled: !preferences.notificationsEnabled, includeYellowWarnings: preferences.notificationsEnabled ? false : preferences.includeYellowWarnings })}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition ${preferences.notificationsEnabled ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--surface-border)] bg-[var(--surface-muted)]'} disabled:opacity-60`}
        >
          <span className={`absolute top-1 h-[18px] w-[18px] rounded-full bg-white shadow transition ${preferences.notificationsEnabled ? 'left-[25px]' : 'left-1'}`} />
        </button>
      </div>

      <div className="weather-alerts__record-surface mt-4 overflow-hidden rounded-2xl border">
        <div className="flex items-start gap-2.5 px-3.5 py-3">
          <CheckCircle2 aria-hidden size={16} className="mt-0.5 shrink-0 text-orange-500" />
          <p className="text-[11px] leading-4 text-[var(--text-secondary)]">
            <strong className="text-[var(--text-primary)]">Oranžové a červené výstrahy</strong> jsou při zapnutých upozorněních zahrnuté automaticky.
          </p>
        </div>
        <button
          type="button"
          disabled={!preferences.notificationsEnabled || pending}
          onClick={() => save({ ...preferences, includeYellowWarnings: !preferences.includeYellowWarnings })}
          className="flex w-full items-center justify-between gap-3 border-t border-[var(--surface-border)] px-3.5 py-3 text-left transition hover:bg-yellow-400/[0.06] disabled:opacity-45"
        >
          <span className="flex min-w-0 items-start gap-2.5">
            <CheckCircle2 aria-hidden size={16} className="mt-0.5 shrink-0 text-yellow-500" />
            <span className="text-[11px] leading-4 text-[var(--text-secondary)]">
              <strong className="text-[var(--text-primary)]">Zahrnout také žluté výstrahy</strong> pro upozornění i na nižší stupeň nebezpečí.
            </span>
          </span>
          <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${preferences.includeYellowWarnings ? 'border-yellow-400 bg-yellow-400 text-slate-950' : 'border-[var(--text-tertiary)]'}`}>
            {preferences.includeYellowWarnings ? '✓' : ''}
          </span>
        </button>
      </div>

      <div className="mt-4 border-t border-[var(--surface-border)] pt-4">
        <h3 className="text-[9px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]">Sledované meteorologické jevy</h3>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {Object.entries(HAZARD_PRESENTATION).map(([key, item]) => {
            const HazardIcon = item.icon
            return <span key={key} className="flex min-w-0 items-center gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-2.5 py-2 text-[10px] font-medium text-[var(--text-secondary)]"><HazardIcon aria-hidden size={14} className="shrink-0 text-[var(--accent)]" /><span className="truncate">{item.label}</span></span>
          })}
        </div>
      </div>

      <PushPermissionStatus />
      {message ? <p aria-live="polite" className={`mt-2 text-[11px] ${message === 'Nastavení bylo uloženo.' ? 'text-emerald-600 [html[data-theme=dark]_&]:text-emerald-300' : 'text-red-600 [html[data-theme=dark]_&]:text-red-300'}`}>{message}</p> : null}
    </section>
  )
}

const SOURCE_LIVE_MAX_AGE = 20 * 60 * 1_000
const SOURCE_ERROR_MAX_AGE = 30 * 60 * 1_000

type SourceHealthPresentation = {
  label: 'ŽIVĚ' | 'ZPOŽDĚNÍ' | 'CHYBA'
  description: string
  badge: string
  dot: string
}

function sourceHealthPresentation(
  status: WeatherSourceStatus,
  now: number,
  statusReadFailures: number,
): SourceHealthPresentation {
  const lastSuccessTime = status.lastSuccessAt ? Date.parse(status.lastSuccessAt) : Number.NaN
  const lastSuccessAge = Number.isFinite(lastSuccessTime) ? Math.max(0, now - lastSuccessTime) : Number.POSITIVE_INFINITY

  if (
    statusReadFailures >= 3
    || status.consecutiveFailureCount >= 3
    || lastSuccessAge > SOURCE_ERROR_MAX_AGE
  ) {
    return {
      label: 'CHYBA',
      description: 'Automatické načítání dat momentálně nefunguje.',
      badge: 'border-red-200 bg-red-50 text-red-700 [html[data-theme=dark]_&]:border-red-400/25 [html[data-theme=dark]_&]:bg-red-400/10 [html[data-theme=dark]_&]:text-red-300',
      dot: 'bg-red-500 [html[data-theme=dark]_&]:bg-red-400',
    }
  }

  if (
    statusReadFailures > 0
    || status.consecutiveFailureCount > 0
    || lastSuccessAge > SOURCE_LIVE_MAX_AGE
  ) {
    return {
      label: 'ZPOŽDĚNÍ',
      description: 'Aktualizace dat má zpoždění, systém pokračuje v dalších pokusech.',
      badge: 'border-amber-200 bg-amber-50 text-amber-700 [html[data-theme=dark]_&]:border-amber-400/25 [html[data-theme=dark]_&]:bg-amber-400/10 [html[data-theme=dark]_&]:text-amber-300',
      dot: 'bg-amber-500 [html[data-theme=dark]_&]:bg-amber-400',
    }
  }

  return {
    label: 'ŽIVĚ',
      description: 'Aktualizace každých 5 minut.',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700 [html[data-theme=dark]_&]:border-emerald-400/25 [html[data-theme=dark]_&]:bg-emerald-400/10 [html[data-theme=dark]_&]:text-emerald-300',
    dot: 'bg-emerald-500 motion-safe:animate-pulse [html[data-theme=dark]_&]:bg-emerald-400',
  }
}

function WeatherSourceStatusCard({
  initialStatus,
  isRefreshing,
  onRefresh,
  onDataVersionChange,
}: {
  initialStatus: WeatherSourceStatus
  isRefreshing: boolean
  onRefresh: () => void
  onDataVersionChange: () => void
}) {
  const [status, setStatus] = useState(initialStatus)
  const [now, setNow] = useState(() => Date.now())
  const [statusReadFailures, setStatusReadFailures] = useState(0)
  const latestDataVersionRef = useRef(initialStatus.dataVersion)
  const presentation = sourceHealthPresentation(status, now, statusReadFailures)

  useEffect(() => {
    let disposed = false
    let requestPending = false

    const refreshStatus = async () => {
      if (requestPending || document.visibilityState !== 'visible') return
      requestPending = true
      const result = await getWeatherSourceStatusAction()
      requestPending = false
      if (disposed) return
      setNow(Date.now())
      if (!result.success) {
        setStatusReadFailures((current) => current + 1)
        return
      }
      setStatus(result.status)
      setStatusReadFailures(0)
      if (result.status.dataVersion !== latestDataVersionRef.current) {
        latestDataVersionRef.current = result.status.dataVersion
        onDataVersionChange()
      }
    }

    const interval = window.setInterval(() => { void refreshStatus() }, 60_000)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshStatus()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      disposed = true
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [onDataVersionChange])

  return (
    <section className="activities-page__panel flex h-full flex-col rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">Zdroj dat ČHMÚ</h2>
          <p className="mt-0.5 text-[11px] leading-4 text-[var(--text-secondary)]">{presentation.description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            disabled={isRefreshing}
            onClick={onRefresh}
            aria-label="Obnovit zobrazení"
            title="Obnovit zobrazení"
            className="inline-flex h-7 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:cursor-wait disabled:opacity-70"
          >
            <RefreshCw aria-hidden size={12} className={isRefreshing ? 'animate-spin' : ''} />
          </button>
          <span
            role="status"
            aria-label={`Stav načítání dat ČHMÚ: ${presentation.label}`}
            className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[9px] font-bold uppercase tracking-[0.1em] ${presentation.badge}`}
          >
            <i aria-hidden className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} />
            {presentation.label}
          </span>
        </div>
      </div>
      <div className="flex flex-1 items-center">
        <div className="weather-alerts__record-surface mt-4 w-full rounded-2xl border px-3 py-2.5">
          <span className="text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Poslední úspěšná aktualizace</span>
          <strong className="mt-0.5 block text-xs text-[var(--text-primary)]">{formatDateTime(status.lastSuccessAt, 'Zatím neproběhla')}</strong>
        </div>
      </div>
    </section>
  )
}

export function WeatherAlertsDashboard({
  workspace,
  initialEventId,
}: {
  workspace: WeatherAlertsWorkspace
  initialEventId?: string
}) {
  const router = useRouter()
  const initialEvent = [...workspace.activeEvents, ...workspace.historyEvents].find((event) => event.id === initialEventId) ?? null
  const [tab, setTab] = useState<'active' | 'history'>(() =>
    initialEvent?.status === 'ended' || initialEvent?.status === 'cancelled'
      ? 'history'
      : 'active',
  )
  const [selected, setSelected] = useState<WeatherEventListItem | null>(initialEvent)
  const [trigger, setTrigger] = useState<HTMLElement | SVGElement | null>(null)
  const [selectedDetail, setSelectedDetail] = useState<WeatherEventDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(Boolean(initialEvent))
  const [detailError, setDetailError] = useState<string | null>(null)
  const [hazardFilter, setHazardFilter] = useState<HazardFilter>('all')
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all')
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false)
  const [previewedEventId, setPreviewedEventId] = useState<string | null>(null)
  const [isRefreshing, startRefresh] = useTransition()
  const refreshWorkspace = useCallback(() => {
    startRefresh(() => router.refresh())
  }, [router, startRefresh])
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  )
  const events = tab === 'active' ? workspace.activeEvents : workspace.historyEvents
  const filteredEvents = useMemo(() => events.filter((event) => (
    (hazardFilter === 'all' || event.hazardType === hazardFilter)
    && (severityFilter === 'all' || event.severityColor === severityFilter)
  )).sort((left, right) => {
    const severityDifference = right.severityLevel - left.severityLevel
    if (severityDifference !== 0) return severityDifference
    return new Date(left.onsetAt ?? left.firstSeenAt).getTime()
      - new Date(right.onsetAt ?? right.firstSeenAt).getTime()
  }), [events, hazardFilter, severityFilter])
  const filtersActive = hazardFilter !== 'all' || severityFilter !== 'all'
  const activeFilterCount = Number(hazardFilter !== 'all') + Number(severityFilter !== 'all')
  const previewedEvent = previewedEventId
    ? filteredEvents.find((event) => event.id === previewedEventId) ?? null
    : null
  const selectedIndex = selected ? filteredEvents.findIndex((event) => event.id === selected.id) : -1
  const previousEvent = selectedIndex > 0 ? filteredEvents[selectedIndex - 1] : null
  const nextEvent = selectedIndex >= 0 && selectedIndex < filteredEvents.length - 1 ? filteredEvents[selectedIndex + 1] : null
  const severeCount = workspace.activeEvents.filter((event) => event.severityLevel >= 2).length
  const upcomingCount = workspace.activeEvents.filter((event) => event.status === 'upcoming').length

  useEffect(() => {
    if (!selected) return
    let active = true
    getWeatherEventDetailAction(selected.id).then((result) => {
      if (!active) return
      setDetailLoading(false)
      if (!result.success) {
        setDetailError(result.error)
        return
      }
      setSelectedDetail(result.detail)
    })
    return () => { active = false }
  }, [selected])

  const closePopup = () => {
    setSelected(null)
    setSelectedDetail(null)
    setDetailLoading(false)
    setDetailError(null)
    window.history.replaceState(null, '', '/weather-alerts')
  }
  const openPopup = (event: WeatherEventListItem, button: HTMLElement | SVGElement) => {
    setPreviewedEventId(null)
    if (event.status === 'ended' || event.status === 'cancelled') setTab('history')
    setSelectedDetail(null)
    setDetailLoading(true)
    setDetailError(null)
    setSelected(event)
    setTrigger(button)
    window.history.replaceState(null, '', `/weather-alerts?event=${event.id}`)
  }
  const navigatePopup = (event: WeatherEventListItem) => {
    setSelectedDetail(null)
    setDetailLoading(true)
    setDetailError(null)
    setSelected(event)
    window.history.replaceState(null, '', `/weather-alerts?event=${event.id}`)
  }

  const summary = useMemo<WeatherSummaryCard[]>(() => [
    { label: 'Aktivní výstrahy', value: workspace.activeEvents.length, tone: 'blue' },
    { label: 'Vyšší nebezpečí', value: severeCount, tone: 'amber' },
    { label: 'Teprve začnou', value: upcomingCount, tone: 'violet' },
    { label: 'Záznamy historie', value: workspace.historyEvents.length, tone: 'emerald' },
  ], [severeCount, upcomingCount, workspace.activeEvents.length, workspace.historyEvents.length])

  return (
    <>
      <WeatherSummaryStats cards={summary} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="activities-page__panel min-w-0 rounded-[28px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 shrink-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-secondary)]">
                <span className="lg:hidden">ČHMÚ · CELÁ ČR</span>
                <span className="hidden lg:inline">ČHMÚ · CELÁ ČESKÁ REPUBLIKA</span>
              </p>
              <h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">Přehled výstrah</h2>
            </div>
            <div className="hidden min-w-0 items-center gap-2 lg:flex">
              <div className="weather-alerts__record-surface flex h-11 min-w-0 items-center gap-1.5 rounded-2xl border p-1">
                <span className="flex h-9 w-8 shrink-0 items-center justify-center text-[var(--text-secondary)]" title="Filtry">
                  <Filter aria-hidden size={14} />
                  <span className="sr-only">Filtry</span>
                </span>
                <label className="relative w-[132px] shrink-0 xl:w-[140px] 2xl:w-[170px]">
                  <span className="sr-only">Filtrovat podle typu jevu</span>
                  <select
                    value={hazardFilter}
                    onChange={(event) => setHazardFilter(event.target.value as HazardFilter)}
                    className="h-9 w-full appearance-none rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] py-0 pl-3 pr-8 text-[11px] font-medium text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  >
                    {HAZARD_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <ChevronDown aria-hidden size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                </label>
                <label className="relative w-[132px] shrink-0 xl:w-[140px] 2xl:w-[170px]">
                  <span className="sr-only">Filtrovat podle stupně nebezpečí</span>
                  <select
                    value={severityFilter}
                    onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}
                    className="h-9 w-full appearance-none rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] py-0 pl-3 pr-8 text-[11px] font-medium text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  >
                    {SEVERITY_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <ChevronDown aria-hidden size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                </label>
                <span aria-live="polite" className="min-w-7 shrink-0 px-1 text-center text-[9px] font-semibold text-[var(--text-secondary)]">
                  {filteredEvents.length}/{events.length}
                </span>
              </div>
              <div className="weather-alerts__record-surface inline-flex h-11 shrink-0 rounded-2xl border p-1">
                <button type="button" onClick={() => setTab('active')} className={`h-9 rounded-xl px-3 text-[10px] font-bold uppercase transition ${tab === 'active' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)]'}`}>Aktuální</button>
                <button type="button" onClick={() => setTab('history')} className={`h-9 rounded-xl px-3 text-[10px] font-bold uppercase transition ${tab === 'history' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)]'}`}>Historie</button>
              </div>
            </div>
            <div className="weather-alerts__record-surface inline-flex shrink-0 rounded-2xl border p-1 lg:hidden">
              <button type="button" onClick={() => setTab('active')} className={`h-9 rounded-xl px-3 text-[10px] font-bold uppercase transition ${tab === 'active' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)]'}`}>Aktuální</button>
              <button type="button" onClick={() => setTab('history')} className={`h-9 rounded-xl px-3 text-[10px] font-bold uppercase transition ${tab === 'history' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)]'}`}>Historie</button>
            </div>
          </div>

          <div className="weather-alerts__record-surface mt-4 min-w-0 overflow-hidden rounded-[18px] border lg:hidden">
            <button
              type="button"
              aria-expanded={mobileFiltersOpen}
              aria-controls="weather-mobile-filters"
              onClick={() => setMobileFiltersOpen((open) => !open)}
              className="flex h-11 w-full min-w-0 items-center justify-between gap-3 px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]"
            >
              <span className="flex min-w-0 items-center gap-2 text-[10px] font-bold uppercase tracking-[0.11em] text-[var(--text-secondary)]">
                <Filter aria-hidden size={14} className="shrink-0" />
                <span>Filtry</span>
                {activeFilterCount > 0 ? (
                  <span className="rounded-full bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] px-2 py-1 text-[9px] tracking-normal text-[var(--accent)]">
                    {activeFilterCount} aktivní
                  </span>
                ) : null}
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[10px] font-semibold text-[var(--text-secondary)]">
                <span aria-live="polite">{filteredEvents.length}/{events.length}</span>
                <ChevronDown aria-hidden size={15} className={`transition-transform duration-200 ${mobileFiltersOpen ? 'rotate-180' : ''}`} />
              </span>
            </button>
            {mobileFiltersOpen ? (
              <div id="weather-mobile-filters" className="grid gap-2 border-t border-[var(--surface-border)] p-2.5 sm:grid-cols-2">
                <label className="relative min-w-0">
                  <span className="sr-only">Filtrovat podle typu jevu</span>
                  <select
                    value={hazardFilter}
                    onChange={(event) => setHazardFilter(event.target.value as HazardFilter)}
                    className="h-10 w-full min-w-0 appearance-none rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] py-0 pl-3 pr-9 text-xs font-medium text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  >
                    {HAZARD_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <ChevronDown aria-hidden size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                </label>
                <label className="relative min-w-0">
                  <span className="sr-only">Filtrovat podle stupně nebezpečí</span>
                  <select
                    value={severityFilter}
                    onChange={(event) => setSeverityFilter(event.target.value as SeverityFilter)}
                    className="h-10 w-full min-w-0 appearance-none rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] py-0 pl-3 pr-9 text-xs font-medium text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]"
                  >
                    {SEVERITY_FILTER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                  <ChevronDown aria-hidden size={14} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" />
                </label>
              </div>
            ) : null}
          </div>

          <div className="mt-5">
            <WeatherAlertMap events={previewedEvent ? [previewedEvent] : filteredEvents} onEventOpen={openPopup} />
          </div>

          {filteredEvents.length > 0 ? <div className="mt-5 grid min-w-0 gap-3 md:grid-cols-2">{filteredEvents.map((event) => <EventCard key={event.id} event={event} onOpen={openPopup} onPreview={(previewEvent) => setPreviewedEventId(previewEvent.id)} onPreviewEnd={(previewEvent) => setPreviewedEventId((current) => current === previewEvent.id ? null : current)} />)}</div> : <div className="weather-alerts__record-surface mt-5 flex min-h-[132px] flex-col items-center justify-center rounded-[22px] border border-dashed px-5 py-4 text-center"><CircleAlert aria-hidden size={24} className={filtersActive ? 'text-[var(--accent)]' : 'text-emerald-500'} /><strong className="mt-2 text-sm text-[var(--text-primary)]">{filtersActive ? 'Žádná výstraha neodpovídá zvoleným filtrům.' : tab === 'active' ? 'ČHMÚ nyní neeviduje aktivní výstrahu.' : 'V historii zatím nejsou žádné výstrahy.'}</strong><span className="mt-1 text-xs text-[var(--text-secondary)]">{filtersActive ? 'Zkuste změnit typ jevu nebo stupeň nebezpečí.' : 'Data se automaticky průběžně obnovují.'}</span>{filtersActive ? <button type="button" onClick={() => { setHazardFilter('all'); setSeverityFilter('all') }} className="mt-3 h-9 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-4 text-[10px] font-bold uppercase text-[var(--accent)]">Zrušit filtry</button> : null}</div>}
        </section>

        <aside className="min-w-0">
          <p className="mb-3 text-[10px] text-[var(--text-secondary)] sm:hidden">
            Přejetím do strany zobrazíte další panel.
          </p>
          <div
            className="activities-manual-carousel weather-alerts-mobile-aside-carousel grid min-w-0 auto-cols-[100%] grid-flow-col items-stretch snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-[24px] sm:block sm:space-y-4 sm:snap-none sm:overflow-visible sm:rounded-none"
            aria-label="Nastavení upozornění a stav zdroje dat ČHMÚ"
          >
            <div className="min-w-0 snap-start snap-always sm:snap-none">
              <NotificationSettings initialPreferences={workspace.preferences} />
            </div>
            <div className="min-w-0 snap-start snap-always sm:snap-none">
              <WeatherSourceStatusCard
                key={`${workspace.sourceStatus.dataVersion}:${workspace.sourceStatus.lastSuccessAt ?? 'none'}:${workspace.sourceStatus.lastAttemptAt ?? 'none'}:${workspace.sourceStatus.consecutiveFailureCount}`}
                initialStatus={workspace.sourceStatus}
                isRefreshing={isRefreshing}
                onRefresh={refreshWorkspace}
                onDataVersionChange={refreshWorkspace}
              />
            </div>
          </div>
        </aside>
      </div>

      {mounted && selected ? createPortal(
        <EventPopup
          event={selected}
          detail={selectedDetail}
          detailLoading={detailLoading}
          detailError={detailError}
          trigger={trigger}
          previousEvent={previousEvent}
          nextEvent={nextEvent}
          positionLabel={selectedIndex >= 0 ? `${selectedIndex + 1} / ${filteredEvents.length}` : 'Výstrahy ČHMÚ'}
          onNavigate={navigatePopup}
          onClose={closePopup}
        />,
        document.body,
      ) : null}
    </>
  )
}
