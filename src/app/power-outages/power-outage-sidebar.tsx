'use client'

import {
  BellRing,
  ChevronRight,
  CircleAlert,
  DatabaseZap,
  History,
  RefreshCw,
  Route,
  ShieldCheck,
  TimerReset,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import type {
  PowerOutageNotificationPreferences,
  PowerOutageSource,
  PowerOutageSourceDiagnostic,
  PowerOutageSourceStatus,
  PowerOutageSourceSummary,
} from '@/lib/power-outages/types'
import {
  getPowerOutageSourceDiagnosticAction,
  updatePowerOutageNotificationPreferencesAction,
} from './actions'
import { PowerOutageDetailRow, PowerOutagePopupShell } from './power-outage-popups'

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague',
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

function formatDateTime(value: string | null) {
  if (!value) return 'Zatím neproběhlo'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Neuvedeno' : DATE_TIME_FORMATTER.format(date)
}

function sourceName(source: PowerOutageSource) {
  return source === 'cez' ? 'ČEZ Distribuce' : 'EG.D'
}

const STATUS_PRESENTATION: Record<PowerOutageSourceStatus, { label: string; badge: string; dot: string }> = {
  live: { label: 'ŽIVĚ', badge: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300', dot: 'bg-emerald-500' },
  warning: { label: 'ZPOŽDĚNÍ', badge: 'border-amber-500/40 bg-amber-500/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300', dot: 'bg-amber-500' },
  error: { label: 'CHYBA', badge: 'border-red-500/40 bg-red-500/10 text-red-700 [html[data-theme=dark]_&]:text-red-300', dot: 'bg-red-500' },
  pending: { label: 'ČEKÁM', badge: 'border-slate-400/40 bg-slate-400/10 text-[var(--text-secondary)]', dot: 'bg-slate-400' },
}

function Switch({ checked, disabled = false, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)} className={`relative h-7 w-12 shrink-0 rounded-full border transition ${checked ? 'border-sky-500 bg-sky-500' : 'border-[var(--surface-border)] bg-[var(--surface-muted)]'} disabled:cursor-not-allowed disabled:opacity-45`}>
      <span className={`absolute left-0 top-1/2 h-5 w-5 -translate-y-1/2 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-[3px]'}`} />
    </button>
  )
}

function NotificationSettings({ initial }: { initial: PowerOutageNotificationPreferences }) {
  const [preferences, setPreferences] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const save = (next: PowerOutageNotificationPreferences) => {
    setPreferences(next)
    setError(null)
    startTransition(async () => {
      const result = await updatePowerOutageNotificationPreferencesAction({
        notificationsEnabled: next.notificationsEnabled,
        reminder24hEnabled: next.reminder24hEnabled,
      })
      if (result.success) setPreferences(result.preferences)
      else {
        setPreferences(preferences)
        setError(result.error)
      }
    })
  }

  return (
    <section className="activities-page__panel flex h-[360px] min-w-0 flex-col rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_16px_36px_rgba(15,23,42,0.1)] sm:p-5 lg:h-auto">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-[var(--accent)]"><BellRing aria-hidden size={18} /></span>
        <div className="min-w-0"><span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Nastavení</span><h2 className="truncate text-base font-semibold text-[var(--text-primary)]">Upozornění na odstávky</h2></div>
      </div>
      <div className="mt-4 space-y-2.5">
        <div className="weather-alerts__record-surface flex min-h-[72px] items-center justify-between gap-3 rounded-2xl border px-3.5 py-3">
          <span className="min-w-0"><strong className="block text-xs text-[var(--text-primary)]">Nově nalezené odstávky</strong><small className="mt-1 block text-[9px] leading-4 text-[var(--text-secondary)]">Běžná notifikace aplikace a PWA.</small></span>
          <Switch checked={preferences.notificationsEnabled} disabled={pending} label="Upozornění na nové odstávky" onChange={(checked) => save({ ...preferences, notificationsEnabled: checked, reminder24hEnabled: checked ? preferences.reminder24hEnabled : false })} />
        </div>
        <div className="weather-alerts__record-surface flex min-h-[72px] items-center justify-between gap-3 rounded-2xl border px-3.5 py-3">
          <span className="min-w-0"><strong className="block text-xs text-[var(--text-primary)]">Připomenout 24 hodin předem</strong><small className="mt-1 block text-[9px] leading-4 text-[var(--text-secondary)]">Doplňkové připomenutí blížícího se termínu.</small></span>
          <Switch checked={preferences.reminder24hEnabled} disabled={pending || !preferences.notificationsEnabled} label="Připomenout odstávku 24 hodin předem" onChange={(checked) => save({ ...preferences, reminder24hEnabled: checked })} />
        </div>
      </div>
      <div className="mt-auto pt-3">
        <p className="flex items-center gap-2 text-[9px] leading-4 text-[var(--text-secondary)]"><ShieldCheck aria-hidden size={13} className="shrink-0 text-emerald-500" /> Upozornění se vztahují pouze na nalezené prodejny.</p>
        {error ? <p className="mt-2 text-[9px] font-semibold text-red-600 [html[data-theme=dark]_&]:text-red-300">{error}</p> : null}
      </div>
    </section>
  )
}

function SourcePanel({ source, onOpen }: { source: PowerOutageSourceSummary; onOpen: () => void }) {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState<string | null>(null)
  const status = STATUS_PRESENTATION[source.status]

  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setRefreshError(null)
    try {
      const response = await fetch(`/api/power-outages/sync?source=${source.source}`, { method: 'POST' })
      const payload = await response.json().catch(() => null) as { error?: string } | null
      if (!response.ok) throw new Error(payload?.error || `Obnovení skončilo HTTP ${response.status}.`)
      router.refresh()
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : 'Ruční obnovení selhalo.')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <section className="activities-page__panel flex h-[360px] min-w-0 flex-col rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_16px_36px_rgba(15,23,42,0.1)] sm:p-5 lg:h-auto">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-[var(--accent)]"><DatabaseZap aria-hidden size={18} /></span>
          <span className="min-w-0"><span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Zdroj dat</span><strong className="block truncate text-base font-semibold text-[var(--text-primary)]">{sourceName(source.source)}</strong></span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => void refresh()} disabled={refreshing} aria-label={`Ručně obnovit data ${sourceName(source.source)}`} title="Ručně obnovit data" className="flex h-8 w-9 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] transition hover:text-[var(--accent)] disabled:opacity-55"><RefreshCw aria-hidden size={13} className={refreshing ? 'animate-spin' : ''} /></button>
          <span className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-2 text-[8px] font-bold tracking-[0.07em] ${status.badge}`}><i aria-hidden className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.label}</span>
        </div>
      </div>

      <button type="button" onClick={onOpen} className="mt-4 min-h-0 flex-1 text-left">
        <div className="grid grid-cols-2 gap-2">
          <div className="weather-alerts__record-surface rounded-xl border p-2.5"><span className="block text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]">Poslední pokus</span><strong className="mt-1 block text-[10px] text-[var(--text-primary)]">{formatDateTime(source.lastAttemptAt)}</strong></div>
          <div className="weather-alerts__record-surface rounded-xl border p-2.5"><span className="block text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]">Úspěšně načteno</span><strong className="mt-1 block text-[10px] text-[var(--text-primary)]">{formatDateTime(source.lastSuccessAt)}</strong></div>
          <div className="weather-alerts__record-surface rounded-xl border p-2.5"><span className="block text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]">Zpracováno</span><strong className="mt-1 block text-sm tabular-nums text-[var(--text-primary)]">{source.processedRecordCount}</strong></div>
          <div className="weather-alerts__record-surface rounded-xl border p-2.5"><span className="block text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]">Nalezené změny</span><strong className="mt-1 block text-sm tabular-nums text-[var(--text-primary)]">{source.changeCount ?? '—'}</strong></div>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2.5">
          <span className="min-w-0"><small className="block text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]">Pokrytí relevantních obcí</small><strong className="mt-0.5 block truncate text-[10px] text-[var(--text-primary)]">{source.municipalityCoverage}</strong></span>
          <ChevronRight aria-hidden size={15} className="shrink-0 text-[var(--text-secondary)]" />
        </div>
      </button>
      {source.lastErrorMessage || refreshError ? <p className="mt-2 line-clamp-2 text-[9px] font-semibold leading-4 text-red-600 [html[data-theme=dark]_&]:text-red-300">{refreshError ?? source.lastErrorMessage}</p> : null}
    </section>
  )
}

function runStatusLabel(status: PowerOutageSourceDiagnostic['runs'][number]['status']) {
  return ({ running: 'Probíhá', succeeded: 'Úspěch', no_change: 'Bez změny', failed: 'Chyba', skipped: 'Přeskočeno' })[status]
}

function SourceDiagnosticPopup({ source, diagnostic, loading, error, onClose }: { source: PowerOutageSource; diagnostic: PowerOutageSourceDiagnostic | null; loading: boolean; error: string | null; onClose: () => void }) {
  const schedule = source === 'cez'
    ? 'Hlavní kontrola každých 6 hodin; rozpracované dávky pokračují každých 15 minut.'
    : 'Kontrola celé distribuční oblasti každých 6 hodin s časovým posunem vůči ČEZ.'
  const status = diagnostic ? STATUS_PRESENTATION[diagnostic.status] : STATUS_PRESENTATION.pending

  return (
    <PowerOutagePopupShell titleId={`power-outage-source-${source}`} eyebrow="ODSTÁVKY · PROVOZNÍ DETAIL" title={sourceName(source)} icon={<DatabaseZap aria-hidden size={21} />} onClose={onClose}>
      {loading ? <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center p-6 text-center"><span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--surface-border)] border-t-[var(--accent)]" /><strong className="mt-4 text-sm text-[var(--text-primary)]">Načítám provozní stav…</strong></div> : error || !diagnostic ? <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center p-6 text-center"><CircleAlert aria-hidden size={28} className="text-red-500" /><strong className="mt-3 text-sm text-[var(--text-primary)]">Provozní detail se nepodařilo načíst</strong><p className="mt-1 max-w-md text-xs leading-5 text-[var(--text-secondary)]">{error ?? 'Data nejsou dostupná.'}</p></div> : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5">
            <span><small className="block text-[8px] font-bold uppercase tracking-[0.09em] text-[var(--text-secondary)]">Aktuální stav zdroje</small><strong className="mt-1 block text-sm text-[var(--text-primary)]">{status.label}</strong></span>
            <span className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-[8px] font-bold tracking-[0.07em] ${status.badge}`}><i className={`h-1.5 w-1.5 rounded-full ${status.dot}`} />{status.label}</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <PowerOutageDetailRow label="Poslední pokus" value={formatDateTime(diagnostic.sourceState.lastAttemptAt)} />
            <PowerOutageDetailRow label="Poslední úspěch" value={formatDateTime(diagnostic.sourceState.lastSuccessAt)} />
            <PowerOutageDetailRow label="Poslední změna" value={formatDateTime(diagnostic.sourceState.lastChangeAt)} />
            <PowerOutageDetailRow label="Aktivní odstávky" value={String(diagnostic.sourceState.activeOutageCount)} />
            <PowerOutageDetailRow label="Budoucí odstávky" value={String(diagnostic.sourceState.futureOutageCount)} />
            <PowerOutageDetailRow label="Verze dat" value={String(diagnostic.sourceState.dataVersion)} />
            <PowerOutageDetailRow label="Zpracovaná revize prodejen" value={`${diagnostic.sourceState.storeRevisionProcessed} / ${diagnostic.catalogRevision}`} />
            <PowerOutageDetailRow label="Stav plánované úlohy" value={diagnostic.task?.lastStatus ?? 'Neuvedeno'} />
            <PowerOutageDetailRow label="Selhání v řadě" value={String(Math.max(diagnostic.sourceState.consecutiveFailureCount, diagnostic.task?.consecutiveFailureCount ?? 0))} />
          </div>

          <section className="mt-5">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><Route aria-hidden size={14} /> Proces načítání</h3>
            <p className="mt-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5 text-xs leading-5 text-[var(--text-primary)]">{schedule}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {['Stažení veřejných dat distributora', 'Normalizace a kontrola termínů', 'Uložení změn a historie verzí', 'Párování prodejen podle města a ulice'].map((step, index) => <div key={step} className="flex items-center gap-2.5 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2.5"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-[9px] font-bold text-[var(--accent)]">{index + 1}</span><span className="text-[10px] font-semibold text-[var(--text-primary)]">{step}</span></div>)}
            </div>
          </section>

          {(diagnostic.sourceState.lastErrorMessage || diagnostic.task?.lastErrorMessage) ? <section className="mt-5"><h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-red-600 [html[data-theme=dark]_&]:text-red-300"><CircleAlert aria-hidden size={14} /> Poslední chyba</h3><div className="mt-2 rounded-2xl border border-red-400/30 bg-red-500/8 p-3.5"><strong className="text-[10px] text-red-700 [html[data-theme=dark]_&]:text-red-300">{diagnostic.sourceState.lastErrorCode ?? diagnostic.task?.lastErrorCode ?? 'CHYBA ZDROJE'}</strong><p className="mt-1 text-xs leading-5 text-[var(--text-primary)]">{diagnostic.sourceState.lastErrorMessage ?? diagnostic.task?.lastErrorMessage}</p></div></section> : null}

          <section className="mt-5">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><History aria-hidden size={14} /> Poslední synchronizační běhy</h3>
            <div className="mt-2 space-y-2">
              {diagnostic.runs.map((run) => <div key={run.id} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3"><div className="flex items-start justify-between gap-3"><span><strong className="block text-[11px] text-[var(--text-primary)]">{runStatusLabel(run.status)} · {run.sourceRecordCount} záznamů</strong><small className="mt-0.5 block text-[9px] leading-4 text-[var(--text-secondary)]">Uloženo {run.outageUpsertCount} odstávek a {run.addressUpsertCount} adres</small></span><time className="shrink-0 text-[9px] font-semibold tabular-nums text-[var(--text-secondary)]">{formatDateTime(run.startedAt)}</time></div>{run.errorMessage ? <p className="mt-2 text-[9px] leading-4 text-red-600 [html[data-theme=dark]_&]:text-red-300">{run.errorCode}: {run.errorMessage}</p> : null}</div>)}
              {diagnostic.runs.length === 0 ? <p className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--text-secondary)]">Historie běhů zatím není dostupná.</p> : null}
            </div>
          </section>

          <section className="mt-5"><h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><TimerReset aria-hidden size={14} /> Technický stav</h3><div className="mt-2 grid gap-2 sm:grid-cols-2"><PowerOutageDetailRow label="Poslední start úlohy" value={formatDateTime(diagnostic.task?.lastStartedAt ?? null)} /><PowerOutageDetailRow label="Poslední dokončení" value={formatDateTime(diagnostic.task?.lastFinishedAt ?? null)} /><PowerOutageDetailRow label="Reference zdroje" value={diagnostic.sourceState.latestSourceRef ?? 'Neuvedeno'} mono /><PowerOutageDetailRow label="Hash posledních dat" value={diagnostic.sourceState.latestPayloadSha256 ?? 'Neuvedeno'} mono /></div></section>
        </div>
      )}
    </PowerOutagePopupShell>
  )
}

export function PowerOutageSidebar({ preferences, sources }: { preferences: PowerOutageNotificationPreferences; sources: PowerOutageSourceSummary[] }) {
  const [selectedSource, setSelectedSource] = useState<PowerOutageSource | null>(null)
  const [diagnostic, setDiagnostic] = useState<PowerOutageSourceDiagnostic | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openSource = async (source: PowerOutageSource) => {
    setSelectedSource(source)
    setDiagnostic(null)
    setError(null)
    setLoading(true)
    const result = await getPowerOutageSourceDiagnosticAction(source)
    if (result.success) setDiagnostic(result.diagnostic)
    else setError(result.error)
    setLoading(false)
  }

  const close = () => {
    setSelectedSource(null)
    setDiagnostic(null)
    setError(null)
    setLoading(false)
  }

  return (
    <>
      <aside className="activities-manual-carousel grid min-w-0 auto-cols-[calc(100%-18px)] grid-flow-col items-stretch gap-3 snap-x snap-mandatory overflow-x-auto overscroll-x-contain rounded-[24px] pb-1 lg:block lg:space-y-4 lg:overflow-visible lg:rounded-none lg:pb-0" aria-label="Nastavení upozornění a stav zdrojů odstávek">
        <div className="min-w-0 snap-start snap-always lg:snap-none"><NotificationSettings key={preferences.updatedAt ?? 'default'} initial={preferences} /></div>
        {sources.map((source) => <div key={source.source} className="min-w-0 snap-start snap-always lg:snap-none"><SourcePanel source={source} onOpen={() => void openSource(source.source)} /></div>)}
      </aside>
      {selectedSource && typeof document !== 'undefined' ? createPortal(<SourceDiagnosticPopup source={selectedSource} diagnostic={diagnostic} loading={loading} error={error} onClose={close} />, document.body) : null}
    </>
  )
}
