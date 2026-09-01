'use client'

import {
  BellRing,
  ChevronRight,
  CircleAlert,
  DatabaseZap,
  History,
  Info,
  MapPinCheck,
  RefreshCw,
  Route,
  ShieldCheck,
  TimerReset,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import type {
  PowerOutageNotificationPreferences,
  PowerOutageSource,
  PowerOutageSourceDiagnostic,
  PowerOutageSourceStatus,
  PowerOutageSourceSummary,
  PowerOutageStoreCoverage,
} from '@/lib/power-outages/types'
import {
  getPowerOutageSourceDiagnosticAction,
  updatePowerOutageNotificationPreferencesAction,
} from './actions'
import { PowerOutageDetailRow, PowerOutagePopupShell } from './power-outage-popups'
import { StoreAddressAnalysisPopup } from './store-address-analysis-popup'

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
  return source === 'cez' ? 'ČEZ Distribuce' : source === 'egd' ? 'EG.D' : 'PREdistribuce'
}

function sourceShortName(source: PowerOutageSource) {
  return source === 'cez' ? 'ČEZ' : source === 'egd' ? 'EG.D' : 'PRE'
}

const STATUS_PRESENTATION: Record<PowerOutageSourceStatus, { label: string; badge: string; dot: string }> = {
  live: { label: 'ŽIVĚ', badge: 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300', dot: 'bg-emerald-500' },
  processing: { label: 'ZPRACOVÁNÍ', badge: 'border-sky-500/40 bg-sky-500/10 text-sky-700 [html[data-theme=dark]_&]:text-sky-300', dot: 'bg-sky-500 animate-pulse motion-reduce:animate-none' },
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
        reminder24hEnabled: false,
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
      <div className="mt-4">
        <div className="weather-alerts__record-surface flex min-h-[72px] items-center justify-between gap-3 rounded-2xl border px-3.5 py-3">
          <span className="min-w-0"><strong className="block text-xs text-[var(--text-primary)]">Nově nalezené odstávky</strong><small className="mt-1 block text-[9px] leading-4 text-[var(--text-secondary)]">Běžná notifikace aplikace a PWA.</small></span>
          <Switch checked={preferences.notificationsEnabled} disabled={pending} label="Upozornění na nové odstávky" onChange={(checked) => save({ ...preferences, notificationsEnabled: checked, reminder24hEnabled: false })} />
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
  const needsAttention = Boolean(refreshError) || source.status === 'warning' || source.status === 'error'
  const recordsLabel = source.source === 'cez' ? 'Záznamů v dávce' : 'Záznamů ve snapshotu'
  const changesLabel = source.source === 'cez' ? 'Změny v dávce' : 'Změny ve snapshotu'
  const coverageLabel = source.source === 'cez' ? 'Obce v dávce' : 'Obce ve snapshotu'

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
    <section className="activities-page__panel flex h-[360px] min-w-0 flex-col rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_16px_36px_rgba(15,23,42,0.1)] sm:p-5 lg:h-auto lg:p-4">
      <div className="flex items-start justify-between gap-2">
        <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-[var(--accent)]"><DatabaseZap aria-hidden size={18} /></span>
          <span className="min-w-0"><span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Zdroj dat</span><strong className="block truncate text-base font-semibold text-[var(--text-primary)]">{sourceName(source.source)}</strong></span>
        </button>
        <div className="flex shrink-0 items-center gap-1.5">
          <button type="button" onClick={() => void refresh()} disabled={refreshing} aria-label={`Ručně obnovit data ${sourceName(source.source)}`} title="Ručně obnovit data" className="flex h-8 w-9 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] transition hover:text-[var(--accent)] disabled:opacity-55"><RefreshCw aria-hidden size={13} className={refreshing ? 'animate-spin' : ''} /></button>
          <button
            type="button"
            onClick={onOpen}
            aria-label={`${status.label} – otevřít provozní detail ${sourceName(source.source)}`}
            title="Otevřít provozní detail"
            className={`relative inline-flex h-8 w-[92px] items-center justify-center gap-1 rounded-xl border px-2 text-center text-[8px] font-bold leading-none tracking-[0.07em] transition hover:-translate-y-px ${status.badge}`}
          >
            <i aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} />
            <span className="translate-y-px">{status.label}</span>
            {needsAttention ? <span aria-hidden className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border-2 border-[var(--surface-strong)] bg-amber-400 text-[9px] font-black leading-none text-slate-950 shadow-sm">!</span> : null}
          </button>
        </div>
      </div>

      <button type="button" onClick={onOpen} className="mt-4 min-h-0 flex-1 text-left lg:mt-3">
        <div className="grid grid-cols-2 gap-2 lg:gap-1.5">
          <div className="weather-alerts__record-surface rounded-xl border p-2.5 lg:py-2"><span className="block text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]">Poslední kontrola</span><strong className="mt-1 block text-[10px] text-[var(--text-primary)]">{formatDateTime(source.lastAttemptAt)}</strong></div>
          <div className="weather-alerts__record-surface rounded-xl border p-2.5 lg:py-2"><span className="block text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]">Poslední úspěch</span><strong className="mt-1 block text-[10px] text-[var(--text-primary)]">{formatDateTime(source.lastSuccessAt)}</strong></div>
          <div className="weather-alerts__record-surface rounded-xl border p-2.5 lg:py-2"><span className="block text-[7px] font-bold uppercase leading-[9px] tracking-[0.045em] text-[var(--text-secondary)]">{recordsLabel}</span><strong className="mt-1 block text-sm tabular-nums text-[var(--text-primary)]">{source.processedRecordCount}</strong></div>
          <div className="weather-alerts__record-surface rounded-xl border p-2.5 lg:py-2"><span className="block text-[7px] font-bold uppercase leading-[9px] tracking-[0.045em] text-[var(--text-secondary)]">{changesLabel}</span><strong className="mt-1 block text-sm tabular-nums text-[var(--text-primary)]">{source.changeCount ?? '—'}</strong></div>
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-3 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2.5 lg:mt-2 lg:py-2">
          <span className="min-w-0"><small className="block text-[8px] font-bold uppercase tracking-[0.07em] text-[var(--text-secondary)]">{coverageLabel}</small><strong className="mt-0.5 block truncate text-[10px] text-[var(--text-primary)]">{source.municipalityCoverage}</strong></span>
          <ChevronRight aria-hidden size={15} className="shrink-0 text-[var(--text-secondary)]" />
        </div>
      </button>
    </section>
  )
}

function StoreCoveragePanel({ coverage, onOpenAnalysis, onOpenDetail }: { coverage: PowerOutageStoreCoverage; onOpenAnalysis: () => void; onOpenDetail: () => void }) {
  const percent = Math.min(100, Math.max(0, coverage.coveragePercent))

  return (
    <section className="activities-page__panel flex h-[360px] min-w-0 flex-col rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_16px_36px_rgba(15,23,42,0.1)] sm:p-5 lg:h-auto">
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/10 text-[var(--accent)]"><Route aria-hidden size={18} /></span>
          <span className="min-w-0 flex-1"><span className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Databáze prodejen</span><h2 className="truncate text-base font-semibold text-[var(--text-primary)]">Pokrytí adres</h2></span>
        </div>
        <button
          type="button"
          onClick={onOpenAnalysis}
          aria-label="Otevřít kontrolu adres prodejen"
          title="Otevřít kontrolu adres"
          className="inline-flex h-8 w-[76px] shrink-0 items-center justify-center gap-1 rounded-xl border border-sky-500/40 bg-sky-500/10 px-2 text-center text-[7px] font-bold leading-none tracking-[0.06em] text-sky-700 transition hover:-translate-y-px hover:bg-sky-500/15 sm:w-[108px] sm:text-[7.5px] [html[data-theme=dark]_&]:text-sky-300"
        >
          <MapPinCheck aria-hidden size={12} className="shrink-0" />
          <span className="sm:hidden">KONTROLA</span>
          <span className="hidden sm:inline">KONTROLA ADRES</span>
        </button>
      </div>

      <button type="button" onClick={onOpenDetail} aria-label="Otevřít detail pokrytí adres" className="mt-4 w-full rounded-2xl border border-sky-500/35 bg-sky-500/5 p-3.5 text-left transition hover:border-[var(--surface-border)] hover:bg-[var(--surface-muted)]">
        <div className="flex items-end justify-between gap-3">
          <span><small className="block text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Ověřeno pro porovnání</small><strong className="mt-1 block text-[11px] text-[var(--text-primary)]">{coverage.readyStoreCount} z {coverage.totalStoreCount} adres</strong></span>
          <span className="flex items-center gap-2"><strong className="text-3xl font-semibold leading-none tabular-nums text-[var(--accent)]">{percent.toLocaleString('cs-CZ')} %</strong><ChevronRight aria-hidden size={15} className="text-[var(--text-secondary)]" /></span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-border)]">
          <div className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500" style={{ width: `${percent}%` }} />
        </div>
      </button>

      <div className="mt-2.5 grid grid-cols-4 gap-1.5">
        <div className="min-w-0 rounded-xl border border-slate-400/30 bg-slate-400/8 px-2 py-2 text-center shadow-[inset_0_-2px_0_rgba(100,116,139,0.45)]"><span className="block min-h-5 text-[6px] font-bold uppercase leading-[10px] tracking-[0.035em] text-slate-600 sm:text-[6.5px] [html[data-theme=dark]_&]:text-slate-300">Ke kontrole</span><strong className="mt-0.5 block text-[14px] tabular-nums text-[var(--text-primary)]">{coverage.pendingStoreCount}</strong></div>
        <div className="min-w-0 rounded-xl border border-amber-400/35 bg-amber-400/8 px-2 py-2 text-center shadow-[inset_0_-2px_0_rgba(245,158,11,0.55)]"><span className="block min-h-5 text-[6px] font-bold uppercase leading-[10px] tracking-[0.035em] text-amber-700 sm:text-[6.5px] [html[data-theme=dark]_&]:text-amber-300">K opravě</span><strong className="mt-0.5 block text-[14px] tabular-nums text-[var(--text-primary)]">{coverage.reviewStoreCount}</strong></div>
        <div className="min-w-0 rounded-xl border border-orange-400/35 bg-orange-400/8 px-2 py-2 text-center shadow-[inset_0_-2px_0_rgba(249,115,22,0.55)]"><span className="block min-h-5 text-[6px] font-bold uppercase leading-[10px] tracking-[0.035em] text-orange-700 sm:text-[6.5px] [html[data-theme=dark]_&]:text-orange-300">Nedohledáno</span><strong className="mt-0.5 block text-[14px] tabular-nums text-[var(--text-primary)]">{coverage.notFoundStoreCount}</strong></div>
        <div className="min-w-0 rounded-xl border border-red-400/35 bg-red-400/8 px-2 py-2 text-center shadow-[inset_0_-2px_0_rgba(239,68,68,0.55)]"><span className="block min-h-5 text-[6px] font-bold uppercase leading-[10px] tracking-[0.035em] text-red-700 sm:text-[6.5px] [html[data-theme=dark]_&]:text-red-300">Chyba</span><strong className="mt-0.5 block text-[14px] tabular-nums text-[var(--text-primary)]">{coverage.errorStoreCount}</strong></div>
      </div>

      <div className="mt-2.5">
        <span className="mb-1 block text-[6px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Distribuční území</span>
        <div className="grid grid-cols-4 gap-1 text-center text-[7px] font-bold uppercase tracking-[0.02em]">
          <span className="rounded-xl border border-orange-500/35 bg-orange-500/8 px-1.5 py-2 text-[10px] text-orange-700 [html[data-theme=dark]_&]:text-orange-300">ČEZ <strong className="ml-1 text-[10px] text-[var(--text-primary)]">{coverage.cezStoreCount}</strong></span>
          <span className="rounded-xl border border-red-500/35 bg-red-500/8 px-1.5 py-2 text-[10px] text-red-700 [html[data-theme=dark]_&]:text-red-300">EG.D <strong className="ml-1 text-[10px] text-[var(--text-primary)]">{coverage.egdStoreCount}</strong></span>
          <span className="rounded-xl border border-violet-500/35 bg-violet-500/8 px-1 py-2 text-[10px] text-violet-700 [html[data-theme=dark]_&]:text-violet-300">PRE <strong className="ml-0.5 text-[10px] text-[var(--text-primary)]">{coverage.preStoreCount}</strong></span>
          <span className="rounded-xl border border-slate-400/30 bg-slate-400/8 px-1.5 py-2 text-[10px] text-slate-600 [html[data-theme=dark]_&]:text-slate-300">Bez <strong className="ml-1 text-[10px] text-[var(--text-primary)]">{coverage.unknownDistributorCount}</strong></span>
        </div>
      </div>

      <div className="mt-auto flex items-center gap-2 pt-3 text-left text-[8px] leading-4 text-[var(--text-secondary)]">
        <Info aria-hidden size={13} className="shrink-0" />
        <span>Revize katalogu {coverage.catalogRevision} · změněno {formatDateTime(coverage.catalogLastChangedAt)}</span>
      </div>
    </section>
  )
}

function catalogChangeLabel(kind: PowerOutageStoreCoverage['catalogLastChangeKind']) {
  return ({ initial: 'Inicializace katalogu', insert: 'Přidání prodejen', update: 'Úprava prodejen', delete: 'Odstranění prodejen' } as const)[kind]
}

function CoverageDetailPopup({ coverage, sources, onClose }: { coverage: PowerOutageStoreCoverage; sources: PowerOutageSourceSummary[]; onClose: () => void }) {
  const percent = Math.min(100, Math.max(0, coverage.coveragePercent))
  const sourceRows = (['cez', 'egd', 'pre'] as const).map((source) => ({
    source,
    summary: sources.find((item) => item.source === source) ?? null,
  }))

  return (
    <PowerOutagePopupShell titleId="power-outage-store-coverage-title" eyebrow="DATABÁZE PRODEJEN" title="Detail pokrytí adres" icon={<Route aria-hidden size={21} />} onClose={onClose}>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
        <section className="rounded-2xl border border-sky-500/25 bg-sky-500/8 p-4">
          <div className="flex items-end justify-between gap-3">
            <span><small className="block text-[8px] font-bold uppercase tracking-[0.1em] text-sky-700 [html[data-theme=dark]_&]:text-sky-300">Připraveno pro porovnání</small><strong className="mt-1 block text-base text-[var(--text-primary)]">{coverage.readyStoreCount} z {coverage.totalStoreCount} adres</strong></span>
            <strong className="text-3xl font-semibold tabular-nums text-[var(--accent)]">{percent.toLocaleString('cs-CZ')} %</strong>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-950/10 [html[data-theme=dark]_&]:bg-white/10"><div className="h-full rounded-full bg-sky-500" style={{ width: `${percent}%` }} /></div>
          <p className="mt-2 text-[9px] leading-4 text-[var(--text-secondary)]">Do porovnání vstupují prodejny s úspěšně nebo pravděpodobně ověřenou adresou, které nečekají na nové zpracování.</p>
        </section>

        <section className="mt-4">
          <h3 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Stavy ověřování adres</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {[
              ['Ke kontrole', coverage.pendingStoreCount, 'Nová nebo změněná adresa čeká ve frontě na automatickou kontrolu.', 'border-slate-400/30 bg-slate-400/8'],
              ['K opravě', coverage.reviewStoreCount, 'Výsledek není dostatečně jistý a vyžaduje lidské rozhodnutí.', 'border-amber-400/35 bg-amber-400/8'],
              ['Nedohledáno', coverage.notFoundStoreCount, 'Automatická kontrola nenašla odpovídající adresní bod.', 'border-orange-400/35 bg-orange-400/8'],
              ['Chyba', coverage.errorStoreCount, 'Kontrolu adresy přerušila technická chyba; záznam bude možné zpracovat znovu.', 'border-red-400/35 bg-red-400/8'],
            ].map(([label, value, description, className]) => <div key={String(label)} className={`rounded-2xl border p-3 ${className}`}><div className="flex items-baseline justify-between gap-3"><strong className="text-[10px] uppercase tracking-[0.06em] text-[var(--text-primary)]">{label}</strong><strong className="text-lg tabular-nums text-[var(--text-primary)]">{value}</strong></div><p className="mt-1 text-[8px] leading-4 text-[var(--text-secondary)]">{description}</p></div>)}
          </div>
        </section>

        <section className="mt-4">
          <h3 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Distribuční území</h3>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-2xl border border-orange-500/35 bg-orange-500/8 p-3 text-center"><small className="block text-[8px] font-bold text-orange-700 [html[data-theme=dark]_&]:text-orange-300">ČEZ</small><strong className="mt-1 block text-xl tabular-nums text-[var(--text-primary)]">{coverage.cezStoreCount}</strong></div>
            <div className="rounded-2xl border border-red-500/35 bg-red-500/8 p-3 text-center"><small className="block text-[8px] font-bold text-red-700 [html[data-theme=dark]_&]:text-red-300">EG.D</small><strong className="mt-1 block text-xl tabular-nums text-[var(--text-primary)]">{coverage.egdStoreCount}</strong></div>
            <div className="rounded-2xl border border-violet-500/35 bg-violet-500/8 p-3 text-center"><small className="block text-[8px] font-bold text-violet-700 [html[data-theme=dark]_&]:text-violet-300">PRE</small><strong className="mt-1 block text-xl tabular-nums text-[var(--text-primary)]">{coverage.preStoreCount}</strong></div>
            <div className="rounded-2xl border border-slate-400/30 bg-slate-400/8 p-3 text-center"><small className="block text-[8px] font-bold text-slate-600 [html[data-theme=dark]_&]:text-slate-300">BEZ</small><strong className="mt-1 block text-xl tabular-nums text-[var(--text-primary)]">{coverage.unknownDistributorCount}</strong></div>
          </div>
          <p className="mt-2 text-[9px] leading-4 text-[var(--text-secondary)]">Údaj vyjadřuje přiřazené distribuční území prodejny, nikoliv počet odstávek. „Bez“ znamená, že území zatím nebylo spolehlivě přiřazeno.</p>
        </section>

        <section className="mt-4">
          <h3 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Pokrytí podle řetězce</h3>
          <div className="mt-2 overflow-hidden rounded-2xl border border-[var(--surface-border)]">
            <div className="grid grid-cols-[1fr_repeat(3,minmax(44px,auto))] gap-2 bg-[var(--surface-muted)] px-3 py-2 text-[7px] font-bold uppercase text-[var(--text-secondary)]"><span>Řetězec</span><span className="text-right">Celkem</span><span className="text-right">Ověřeno</span><span className="text-right">Neurčeno</span></div>
            {coverage.chains.map((chain) => <div key={chain.chainName} className="grid grid-cols-[1fr_repeat(3,minmax(44px,auto))] gap-2 border-t border-[var(--surface-border)] px-3 py-2.5 text-[9px]"><strong className="truncate text-[var(--text-primary)]">{chain.chainName}</strong><span className="text-right tabular-nums text-[var(--text-secondary)]">{chain.totalStoreCount}</span><strong className="text-right tabular-nums text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300">{chain.readyStoreCount}</strong><span className="text-right tabular-nums text-[var(--text-secondary)]">{chain.unknownDistributorCount}</span></div>)}
          </div>
        </section>

        <section className="mt-4">
          <h3 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Zpracování aktuální revize</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {sourceRows.map(({ source, summary }) => {
              const processedRevision = summary?.storeRevisionProcessed ?? 0
              const current = processedRevision >= coverage.catalogRevision
              return <div key={source} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3"><div className="flex items-center justify-between gap-3"><strong className="text-xs text-[var(--text-primary)]">{sourceShortName(source)}</strong><span className={`rounded-lg border px-2 py-1 text-[7px] font-bold ${current ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300' : 'border-sky-500/35 bg-sky-500/10 text-sky-700 [html[data-theme=dark]_&]:text-sky-300'}`}>{current ? 'AKTUÁLNÍ' : 'ZPRACOVÁNÍ'}</span></div><p className="mt-2 text-[9px] text-[var(--text-secondary)]">Zpracovaná revize <strong className="text-[var(--text-primary)]">{processedRevision} / {coverage.catalogRevision}</strong></p></div>
            })}
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5">
          <h3 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Katalog prodejen</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-3"><PowerOutageDetailRow label="Aktuální revize" value={String(coverage.catalogRevision)} /><PowerOutageDetailRow label="Poslední změna" value={formatDateTime(coverage.catalogLastChangedAt)} /><PowerOutageDetailRow label="Druh změny" value={catalogChangeLabel(coverage.catalogLastChangeKind)} /></div>
          <p className="mt-2 text-[8px] leading-4 text-[var(--text-secondary)]">Revize je pořadové číslo verze katalogu. Zvýší se při importu, přidání, úpravě nebo odstranění prodejny; nevyjadřuje počet změněných prodejen.</p>
        </section>
      </div>
    </PowerOutagePopupShell>
  )
}

function runStatusLabel(status: PowerOutageSourceDiagnostic['runs'][number]['status']) {
  return ({ running: 'Probíhá', succeeded: 'Úspěch', no_change: 'Bez změny', failed: 'Chyba', skipped: 'Přeskočeno' })[status]
}

function taskStatusLabel(status: 'pending' | 'running' | 'succeeded' | 'failed') {
  return ({ pending: 'Čeká', running: 'Probíhá', succeeded: 'Dokončeno', failed: 'Selhalo' } as const)[status] ?? 'Neuvedeno'
}

function sourceStatusDescription(diagnostic: PowerOutageSourceDiagnostic) {
  if (diagnostic.status === 'error') return 'Zdroj opakovaně selhal nebo jsou jeho data příliš stará. Níže je uvedena poslední známá chyba a poslední úspěšné načtení.'
  if (diagnostic.status === 'warning') return 'Kontrola se neposouvá v očekávaném intervalu nebo poslední běh selhal. Dříve načtená data zůstávají dostupná.'
  if (diagnostic.status === 'processing') return diagnostic.progress?.phase === 'queued'
    ? 'Nová revize databáze prodejen čeká na nejbližší automatické zpracování.'
    : 'Systém právě zpracovává novou revizi databáze prodejen a průběžně ukládá dokončené výsledky.'
  if (diagnostic.status === 'live') return 'Zdroj se načítá správně a porovnání používá aktuální revizi databáze prodejen.'
  return 'Zdroj čeká na první úspěšné načtení dat.'
}

function SourceProgress({ diagnostic }: { diagnostic: PowerOutageSourceDiagnostic }) {
  const progress = diagnostic.progress
  if (!progress) return null
  const percent = progress.percent == null ? null : Math.round(progress.percent * 10) / 10

  return (
    <section className="mt-3 rounded-2xl border border-sky-500/30 bg-sky-500/8 p-3.5">
      <div className="flex items-end justify-between gap-3">
        <span>
          <small className="block text-[8px] font-bold uppercase tracking-[0.1em] text-sky-700 [html[data-theme=dark]_&]:text-sky-300">Zpracování revize {progress.storeRevision}</small>
          <strong className="mt-1 block text-sm text-[var(--text-primary)]">
            {progress.mode === 'determinate'
              ? `${progress.processedStoreCount ?? 0} z ${progress.totalStoreCount} prodejen`
              : progress.phase === 'queued'
                ? 'Zařazeno ke zpracování'
                : 'Načítání celé distribuční oblasti'}
          </strong>
        </span>
        {percent == null ? null : <strong className="text-xl font-semibold tabular-nums text-sky-600 [html[data-theme=dark]_&]:text-sky-300">{percent.toLocaleString('cs-CZ')} %</strong>}
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-950/10 [html[data-theme=dark]_&]:bg-white/10">
        {percent == null
          ? <div className="h-full w-2/5 animate-pulse rounded-full bg-sky-500 motion-reduce:animate-none" />
          : <div className="h-full rounded-full bg-sky-500 transition-[width] duration-700" style={{ width: `${percent}%` }} />}
      </div>
      <div className="mt-2 grid gap-x-4 gap-y-1 text-[9px] leading-4 text-[var(--text-secondary)] sm:grid-cols-2">
        <span>Poslední posun: <strong className="text-[var(--text-primary)]">{formatDateTime(progress.lastProgressAt)}</strong></span>
        {progress.completedBatchCount == null ? null : <span>Dokončené dávky: <strong className="text-[var(--text-primary)]">{progress.completedBatchCount}</strong></span>}
        <span className="sm:col-span-2">{progress.phase === 'queued' ? 'Spuštění proběhne automaticky podle plánovače.' : 'Údaj se automaticky obnovuje z naší databáze; nevytváří další dotazy na distributora.'}</span>
      </div>
    </section>
  )
}

function SourceDiagnosticPopup({ source, diagnostic, loading, error, onClose }: { source: PowerOutageSource; diagnostic: PowerOutageSourceDiagnostic | null; loading: boolean; error: string | null; onClose: () => void }) {
  const schedule = source === 'cez'
    ? 'Hlavní kontrola každých 6 hodin; rozpracované dávky pokračují každých 15 minut.'
    : source === 'egd'
      ? 'Kontrola celé distribuční oblasti každých 6 hodin s časovým posunem vůči ČEZ.'
      : 'Stažení oficiálního exportu celé distribuční oblasti každé 3 hodiny; jeden malý požadavek za běh.'
  const status = diagnostic ? STATUS_PRESENTATION[diagnostic.status] : STATUS_PRESENTATION.pending

  return (
    <PowerOutagePopupShell titleId={`power-outage-source-${source}`} eyebrow="ODSTÁVKY · PROVOZNÍ DETAIL" title={sourceName(source)} icon={<DatabaseZap aria-hidden size={21} />} onClose={onClose}>
      {loading ? <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center p-6 text-center"><span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--surface-border)] border-t-[var(--accent)]" /><strong className="mt-4 text-sm text-[var(--text-primary)]">Načítám provozní stav…</strong></div> : error || !diagnostic ? <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center p-6 text-center"><CircleAlert aria-hidden size={28} className="text-red-500" /><strong className="mt-3 text-sm text-[var(--text-primary)]">Provozní detail se nepodařilo načíst</strong><p className="mt-1 max-w-md text-xs leading-5 text-[var(--text-secondary)]">{error ?? 'Data nejsou dostupná.'}</p></div> : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5">
            <span><small className="block text-[8px] font-bold uppercase tracking-[0.09em] text-[var(--text-secondary)]">Aktuální stav zdroje</small><strong className="mt-1 block text-sm text-[var(--text-primary)]">{status.label}</strong><span className="mt-1 block max-w-lg text-[9px] leading-4 text-[var(--text-secondary)]">{sourceStatusDescription(diagnostic)}</span></span>
            <span className={`relative inline-flex h-8 w-[92px] items-center justify-center gap-1 rounded-xl border px-2 text-center text-[8px] font-bold leading-none tracking-[0.07em] ${status.badge}`}><i className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} /><span className="translate-y-px">{status.label}</span></span>
          </div>
          <SourceProgress diagnostic={diagnostic} />
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <PowerOutageDetailRow label="Poslední pokus" value={formatDateTime(diagnostic.sourceState.lastAttemptAt)} />
            <PowerOutageDetailRow label="Poslední úspěch" value={formatDateTime(diagnostic.sourceState.lastSuccessAt)} />
            <PowerOutageDetailRow label="Poslední změna" value={formatDateTime(diagnostic.sourceState.lastChangeAt)} />
            <PowerOutageDetailRow label="Aktivní odstávky" value={String(diagnostic.sourceState.activeOutageCount)} />
            <PowerOutageDetailRow label="Budoucí odstávky" value={String(diagnostic.sourceState.futureOutageCount)} />
            <PowerOutageDetailRow label="Verze dat" value={String(diagnostic.sourceState.dataVersion)} />
            <PowerOutageDetailRow label="Zpracovaná revize prodejen" value={`${diagnostic.sourceState.storeRevisionProcessed} / ${diagnostic.catalogRevision}`} />
            <PowerOutageDetailRow label="Stav plánované úlohy" value={diagnostic.task ? taskStatusLabel(diagnostic.task.lastStatus) : 'Neuvedeno'} />
            <PowerOutageDetailRow label="Selhání v řadě" value={String(Math.max(diagnostic.sourceState.consecutiveFailureCount, diagnostic.task?.consecutiveFailureCount ?? 0))} />
          </div>

          <section className="mt-5">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><Route aria-hidden size={14} /> Proces načítání</h3>
            <p className="mt-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5 text-xs leading-5 text-[var(--text-primary)]">{schedule}</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {['Stažení veřejných dat distributora', 'Normalizace a kontrola termínů', 'Uložení změn a historie verzí', 'Párování podle města, ulice a čísel domu; neúplné adresy k ověření'].map((step, index) => <div key={step} className="flex items-center gap-2.5 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2.5"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-[9px] font-bold text-[var(--accent)]">{index + 1}</span><span className="text-[10px] font-semibold text-[var(--text-primary)]">{step}</span></div>)}
            </div>
          </section>

          {(['warning', 'error'] as PowerOutageSourceStatus[]).includes(diagnostic.status) && (diagnostic.sourceState.lastErrorMessage || diagnostic.task?.lastErrorMessage) ? <section className="mt-5"><h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-red-600 [html[data-theme=dark]_&]:text-red-300"><CircleAlert aria-hidden size={14} /> Poslední chyba</h3><div className="mt-2 rounded-2xl border border-red-400/30 bg-red-500/8 p-3.5"><strong className="text-[10px] text-red-700 [html[data-theme=dark]_&]:text-red-300">{diagnostic.sourceState.lastErrorCode ?? diagnostic.task?.lastErrorCode ?? 'CHYBA ZDROJE'}</strong><p className="mt-1 text-xs leading-5 text-[var(--text-primary)]">{diagnostic.sourceState.lastErrorMessage ?? diagnostic.task?.lastErrorMessage}</p></div></section> : null}

          <section className="mt-5">
            <h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><History aria-hidden size={14} /> Poslední synchronizační běhy</h3>
            <div className="mt-2 space-y-2">
              {diagnostic.runs.map((run) => <div key={run.id} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3"><div className="flex items-start justify-between gap-3"><span><strong className="block text-[11px] text-[var(--text-primary)]">{runStatusLabel(run.status)} · {run.sourceRecordCount} záznamů ve dávce</strong><small className="mt-0.5 block text-[9px] leading-4 text-[var(--text-secondary)]">Revize {run.storeRevision} · uloženo {run.outageUpsertCount} odstávek a {run.addressUpsertCount} adres</small></span><time className="shrink-0 text-[9px] font-semibold tabular-nums text-[var(--text-secondary)]">{formatDateTime(run.startedAt)}</time></div>{run.errorMessage ? <p className="mt-2 text-[9px] leading-4 text-red-600 [html[data-theme=dark]_&]:text-red-300">{run.errorCode}: {run.errorMessage}</p> : null}</div>)}
              {diagnostic.runs.length === 0 ? <p className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--text-secondary)]">Historie běhů zatím není dostupná.</p> : null}
            </div>
          </section>

          <details className="mt-5 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5"><summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><TimerReset aria-hidden size={14} /> Technické podrobnosti</summary><div className="mt-3 grid gap-2 sm:grid-cols-2"><PowerOutageDetailRow label="Poslední start úlohy" value={formatDateTime(diagnostic.task?.lastStartedAt ?? null)} /><PowerOutageDetailRow label="Poslední dokončení" value={formatDateTime(diagnostic.task?.lastFinishedAt ?? null)} /><PowerOutageDetailRow label="Reference zdroje" value={diagnostic.sourceState.latestSourceRef ?? 'Neuvedeno'} mono /><PowerOutageDetailRow label="Hash posledních dat" value={diagnostic.sourceState.latestPayloadSha256 ?? 'Neuvedeno'} mono /></div></details>
        </div>
      )}
    </PowerOutagePopupShell>
  )
}

export function PowerOutageSidebar({ preferences, sources, storeCoverage }: { preferences: PowerOutageNotificationPreferences; sources: PowerOutageSourceSummary[]; storeCoverage: PowerOutageStoreCoverage }) {
  const [selectedSource, setSelectedSource] = useState<PowerOutageSource | null>(null)
  const [showAddressAnalysis, setShowAddressAnalysis] = useState(false)
  const [showCoverageDetail, setShowCoverageDetail] = useState(false)
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

  useEffect(() => {
    if (!selectedSource || diagnostic?.status !== 'processing') return

    let cancelled = false
    const refreshDiagnostic = async () => {
      const result = await getPowerOutageSourceDiagnosticAction(selectedSource)
      if (cancelled) return
      if (result.success) {
        setDiagnostic(result.diagnostic)
        setError(null)
      } else {
        setError(result.error)
      }
    }
    const intervalId = window.setInterval(() => void refreshDiagnostic(), 20_000)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [selectedSource, diagnostic?.status])

  return (
    <>
      <div className="-mt-2 min-w-0 lg:mt-0 xl:h-full">
        <p className="mb-2 text-[10px] text-[var(--text-secondary)] lg:hidden">
          Přejetím do strany zobrazíte další část.
        </p>
        <aside className="power-outages-mobile-aside-carousel activities-manual-carousel grid min-w-0 auto-cols-[100%] grid-flow-col items-stretch gap-3 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-[24px] lg:block lg:space-y-4 lg:overflow-visible lg:rounded-none" aria-label="Nastavení upozornění, stav zdrojů a pokrytí prodejen">
          <div className="min-w-0 snap-start snap-always lg:snap-none"><NotificationSettings key={preferences.updatedAt ?? 'default'} initial={preferences} /></div>
          {sources.map((source) => <div key={source.source} className="min-w-0 snap-start snap-always lg:snap-none"><SourcePanel source={source} onOpen={() => void openSource(source.source)} /></div>)}
          <div className="min-w-0 snap-start snap-always lg:snap-none"><StoreCoveragePanel coverage={storeCoverage} onOpenAnalysis={() => setShowAddressAnalysis(true)} onOpenDetail={() => setShowCoverageDetail(true)} /></div>
        </aside>
      </div>
      {selectedSource && typeof document !== 'undefined' ? createPortal(<SourceDiagnosticPopup source={selectedSource} diagnostic={diagnostic} loading={loading} error={error} onClose={close} />, document.body) : null}
      {showCoverageDetail && typeof document !== 'undefined' ? createPortal(<CoverageDetailPopup coverage={storeCoverage} sources={sources} onClose={() => setShowCoverageDetail(false)} />, document.body) : null}
      {showAddressAnalysis && typeof document !== 'undefined' ? createPortal(<StoreAddressAnalysisPopup onClose={() => setShowAddressAnalysis(false)} />, document.body) : null}
    </>
  )
}
