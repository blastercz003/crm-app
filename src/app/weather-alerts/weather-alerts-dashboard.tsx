'use client'

import {
  Bell,
  BellOff,
  ChevronRight,
  CircleAlert,
  CloudLightning,
  CloudRainWind,
  History,
  IceCreamBowl,
  MapPin,
  Radio,
  Snowflake,
  Waves,
  Wind,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { updateWeatherNotificationPreferencesAction } from './actions'
import { WeatherAlertMap } from './weather-alert-map'
import type {
  WeatherAlertsWorkspace,
  WeatherEventListItem,
  WeatherHazardType,
  WeatherNotificationPreferences,
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
  const severity = SEVERITY_PRESENTATION[event.severityColor]
  const status = event.status === 'upcoming' ? 'PŘIPRAVUJE SE' : event.status === 'active' ? 'AKTIVNÍ' : event.status === 'cancelled' ? 'ZRUŠENÁ' : 'UKONČENÁ'
  return (
    <span className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[9px] font-bold tracking-[0.09em] ${severity.border} ${severity.surface} ${severity.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${severity.dot}`} />
      {status}
    </span>
  )
}

function EventCard({
  event,
  onOpen,
}: {
  event: WeatherEventListItem
  onOpen: (event: WeatherEventListItem, trigger: HTMLButtonElement) => void
}) {
  const hazard = HAZARD_PRESENTATION[event.hazardType]
  const Icon = hazard.icon
  const areas = uniqueAreaNames(event)
  return (
    <button
      type="button"
      onClick={(clickEvent) => onOpen(event, clickEvent.currentTarget)}
      className="group flex min-h-[132px] min-w-0 max-w-full flex-col overflow-hidden rounded-[22px] border border-[var(--surface-border)] bg-[var(--surface-muted)] p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_10px_26px_var(--shadow-soft)] transition duration-200 hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--accent)_30%,var(--surface-border))] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.62),0_16px_34px_var(--shadow-medium)]"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--surface-border)] bg-[var(--surface)] text-[var(--accent)]">
          <Icon aria-hidden size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge event={event} />
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">{hazard.label}</span>
          </span>
          <strong className="mt-2 block line-clamp-2 text-[15px] font-semibold leading-5 text-[var(--text-primary)]">
            {event.headline || event.eventName}
          </strong>
        </span>
        <ChevronRight aria-hidden size={18} className="mt-3 shrink-0 text-[var(--text-tertiary)] transition group-hover:translate-x-0.5 group-hover:text-[var(--accent)]" />
      </div>
      <span className="mt-auto flex min-w-0 items-end justify-between gap-3 pt-3 text-[11px] text-[var(--text-secondary)]">
        <span className="min-w-0 truncate">
          {areas.length > 0 ? `${areas.slice(0, 2).join(', ')}${areas.length > 2 ? ` +${areas.length - 2}` : ''}` : 'Území není upřesněno'}
        </span>
        <span className="shrink-0">do {formatShortDateTime(event.validTo)}</span>
      </span>
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

function EventPopup({
  event,
  trigger,
  onClose,
}: {
  event: WeatherEventListItem
  trigger: HTMLElement | SVGElement | null
  onClose: () => void
}) {
  const shellRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const hazard = HAZARD_PRESENTATION[event.hazardType]
  const Icon = hazard.icon
  const severity = SEVERITY_PRESENTATION[event.severityColor]
  const areas = uniqueAreaNames(event)

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true })
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === 'Escape') onClose()
    }
    const onPointerDown = (pointerEvent: PointerEvent) => {
      const target = pointerEvent.target as Node
      if (!shellRef.current?.contains(target) && !trigger?.contains(target)) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
      trigger?.focus({ preventScroll: true })
    }
  }, [onClose, trigger])

  return (
    <section
      ref={shellRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`weather-event-${event.id}`}
      className="weather-alerts-popup activities-manual-preview activities-manual-preview--mobile fixed inset-x-3 top-1/2 z-[145] mx-auto flex max-h-[calc(100dvh-24px)] w-auto max-w-[620px] -translate-y-1/2 flex-col overflow-hidden rounded-[26px] border border-[var(--surface-border)] bg-[var(--surface-strong)] shadow-[inset_0_1px_0_rgba(255,255,255,0.68),0_28px_70px_rgba(15,23,42,0.3)] sm:inset-x-auto sm:right-6 sm:w-[min(620px,calc(100vw-48px))]"
    >
      <header className="flex items-start gap-3 border-b border-[var(--surface-border)] p-4 sm:p-5">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${severity.border} ${severity.surface} ${severity.text}`}>
          <Icon aria-hidden size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge event={event} />
            <span className={`text-[9px] font-bold tracking-[0.1em] ${severity.text}`}>{severity.short}</span>
          </div>
          <h2 id={`weather-event-${event.id}`} className="mt-2 text-lg font-semibold leading-6 text-[var(--text-primary)] sm:text-xl">
            {event.headline || event.eventName}
          </h2>
        </div>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Zavřít detail výstrahy" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">
          <X aria-hidden size={18} />
        </button>
      </header>

      <div className="overflow-y-auto overscroll-contain p-4 sm:p-5">
        <WeatherAlertMap events={[event]} compact />

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <DetailRow label="Začátek" value={formatDateTime(event.onsetAt)} />
          <DetailRow label="Platnost do" value={formatDateTime(event.validTo)} />
          <DetailRow label="Jev" value={hazard.label} />
          <DetailRow label="Stupeň" value={severity.label} />
        </div>

        {event.description ? (
          <div className="mt-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Popis výstrahy</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[var(--text-primary)]">{readableBodyText(event.description)}</p>
          </div>
        ) : null}
        {event.instruction ? (
          <div className="mt-4 rounded-2xl border border-[var(--surface-border)] bg-[var(--accent-soft)]/45 p-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">Doporučení ČHMÚ</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[var(--text-primary)]">{readableBodyText(event.instruction)}</p>
          </div>
        ) : null}
        {event.criterion ? (
          <div className="mt-4">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">Kritérium</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-[var(--text-primary)]">{event.criterion}</p>
          </div>
        ) : null}

        <div className="mt-4">
          <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
            <MapPin aria-hidden size={15} /> Zasažené oblasti
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {areas.length > 0 ? areas.map((area) => (
              <span key={area} className="rounded-full border border-[var(--surface-border)] bg-[var(--surface-muted)] px-2.5 py-1 text-[10px] font-medium text-[var(--text-secondary)]">{area}</span>
            )) : <span className="text-sm text-[var(--text-secondary)]">ČHMÚ území blíže neurčilo.</span>}
          </div>
        </div>

        <footer className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--surface-border)] pt-4">
          <span className="text-[10px] text-[var(--text-tertiary)]">Zdroj: Český hydrometeorologický ústav</span>
          {event.sourceWebUrl ? <a href={event.sourceWebUrl} target="_blank" rel="noreferrer" className="text-[11px] font-bold uppercase text-[var(--accent)] hover:underline">Otevřít zdroj</a> : null}
        </footer>
      </div>
    </section>
  )
}

function NotificationSettings({
  initialPreferences,
}: {
  initialPreferences: WeatherNotificationPreferences
}) {
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
    <section className="rounded-[24px] border border-[var(--surface-border)] bg-[var(--surface)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_12px_30px_var(--shadow-soft)] sm:p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--accent)]">
          {preferences.notificationsEnabled ? <Bell aria-hidden size={19} /> : <BellOff aria-hidden size={19} />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Upozornění na výstrahy</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">Oranžové a červené výstrahy. Žluté lze přidat samostatně.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={preferences.notificationsEnabled}
          disabled={pending}
          onClick={() => save({ ...preferences, notificationsEnabled: !preferences.notificationsEnabled, includeYellowWarnings: preferences.notificationsEnabled ? false : preferences.includeYellowWarnings })}
          className={`relative h-7 w-12 shrink-0 rounded-full border transition ${preferences.notificationsEnabled ? 'border-[var(--accent)] bg-[var(--accent)]' : 'border-[var(--surface-border)] bg-[var(--surface-muted)]'} disabled:opacity-60`}
        >
          <span className={`absolute top-1 h-[18px] w-[18px] rounded-full bg-white shadow transition ${preferences.notificationsEnabled ? 'left-[25px]' : 'left-1'}`} />
        </button>
      </div>
      <button
        type="button"
        disabled={!preferences.notificationsEnabled || pending}
        onClick={() => save({ ...preferences, includeYellowWarnings: !preferences.includeYellowWarnings })}
        className="mt-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3 text-left disabled:opacity-45"
      >
        <span>
          <strong className="block text-sm font-medium text-[var(--text-primary)]">Zahrnout také žluté výstrahy</strong>
          <span className="mt-0.5 block text-[11px] text-[var(--text-secondary)]">Více upozornění na méně závažné jevy.</span>
        </span>
        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${preferences.includeYellowWarnings ? 'border-yellow-400 bg-yellow-400 text-slate-950' : 'border-[var(--text-tertiary)]'}`}>
          {preferences.includeYellowWarnings ? '✓' : ''}
        </span>
      </button>
      {message ? <p className={`mt-2 text-[11px] ${message === 'Nastavení bylo uloženo.' ? 'text-emerald-600' : 'text-red-600'}`}>{message}</p> : null}
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
  const mounted = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  )
  const events = tab === 'active' ? workspace.activeEvents : workspace.historyEvents
  const severeCount = workspace.activeEvents.filter((event) => event.severityLevel >= 2).length
  const upcomingCount = workspace.activeEvents.filter((event) => event.status === 'upcoming').length
  const lastSync = workspace.sourceStatus.lastSuccessAt

  const closePopup = () => {
    setSelected(null)
    window.history.replaceState(null, '', '/weather-alerts')
  }
  const openPopup = (event: WeatherEventListItem, button: HTMLElement | SVGElement) => {
    if (event.status === 'ended' || event.status === 'cancelled') setTab('history')
    setSelected(event)
    setTrigger(button)
    window.history.replaceState(null, '', `/weather-alerts?event=${event.id}`)
  }

  const sourceHealthy = workspace.sourceStatus.consecutiveFailureCount === 0
  const summary = useMemo(() => [
    { label: 'Aktivní výstrahy', value: workspace.activeEvents.length, icon: CircleAlert, tone: 'text-[var(--accent)]' },
    { label: 'Vyšší nebezpečí', value: severeCount, icon: CloudLightning, tone: 'text-orange-500' },
    { label: 'Teprve začnou', value: upcomingCount, icon: Radio, tone: 'text-violet-500' },
    { label: 'Záznamy historie', value: workspace.historyEvents.length, icon: History, tone: 'text-emerald-500' },
  ], [severeCount, upcomingCount, workspace.activeEvents.length, workspace.historyEvents.length])

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summary.map((item) => {
          const Icon = item.icon
          return <div key={item.label} className="rounded-[22px] border border-[var(--surface-border)] bg-[var(--surface)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.62),0_12px_28px_var(--shadow-soft)]"><div className="flex items-center justify-between gap-3"><span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">{item.label}</span><Icon aria-hidden size={18} className={item.tone} /></div><div className="mt-3 text-3xl font-semibold tracking-tight text-[var(--text-primary)]">{item.value}</div></div>
        })}
      </div>

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0 rounded-[28px] border border-[var(--surface-border)] bg-[var(--surface)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_18px_45px_var(--shadow-soft)] sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-[var(--text-secondary)]">ČHMÚ · CELÁ ČESKÁ REPUBLIKA</p>
              <h2 className="mt-1 text-xl font-semibold text-[var(--text-primary)]">Přehled výstrah</h2>
            </div>
            <div className="inline-flex rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-1">
              <button type="button" onClick={() => setTab('active')} className={`h-9 rounded-xl px-3 text-[10px] font-bold uppercase transition ${tab === 'active' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)]'}`}>Aktuální</button>
              <button type="button" onClick={() => setTab('history')} className={`h-9 rounded-xl px-3 text-[10px] font-bold uppercase transition ${tab === 'history' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)]'}`}>Historie</button>
            </div>
          </div>

          <div className="mt-5">
            <WeatherAlertMap events={events} onEventOpen={openPopup} />
          </div>

          {events.length > 0 ? <div className="mt-5 grid min-w-0 gap-3 md:grid-cols-2">{events.map((event) => <EventCard key={event.id} event={event} onOpen={openPopup} />)}</div> : <div className="mt-5 flex min-h-52 flex-col items-center justify-center rounded-[22px] border border-dashed border-[var(--surface-border)] bg-[var(--surface-muted)] px-5 text-center"><CircleAlert aria-hidden size={28} className="text-emerald-500" /><strong className="mt-3 text-sm text-[var(--text-primary)]">{tab === 'active' ? 'ČHMÚ nyní neeviduje relevantní aktivní výstrahu.' : 'V historii zatím nejsou žádné výstrahy.'}</strong><span className="mt-1 text-xs text-[var(--text-secondary)]">Data se automaticky průběžně obnovují.</span></div>}
        </section>

        <aside className="space-y-4">
          <NotificationSettings initialPreferences={workspace.preferences} />
          <section className="rounded-[24px] border border-[var(--surface-border)] bg-[var(--surface)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.6),0_12px_30px_var(--shadow-soft)] sm:p-5">
            <div className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${sourceHealthy ? 'bg-emerald-500' : 'bg-red-500'}`} /><div><h2 className="text-sm font-semibold text-[var(--text-primary)]">Zdroj dat ČHMÚ</h2><p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{sourceHealthy ? 'Poslední načtení proběhlo v pořádku.' : 'Poslední načtení hlásí problém.'}</p></div></div>
            <div className="mt-4 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3"><span className="text-[9px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]">Poslední aktualizace</span><strong className="mt-1 block text-sm text-[var(--text-primary)]">{formatDateTime(lastSync, 'Zatím neproběhla')}</strong></div>
            <button type="button" onClick={() => router.refresh()} className="mt-3 inline-flex h-9 w-full items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[10px] font-bold uppercase text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]">Obnovit zobrazení</button>
          </section>
        </aside>
      </div>

      {mounted && selected ? createPortal(<EventPopup event={selected} trigger={trigger} onClose={closePopup} />, document.body) : null}
    </>
  )
}
