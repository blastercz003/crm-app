'use client'

import { CircleAlert, CircleCheck, DatabaseZap, History, Info, LoaderCircle, MapPinned, RefreshCw, Route, SearchCheck, TimerReset } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CompleteAddressCoverage, CompleteAddressCoverageDiagnostic, CompleteCezNewState, CompletePowerOutageSidebarWorkspace, CompleteProviderDiagnostic, CompleteProviderState, CompleteSourceDiagnostic, CompleteSourceState } from '@/lib/power-outages/complete-types'
import type { PowerOutageSource } from '@/lib/power-outages/types'
import { getCompletePowerOutageAddressCoverageDiagnosticAction, getCompletePowerOutageProviderDiagnosticAction, getCompletePowerOutageSourceDiagnosticAction } from './actions'
import { PowerOutageDetailRow, PowerOutagePopupShell } from './power-outage-popups'

const DATE_TIME = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

function formatDate(value: string | null) {
  if (!value) return 'Zatím neproběhlo'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Neuvedeno' : DATE_TIME.format(date)
}

function formatRelativeDate(value: string | null) {
  if (!value) return 'zatím bez posunu'
  const elapsed = Date.now() - new Date(value).getTime()
  if (!Number.isFinite(elapsed) || elapsed < 0) return formatDate(value)
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'právě teď'
  if (minutes < 60) return `před ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `před ${hours} h`
  return formatDate(value)
}

function sourceLabel(source: PowerOutageSource) {
  return source === 'cez' ? 'ČEZ' : source === 'egd' ? 'EG.D' : 'PRE'
}

function coverageLabel(status: CompletePowerOutageSidebarWorkspace['sources'][number]['coverageStatus']) {
  return ({ idle: 'ČEKÁ', processing: 'ZPRACOVÁNÍ', complete: 'AKTUÁLNÍ', partial: 'ČÁSTEČNĚ', error: 'CHYBA' } as const)[status]
}

function statusPresentation(status: CompleteSourceState['coverageStatus']) {
  if (status === 'complete') return { badge: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300', dot: 'bg-emerald-500' }
  if (status === 'error') return { badge: 'border-red-400/35 bg-red-400/10 text-red-700 [html[data-theme=dark]_&]:text-red-300', dot: 'bg-red-500', attention: true }
  if (status === 'processing') return { badge: 'border-sky-400/35 bg-sky-400/10 text-sky-700 [html[data-theme=dark]_&]:text-sky-300', dot: 'animate-pulse bg-sky-500 motion-reduce:animate-none' }
  if (status === 'partial') return { badge: 'border-amber-400/35 bg-amber-400/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300', dot: 'bg-amber-500', attention: true }
  return { badge: 'border-slate-400/35 bg-slate-400/10 text-slate-600 [html[data-theme=dark]_&]:text-slate-300', dot: 'bg-slate-400' }
}

function discoveryStatusLabel(status: CompleteSourceState['discovery']['status']) {
  return ({ waiting: 'ČEKÁ', processing: 'ZPRACOVÁNÍ', current: 'AKTUÁLNÍ', delayed: 'ZPOŽDĚNÍ', partial: 'ČÁSTEČNĚ', error: 'CHYBA' } as const)[status]
}

function discoveryStatusPresentation(status: CompleteSourceState['discovery']['status']) {
  if (status === 'current') return { badge: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300', dot: 'bg-emerald-500' }
  if (status === 'processing') return { badge: 'border-sky-400/35 bg-sky-400/10 text-sky-700 [html[data-theme=dark]_&]:text-sky-300', dot: 'animate-pulse bg-sky-500 motion-reduce:animate-none' }
  if (status === 'partial') return { badge: 'border-amber-400/35 bg-amber-400/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300', dot: 'bg-amber-500', attention: true }
  if (status === 'delayed') return { badge: 'border-amber-400/35 bg-amber-400/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300', dot: 'animate-pulse bg-amber-500 motion-reduce:animate-none', attention: true }
  if (status === 'error') return { badge: 'border-red-400/35 bg-red-400/10 text-red-700 [html[data-theme=dark]_&]:text-red-300', dot: 'bg-red-500', attention: true }
  return { badge: 'border-slate-400/35 bg-slate-400/10 text-slate-600 [html[data-theme=dark]_&]:text-slate-300', dot: 'bg-slate-400' }
}

function cezNewStatusLabel(status: CompleteCezNewState['status']) {
  return ({ waiting: 'ČEKÁ', processing: 'ZPRACOVÁNÍ', ready: 'PŘIPRAVENO', partial: 'ČÁSTEČNĚ', error: 'CHYBA' } as const)[status]
}

function cezNewStatusPresentation(status: CompleteCezNewState['status']) {
  if (status === 'ready') return { badge: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300', dot: 'bg-emerald-500' }
  if (status === 'processing') return { badge: 'border-sky-400/35 bg-sky-400/10 text-sky-700 [html[data-theme=dark]_&]:text-sky-300', dot: 'animate-pulse bg-sky-500 motion-reduce:animate-none' }
  if (status === 'partial') return { badge: 'border-amber-400/35 bg-amber-400/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300', dot: 'bg-amber-500', attention: true }
  if (status === 'error') return { badge: 'border-red-400/35 bg-red-400/10 text-red-700 [html[data-theme=dark]_&]:text-red-300', dot: 'bg-red-500', attention: true }
  return { badge: 'border-slate-400/35 bg-slate-400/10 text-slate-600 [html[data-theme=dark]_&]:text-slate-300', dot: 'bg-slate-400' }
}

function cezNewStageLabel(stage: CompleteCezNewState['stage']) {
  return ({ ruian: 'Katalog RÚIAN', mapping: 'Mapování území ČEZ', scan: 'Sběr odstávek', normalization: 'Ověření adres', projection: 'Stínová projekce', ready: 'Připraveno k přepnutí' } as const)[stage]
}

function runStatusLabel(status: CompleteSourceDiagnostic['runs'][number]['status']) {
  return ({ running: 'Probíhá', succeeded: 'Dokončeno', no_change: 'Beze změny', partial: 'Částečně', failed: 'Selhalo', skipped: 'Přeskočeno' } as const)[status]
}

function taskStatusLabel(status: CompleteSourceDiagnostic['task'] extends infer T ? T extends { status: infer S } ? S : never : never) {
  if (!status) return 'Čeká'
  return ({ pending: 'Čeká', running: 'Probíhá', succeeded: 'Dokončeno', failed: 'Selhalo', partial: 'Částečně' } as const)[status]
}

function providerTaskStatusLabel(status: 'idle' | 'running' | 'succeeded' | 'partial' | 'failed' | 'skipped' | null) {
  if (!status || status === 'idle') return 'Čeká'
  return ({ running: 'Probíhá', succeeded: 'Dokončeno', partial: 'Částečně', failed: 'Selhalo', skipped: 'Přeskočeno' } as const)[status]
}

function sourceStatusDescription(state: CompleteSourceState) {
  if (state.coverageStatus === 'complete') return 'Zdrojový katalog i jeho projekce do režimu KOMPLETNÍ jsou aktuální.'
  if (state.coverageStatus === 'processing') return 'Právě probíhá projekce zdrojových dat do režimu KOMPLETNÍ.'
  if (state.coverageStatus === 'partial') return state.coverageMessage ?? 'Zdroj poskytl jen část očekávaného celoplošného pokrytí.'
  if (state.coverageStatus === 'error') return state.lastErrorMessage ?? 'Poslední zpracování skončilo chybou.'
  return 'Zdroj čeká na první dokončené zpracování.'
}

function providerLabel(provider: CompleteProviderState['provider']) {
  return provider === 'mapy' ? 'Mapy.com' : provider === 'ares' ? 'ARES' : 'Google'
}

function providerStatusLabel(status: CompleteProviderState['status']) {
  return ({ inactive: 'NEAKTIVNÍ', waiting: 'ČEKÁ', processing: 'ZPRACOVÁNÍ', current: 'AKTUÁLNÍ', partial: 'ČÁSTEČNĚ', error: 'CHYBA', exhausted: 'VYČERPÁNO' } as const)[status]
}

function providerStatusPresentation(status: CompleteProviderState['status']) {
  if (status === 'current') return { badge: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300', dot: 'bg-emerald-500' }
  if (status === 'processing') return { badge: 'border-sky-400/35 bg-sky-400/10 text-sky-700 [html[data-theme=dark]_&]:text-sky-300', dot: 'animate-pulse bg-sky-500 motion-reduce:animate-none' }
  if (status === 'partial') return { badge: 'border-amber-400/35 bg-amber-400/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300', dot: 'bg-amber-500', attention: true }
  if (status === 'exhausted') return { badge: 'border-amber-400/35 bg-amber-400/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300', dot: 'bg-amber-500', attention: true }
  if (status === 'error') return { badge: 'border-red-400/35 bg-red-400/10 text-red-700 [html[data-theme=dark]_&]:text-red-300', dot: 'bg-red-500', attention: true }
  return { badge: 'border-slate-400/35 bg-slate-400/10 text-slate-600 [html[data-theme=dark]_&]:text-slate-300', dot: 'bg-slate-400' }
}

function addressCoverageStatusLabel(status: CompleteAddressCoverage['status']) {
  return ({ waiting: 'ČEKÁ', processing: 'ZPRACOVÁNÍ', current: 'AKTUÁLNÍ', partial: 'ČÁSTEČNĚ', error: 'CHYBA' } as const)[status]
}

function addressCoverageStatusPresentation(status: CompleteAddressCoverage['status']) {
  if (status === 'current') return { badge: 'border-emerald-400/35 bg-emerald-400/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300', dot: 'bg-emerald-500' }
  if (status === 'processing') return { badge: 'border-sky-400/35 bg-sky-400/10 text-sky-700 [html[data-theme=dark]_&]:text-sky-300', dot: 'animate-pulse bg-sky-500 motion-reduce:animate-none' }
  if (status === 'partial') return { badge: 'border-amber-400/35 bg-amber-400/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300', dot: 'bg-amber-500', attention: true }
  if (status === 'error') return { badge: 'border-red-400/35 bg-red-400/10 text-red-700 [html[data-theme=dark]_&]:text-red-300', dot: 'bg-red-500', attention: true }
  return { badge: 'border-slate-400/35 bg-slate-400/10 text-slate-600 [html[data-theme=dark]_&]:text-slate-300', dot: 'bg-slate-400' }
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return <section className="activities-page__panel flex h-[380px] min-w-0 flex-col rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_16px_36px_rgba(15,23,42,0.1)] sm:p-5 lg:h-auto lg:min-h-[210px] lg:p-4">{children}</section>
}

type RecoveryRequest =
  | { target: 'source_projection'; source: PowerOutageSource }
  | { target: 'address_normalization' }
  | { target: 'provider_discovery'; provider: CompleteProviderState['provider'] }
  | { target: 'company_reconciliation' }
  | { target: 'cez_new_pipeline'; stage: 'ruian' | 'mapping' | 'scan' | 'normalization' | 'projection' }

function RecoveryButton({ label, request, onRecovered }: {
  label: string
  request: RecoveryRequest
  onRecovered: () => void | Promise<void>
}) {
  const [state, setState] = useState<'idle' | 'running' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  const recover = async () => {
    if (state === 'running') return
    setState('running')
    setMessage(null)
    try {
      const response = await fetch('/api/power-outages/complete/recover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      const payload = await response.json() as { ok?: boolean; status?: string; message?: string; error?: string }
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? 'Obnova zpracování se nezdařila.')
      const successful = payload.status !== 'manual_required'
      setState(successful ? 'success' : 'error')
      setMessage(payload.message ?? (successful ? 'Zpracování bylo obnoveno.' : 'Je nutný ruční zásah.'))
      await onRecovered()
    } catch (recoveryError) {
      setState('error')
      setMessage(recoveryError instanceof Error ? recoveryError.message : 'Obnova zpracování se nezdařila.')
    }
  }

  return <div className="mt-3 flex flex-col items-start gap-2 sm:flex-row sm:items-center"><button type="button" onClick={() => void recover()} disabled={state === 'running'} className="inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-sky-400/35 bg-sky-500/10 px-4 text-[9px] font-bold uppercase tracking-[0.07em] text-sky-700 transition hover:-translate-y-px hover:border-sky-400/55 hover:bg-sky-500/15 disabled:cursor-wait disabled:opacity-60 [html[data-theme=dark]_&]:text-sky-300"><RefreshCw aria-hidden size={13} className={state === 'running' ? 'animate-spin' : ''} />{state === 'running' ? 'OPRAVUJI…' : state === 'success' ? 'OBNOVENO' : label}</button>{message ? <p role="status" className={`text-[9px] leading-4 ${state === 'error' ? 'text-red-600 [html[data-theme=dark]_&]:text-red-300' : 'text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300'}`}>{message}</p> : null}</div>
}

function recoveryNeedsManualRepair(errorCode: string | null | undefined, errorMessage: string | null | undefined) {
  const value = `${errorCode ?? ''} ${errorMessage ?? ''}`
  if (/cpo_runs_one_running_uidx/i.test(value)) return false
  return /(?:API_KEY|provider_not_configured|HTTP\s+(?:401|403)|schema cache|could not find (?:the )?(?:table|column|function)|does not exist|permission denied|unauthorized|violates (?:check|foreign key) constraint)/i.test(value)
}

function RecoveryControl({ isAdmin, blocked, label, request, onRecovered }: {
  isAdmin: boolean
  blocked: boolean
  label: string
  request: RecoveryRequest
  onRecovered: () => void | Promise<void>
}) {
  if (blocked) return <p className="mt-3 inline-flex rounded-xl border border-red-400/25 bg-red-500/8 px-3 py-2 text-[8px] font-bold uppercase tracking-[0.07em] text-red-700 [html[data-theme=dark]_&]:text-red-300">Vyžaduje ruční zásah</p>
  if (!isAdmin) return <p className="mt-2 text-[8px] font-semibold text-[var(--text-secondary)]">Opravu může spustit administrátor.</p>
  return <RecoveryButton label={label} request={request} onRecovered={onRecovered} />
}

function CompleteSourceDiagnosticPopup({ source, diagnostic, loading, error, isAdmin, onReload, onClose }: {
  source: PowerOutageSource
  diagnostic: CompleteSourceDiagnostic | null
  loading: boolean
  error: string | null
  isAdmin: boolean
  onReload: () => void | Promise<void>
  onClose: () => void
}) {
  const schedule = source === 'cez'
    ? 'Projekce současného katalogu ČEZ probíhá každých 15 minut. Celoplošný způsob získávání dat bude doplněn samostatně.'
    : source === 'egd'
      ? 'Celoplošný snapshot EG.D se promítá do režimu KOMPLETNÍ každých 6 hodin.'
      : 'Oficiální celoplošný export PRE se promítá do režimu KOMPLETNÍ každé 3 hodiny.'
  const sourcePresentation = diagnostic ? statusPresentation(diagnostic.state.coverageStatus) : statusPresentation('idle')
  const discoveryPresentation = diagnostic ? discoveryStatusPresentation(diagnostic.state.discovery.status) : discoveryStatusPresentation('waiting')
  const projectionProgress = diagnostic && diagnostic.state.coverageTotalCount > 0
    ? Math.min(100, Math.round((diagnostic.state.coverageProcessedCount / diagnostic.state.coverageTotalCount) * 1000) / 10)
    : null
  const evaluationFailure = diagnostic?.evaluationTask?.status === 'failed'
    && diagnostic.evaluationTask.pendingCandidateCount > 0
  const evaluationRecoveryBlocked = recoveryNeedsManualRepair(
    diagnostic?.evaluationTask?.lastErrorCode,
    diagnostic?.evaluationTask?.lastErrorMessage,
  )
  const sourceRecoveryBlocked = recoveryNeedsManualRepair(
    null,
    diagnostic?.task?.lastErrorMessage ?? diagnostic?.state.lastErrorMessage,
  )

  return (
    <PowerOutagePopupShell titleId={`complete-power-outage-source-${source}`} eyebrow="KOMPLETNÍ SBĚR · PROVOZNÍ DETAIL" title={sourceLabel(source)} icon={<DatabaseZap aria-hidden size={21} />} onClose={onClose}>
      {loading ? <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center p-6 text-center"><span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--surface-border)] border-t-[var(--accent)]" /><strong className="mt-4 text-sm text-[var(--text-primary)]">Načítám provozní stav…</strong></div> : error || !diagnostic ? <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center p-6 text-center"><CircleAlert aria-hidden size={28} className="text-red-500" /><strong className="mt-3 text-sm text-[var(--text-primary)]">Provozní detail se nepodařilo načíst</strong><p className="mt-1 max-w-md text-xs leading-5 text-[var(--text-secondary)]">{error ?? 'Data nejsou dostupná.'}</p></div> : (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
          <section className="rounded-2xl border border-sky-400/25 bg-sky-500/8 p-3.5">
            <div className="flex items-center justify-between gap-3">
              <span><small className="block text-[8px] font-bold uppercase tracking-[0.09em] text-[var(--text-secondary)]">Vyhledávání firem · horizont 30 dnů</small><strong className="mt-1 block text-sm text-[var(--text-primary)]">{diagnostic.state.discovery.completedTargetCount} / {diagnostic.state.discovery.totalTargetCount} cílů prověřeno</strong><span className="mt-1 block max-w-lg text-[9px] leading-4 text-[var(--text-secondary)]">{diagnostic.state.discovery.statusMessage}</span></span>
              <span className={`relative inline-flex h-8 w-[100px] shrink-0 items-center justify-center gap-1 rounded-xl border px-2 text-center text-[8px] font-bold leading-none tracking-[0.06em] ${discoveryPresentation.badge}`}><i className={`h-1.5 w-1.5 shrink-0 rounded-full ${discoveryPresentation.dot}`} /><span className="translate-y-px">{discoveryStatusLabel(diagnostic.state.discovery.status)}</span></span>
            </div>
            <div className="mt-3 flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-sky-950/10 [html[data-theme=dark]_&]:bg-white/10"><div className="h-full rounded-full bg-sky-500 transition-[width] duration-700" style={{ width: `${Math.min(100, diagnostic.state.discovery.progressPercent)}%` }} /></div><strong className="w-10 text-right text-[10px] tabular-nums text-[var(--accent)]">{diagnostic.state.discovery.progressPercent.toLocaleString('cs-CZ')} %</strong></div>
            <p className="mt-2 text-[9px] text-[var(--text-secondary)]">Zbývá {diagnostic.state.discovery.remainingTargetCount} · přesná čísla {diagnostic.state.discovery.exactTargetCount} · ulice {diagnostic.state.discovery.streetTargetCount} · poslední posun {formatRelativeDate(diagnostic.state.discovery.lastProgressAt)}</p>
          </section>

          {evaluationFailure ? <section className="mt-3 rounded-2xl border border-red-400/35 bg-red-500/8 p-3.5">
            <div className="flex items-start gap-2.5"><CircleAlert aria-hidden size={17} className="mt-0.5 shrink-0 text-red-500" /><span><small className="block text-[8px] font-bold uppercase tracking-[0.1em] text-red-700 [html[data-theme=dark]_&]:text-red-300">Navazující vyhodnocení je zablokované</small><strong className="mt-1 block text-sm text-[var(--text-primary)]">{diagnostic.evaluationTask?.pendingCandidateCount.toLocaleString('cs-CZ')} kandidátů {sourceLabel(source)} čeká na vyhodnocení</strong><p className="mt-1 text-[9px] leading-4 text-[var(--text-secondary)]">Zdrojová data distributora mohou být v pořádku, ale nalezené firmy se do výsledné tabulky nepřenesou, dokud se tato úloha nezotaví.</p></span></div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><PowerOutageDetailRow label="Stav úlohy" value={taskStatusLabel(diagnostic.evaluationTask?.status ?? null)} /><PowerOutageDetailRow label="Poslední úspěch" value={formatDate(diagnostic.evaluationTask?.lastSuccessAt ?? null)} /><PowerOutageDetailRow label="Poslední pokus" value={formatDate(diagnostic.evaluationTask?.lastStartedAt ?? null)} /><PowerOutageDetailRow label="Selhání v řadě" value={String(diagnostic.evaluationTask?.consecutiveFailureCount ?? 0)} /></div>
            <p className="mt-2 rounded-xl border border-red-400/20 bg-red-500/5 px-3 py-2 text-[9px] leading-4 text-[var(--text-primary)]">{diagnostic.evaluationTask?.lastErrorCode ? `${diagnostic.evaluationTask.lastErrorCode}: ` : ''}{diagnostic.evaluationTask?.lastErrorMessage ?? 'Vyhodnocovací úloha skončila chybou.'}</p>
            <p className="mt-2 text-[8px] leading-4 text-[var(--text-secondary)]">Aplikace osiřelý běh starší 30 minut při dalším pokusu automaticky ukončí a frontu znovu spustí.</p>
            <RecoveryControl isAdmin={isAdmin} blocked={evaluationRecoveryBlocked} label="Obnovit vyhodnocení" request={{ target: 'company_reconciliation' }} onRecovered={onReload} />
          </section> : null}

          <section className="mt-3"><h3 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Zpracování podle poskytovatele</h3><div className="mt-2 grid gap-2 sm:grid-cols-3">{diagnostic.providers.map((provider) => <div key={provider.provider} className={`rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3 ${provider.configured ? '' : 'opacity-60'}`}><div className="flex items-center justify-between"><strong className="text-xs text-[var(--text-primary)]">{providerLabel(provider.provider)}</strong><strong className="text-sm tabular-nums text-[var(--accent)]">{provider.progressPercent.toLocaleString('cs-CZ')} %</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-strong)]"><span className="block h-full rounded-full bg-sky-500" style={{ width: `${Math.min(100, provider.progressPercent)}%` }} /></div><div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[8px] text-[var(--text-secondary)]"><span>Hotovo <strong className="text-[var(--text-primary)]">{provider.completedTargetCount}/{provider.totalTargetCount}</strong></span><span>Čeká <strong className="text-[var(--text-primary)]">{Math.max(0, provider.totalTargetCount - provider.completedTargetCount)}</strong></span><span>Nalezeno <strong className="text-[var(--text-primary)]">{provider.foundTargetCount}</strong></span><span>Chyby <strong className="text-[var(--text-primary)]">{provider.errorTargetCount}</strong></span></div><p className="mt-1.5 truncate text-[7px] text-[var(--text-secondary)]">Posun {formatRelativeDate(provider.lastProgressAt)}</p></div>)}</div></section>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5">
            <span><small className="block text-[8px] font-bold uppercase tracking-[0.09em] text-[var(--text-secondary)]">Zdrojová data distributora</small><strong className="mt-1 block text-sm text-[var(--text-primary)]">{coverageLabel(diagnostic.state.coverageStatus)}</strong><span className="mt-1 block max-w-lg text-[9px] leading-4 text-[var(--text-secondary)]">{sourceStatusDescription(diagnostic.state)}</span></span>
            <span className={`relative inline-flex h-8 w-[92px] shrink-0 items-center justify-center gap-1 rounded-xl border px-2 text-center text-[8px] font-bold leading-none tracking-[0.07em] ${sourcePresentation.badge}`}><i className={`h-1.5 w-1.5 shrink-0 rounded-full ${sourcePresentation.dot}`} /><span className="translate-y-px">{coverageLabel(diagnostic.state.coverageStatus)}</span></span>
          </div>

          {diagnostic.state.coverageStatus === 'processing' ? <section className="mt-3 rounded-2xl border border-sky-400/25 bg-sky-500/8 p-3.5"><div className="flex items-end justify-between gap-3"><span><small className="block text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Živý průběh projekce</small><strong className="mt-1 block text-[10px] text-[var(--text-primary)]">{diagnostic.state.coverageProcessedCount} / {diagnostic.state.coverageTotalCount} záznamů</strong></span><strong className="text-xl tabular-nums text-sky-600 [html[data-theme=dark]_&]:text-sky-300">{projectionProgress == null ? '…' : `${projectionProgress.toLocaleString('cs-CZ')} %`}</strong></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-950/10 [html[data-theme=dark]_&]:bg-white/10"><div className="h-full rounded-full bg-sky-500 transition-[width] duration-700" style={{ width: `${projectionProgress ?? 40}%` }} /></div><p className="mt-2 text-[9px] leading-4 text-[var(--text-secondary)]">Stav se obnovuje z databáze každých 20 sekund a nevytváří další dotaz na distributora.</p></section> : null}

          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <PowerOutageDetailRow label="Uložené odstávky" value={String(diagnostic.state.publishedOutageCount)} />
            <PowerOutageDetailRow label="Uložené adresy" value={String(diagnostic.state.publishedAddressCount)} />
            <PowerOutageDetailRow label="Aktivní odstávky" value={String(diagnostic.state.activeOutageCount)} />
            <PowerOutageDetailRow label="Budoucí odstávky" value={String(diagnostic.state.futureOutageCount)} />
            <PowerOutageDetailRow label="Poslední pokus" value={formatDate(diagnostic.state.lastAttemptAt)} />
            <PowerOutageDetailRow label="Poslední úspěch" value={formatDate(diagnostic.state.lastSuccessAt)} />
            <PowerOutageDetailRow label="Poslední úplná data" value={formatDate(diagnostic.state.lastCompleteAt)} />
            <PowerOutageDetailRow label="Poslední změna" value={formatDate(diagnostic.state.lastChangeAt)} />
            <PowerOutageDetailRow label="Data od" value={formatDate(diagnostic.state.horizonFrom)} />
            <PowerOutageDetailRow label="Data do" value={formatDate(diagnostic.state.horizonTo)} />
            <PowerOutageDetailRow label="Stav úlohy" value={taskStatusLabel(diagnostic.task?.status ?? null)} />
            <PowerOutageDetailRow label="Selhání v řadě" value={String(diagnostic.task?.consecutiveFailureCount ?? 0)} />
          </div>

          <section className="mt-5"><h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><Route aria-hidden size={14} /> Tok dat</h3><p className="mt-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5 text-xs leading-5 text-[var(--text-primary)]">{schedule}</p><div className="mt-2 grid gap-2 sm:grid-cols-3">{['Zdrojová data distributora', 'Projekce do odděleného katalogu KOMPLETNÍ', 'Normalizace adres a hledání firem'].map((step, index) => <div key={step} className="flex items-center gap-2.5 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2.5"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-[9px] font-bold text-[var(--accent)]">{index + 1}</span><span className="text-[10px] font-semibold text-[var(--text-primary)]">{step}</span></div>)}</div></section>

          {(diagnostic.state.coverageStatus === 'partial' || diagnostic.state.coverageStatus === 'error') ? <section className="mt-5"><h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-amber-700 [html[data-theme=dark]_&]:text-amber-300"><CircleAlert aria-hidden size={14} /> Co vyžaduje pozornost</h3><p className="mt-2 rounded-2xl border border-amber-400/30 bg-amber-500/8 p-3.5 text-xs leading-5 text-[var(--text-primary)]">{diagnostic.state.lastErrorMessage ?? diagnostic.task?.lastErrorMessage ?? diagnostic.state.coverageMessage ?? 'Zdroj neposkytl kompletní očekávané pokrytí.'}</p>{diagnostic.state.coverageStatus === 'error' && diagnostic.task?.status === 'failed' ? <RecoveryControl isAdmin={isAdmin} blocked={sourceRecoveryBlocked} label="Obnovit projekci" request={{ target: 'source_projection', source }} onRecovered={onReload} /> : null}</section> : null}

          <section className="mt-5"><h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><History aria-hidden size={14} /> Poslední projekce</h3><div className="mt-2 space-y-2">{diagnostic.runs.map((run) => <div key={run.id} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3"><div className="flex items-start justify-between gap-3"><span><strong className="block text-[11px] text-[var(--text-primary)]">{runStatusLabel(run.status)} · {run.sourceRecordCount} záznamů</strong><small className="mt-0.5 block text-[9px] leading-4 text-[var(--text-secondary)]">Změněno {run.outageUpsertCount} odstávek a {run.addressUpsertCount} adres · odstraněno {run.removedAddressCount}</small></span><time className="shrink-0 text-[9px] font-semibold tabular-nums text-[var(--text-secondary)]">{formatDate(run.startedAt)}</time></div>{run.errorMessage ? <p className="mt-2 text-[9px] leading-4 text-red-600 [html[data-theme=dark]_&]:text-red-300">{run.errorCode}: {run.errorMessage}</p> : null}</div>)}{diagnostic.runs.length === 0 ? <p className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--text-secondary)]">Historie projekcí zatím není dostupná.</p> : null}</div></section>

          <details className="mt-5 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5"><summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><TimerReset aria-hidden size={14} /> Technické podrobnosti</summary><div className="mt-3 grid gap-2 sm:grid-cols-2"><PowerOutageDetailRow label="Rozsah dotazu" value={diagnostic.state.queryScope ?? 'Neuvedeno'} /><PowerOutageDetailRow label="Verze dat" value={String(diagnostic.state.dataVersion)} /><PowerOutageDetailRow label="Reference zdroje" value={diagnostic.state.latestSourceRef ?? 'Neuvedeno'} mono /><PowerOutageDetailRow label="Hash posledních dat" value={diagnostic.state.latestPayloadSha256 ?? 'Neuvedeno'} mono /></div></details>
        </div>
      )}
    </PowerOutagePopupShell>
  )
}

function CompleteCezNewDiagnosticPopup({ state, isAdmin, onClose }: { state: CompleteCezNewState; isAdmin: boolean; onClose: () => void }) {
  const presentation = cezNewStatusPresentation(state.status)
  const phases = [
    { label: 'Katalog RÚIAN', done: state.representativeDone, total: state.catalogTotal, error: state.representativeError, detail: `${state.representativeRemaining.toLocaleString('cs-CZ')} obcí zbývá` },
    { label: 'Mapování ČEZ', done: state.mappingDone, total: state.catalogTotal, error: state.mappingError, detail: `${state.cezMapped.toLocaleString('cs-CZ')} obcí v území ČEZ` },
    { label: 'Celoplošný sken', done: state.scanProcessed, total: state.scanTotal, error: state.scanError, detail: `${state.scanOutageCount.toLocaleString('cs-CZ')} odstávek · ${state.scanAddressCount.toLocaleString('cs-CZ')} adres` },
    { label: 'Ověření adres', done: state.normalizationDone, total: state.normalizationTotal, error: state.normalizationError, detail: `${state.normalizationRemaining.toLocaleString('cs-CZ')} adres zbývá` },
  ]
  return <PowerOutagePopupShell titleId="complete-cez-new-status" eyebrow="KOMPLETNÍ SBĚR · NOVÝ CELOPLOŠNÝ ZDROJ" title={state.activeSource === 'shadow' ? 'ČEZ' : 'ČEZ – NEW'} icon={<DatabaseZap aria-hidden size={21} />} onClose={onClose}>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
      <section className="rounded-2xl border border-sky-400/25 bg-sky-500/8 p-4">
        <div className="flex items-start justify-between gap-3"><span><small className="block text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Právě probíhá</small><strong className="mt-1 block text-base text-[var(--text-primary)]">{cezNewStageLabel(state.stage)}</strong><p className="mt-1 max-w-lg text-[9px] leading-4 text-[var(--text-secondary)]">{state.statusMessage}</p></span><span className={`relative inline-flex h-8 w-[108px] shrink-0 items-center justify-center gap-1.5 rounded-xl border px-2 text-[8px] font-bold uppercase leading-none tracking-[0.06em] ${presentation.badge}`}><i className={`h-1.5 w-1.5 shrink-0 rounded-full ${presentation.dot}`} />{cezNewStatusLabel(state.status)}{presentation.attention ? <i className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-[9px] font-black not-italic text-amber-950">!</i> : null}</span></div>
        <div className="mt-4 flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-sky-950/10 [html[data-theme=dark]_&]:bg-white/10"><div className="h-full rounded-full bg-sky-500 transition-[width] duration-700" style={{ width: `${Math.min(100, state.progressPercent)}%` }} /></div><strong className="w-12 text-right text-[10px] tabular-nums text-[var(--accent)]">{state.progressPercent.toLocaleString('cs-CZ')} %</strong></div>
        <p className="mt-2 text-[9px] text-[var(--text-secondary)]">{state.progressDone.toLocaleString('cs-CZ')} z {state.progressTotal.toLocaleString('cs-CZ')} položek aktuální fáze</p>
      </section>

      <section className="mt-4"><h3 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Průběh jednotlivých fází</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{phases.map((phase) => { const percent = phase.total > 0 ? Math.min(100, Math.round((phase.done / phase.total) * 1000) / 10) : 0; return <div key={phase.label} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3"><div className="flex items-center justify-between gap-2"><strong className="text-[10px] text-[var(--text-primary)]">{phase.label}</strong><strong className="text-xs tabular-nums text-[var(--accent)]">{percent.toLocaleString('cs-CZ')} %</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-strong)]"><span className="block h-full rounded-full bg-sky-500" style={{ width: `${percent}%` }} /></div><p className="mt-2 text-[8px] text-[var(--text-secondary)]">{phase.done.toLocaleString('cs-CZ')} / {phase.total.toLocaleString('cs-CZ')} · {phase.detail}</p>{phase.error > 0 ? <p className="mt-1 text-[8px] font-semibold text-red-600 [html[data-theme=dark]_&]:text-red-300">{phase.error.toLocaleString('cs-CZ')} položek vyžaduje kontrolu</p> : null}</div> })}</div></section>

      <section className="mt-4"><h3 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Stínová projekce</h3><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><PowerOutageDetailRow label="Odstávky" value={state.projectedOutageCount.toLocaleString('cs-CZ')} /><PowerOutageDetailRow label="Aktuální odstávky" value={state.projectedCurrentOutageCount.toLocaleString('cs-CZ')} /><PowerOutageDetailRow label="Adresy" value={state.projectedAddressCount.toLocaleString('cs-CZ')} /><PowerOutageDetailRow label="Čeká na normalizaci" value={state.projectionPendingCount.toLocaleString('cs-CZ')} /></div><p className="mt-2 text-[9px] leading-4 text-[var(--text-secondary)]">Poslední projekce {formatDate(state.lastProjectionAt)} · poslední bezpečné cykly {state.safeRecentCycleCount} / 2 · projekce odpovídá poslednímu cyklu: {state.latestProjectionMatches ? 'ano' : 'ne'}.</p></section>

      <section className="mt-4 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5"><div className="flex items-start gap-2.5">{state.activeSource === 'shadow' ? <CircleCheck aria-hidden size={17} className="mt-0.5 shrink-0 text-emerald-500" /> : <Info aria-hidden size={17} className="mt-0.5 shrink-0 text-sky-500" />}<span><small className="block text-[8px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Aktivní zdroj pro uživatele</small><strong className="mt-1 block text-sm text-[var(--text-primary)]">{state.activeSource === 'shadow' ? 'Nový celoplošný ČEZ' : 'Původní ČEZ katalog'}</strong><p className="mt-1 text-[9px] leading-4 text-[var(--text-secondary)]">{state.activeSource === 'shadow' ? 'Tab KOMPLETNÍ používá nový celoplošný zdroj. Návrat na původní zdroj zůstává možný.' : 'Nový sběr zatím běží odděleně ve stínovém režimu a nemění data zobrazená uživatelům.'}</p></span></div></section>

      {state.lastErrorMessage || state.errorStage ? <section className="mt-4"><h3 className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-red-700 [html[data-theme=dark]_&]:text-red-300"><CircleAlert aria-hidden size={14} /> Co vyžaduje pozornost</h3><p className="mt-2 rounded-2xl border border-red-400/30 bg-red-500/8 p-3.5 text-xs leading-5 text-[var(--text-primary)]">{state.errorCode ? `${state.errorCode}: ` : ''}{state.lastErrorMessage ?? 'Tato fáze obsahuje položky, které vyžadují kontrolu.'}</p>{state.errorStage ? <RecoveryControl isAdmin={isAdmin} blocked={false} label={`Obnovit · ${cezNewStageLabel(state.errorStage)}`} request={{ target: 'cez_new_pipeline', stage: state.errorStage }} onRecovered={() => undefined} /> : null}</section> : null}
    </div>
  </PowerOutagePopupShell>
}

function SourcesPanel({ workspace }: { workspace: CompletePowerOutageSidebarWorkspace }) {
  const [selectedSource, setSelectedSource] = useState<PowerOutageSource | null>(null)
  const [showCezNew, setShowCezNew] = useState(false)
  const [diagnostic, setDiagnostic] = useState<CompleteSourceDiagnostic | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDiagnostic = async (source: PowerOutageSource, showLoading = true) => {
    if (showLoading) setLoading(true)
    setError(null)
    const result = await getCompletePowerOutageSourceDiagnosticAction(source)
    if (result.success) setDiagnostic(result.diagnostic)
    else setError(result.error)
    setLoading(false)
  }

  const openSource = (source: PowerOutageSource) => {
    setSelectedSource(source)
    setDiagnostic(null)
    void loadDiagnostic(source)
  }
  const discoveryPollingStatus = diagnostic?.state.discovery.status

  useEffect(() => {
    if (!selectedSource || !discoveryPollingStatus || !['waiting', 'processing', 'delayed', 'error'].includes(discoveryPollingStatus)) return
    const interval = window.setInterval(() => { void loadDiagnostic(selectedSource, false) }, 20_000)
    return () => window.clearInterval(interval)
  }, [selectedSource, discoveryPollingStatus])

  const cezNew = workspace.cezNew
  const shadowActive = cezNew?.activeSource === 'shadow'
  const visibleSources = shadowActive ? workspace.sources.filter((source) => source.source !== 'cez') : workspace.sources
  const compact = Boolean(cezNew && !shadowActive)
  const sourceCards: Array<{ kind: 'legacy'; source: CompleteSourceState } | { kind: 'cez-new'; state: CompleteCezNewState }> = []
  for (const source of visibleSources) {
    sourceCards.push({ kind: 'legacy', source })
    if (source.source === 'cez' && cezNew && !shadowActive) sourceCards.push({ kind: 'cez-new', state: cezNew })
  }
  if (cezNew && (shadowActive || !visibleSources.some((source) => source.source === 'cez'))) sourceCards.unshift({ kind: 'cez-new', state: cezNew })

  return <PanelShell>
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-[var(--accent)]"><DatabaseZap aria-hidden size={18} /></span>
      <span><small className="block text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Kompletní sběr</small><h3 className="text-base font-semibold text-[var(--text-primary)]">Stav distributorů</h3></span>
    </div>
    <div className="mt-3 flex min-h-0 flex-1 flex-col justify-between lg:mt-4 lg:block lg:space-y-2">
      {sourceCards.map((card) => {
        if (card.kind === 'cez-new') {
          const state = card.state
          const presentation = cezNewStatusPresentation(state.status)
          const remaining = Math.max(0, state.progressTotal - state.progressDone)
          return <div key="cez-new" className={`weather-alerts__record-surface rounded-xl border px-2.5 py-1 lg:px-3 lg:py-2 ${compact ? 'h-[62px] lg:h-[78px]' : 'h-[70px] lg:h-[94px]'}`}>
            <div className="flex items-center justify-between gap-2"><strong className="text-[13px] text-[var(--text-primary)]">{shadowActive ? 'ČEZ' : 'ČEZ – NEW'}</strong><button type="button" onClick={() => setShowCezNew(true)} className={`relative inline-flex h-6 w-[98px] items-center justify-center gap-1 rounded-lg border px-1.5 text-center text-[7px] font-bold uppercase leading-none tracking-[0.055em] transition hover:-translate-y-px lg:h-8 lg:w-[104px] lg:gap-1.5 lg:rounded-xl lg:px-2 lg:text-[8px] lg:tracking-[0.065em] ${presentation.badge}`} title={state.statusMessage} aria-label={`${shadowActive ? 'ČEZ' : 'ČEZ – NEW'}: ${cezNewStatusLabel(state.status)}. ${state.statusMessage} Zobrazit detail.`}><i className={`h-1.5 w-1.5 shrink-0 rounded-full ${presentation.dot}`} /><span>{cezNewStatusLabel(state.status)}</span>{presentation.attention ? <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-[8px] font-black leading-none text-amber-950 shadow-sm lg:-right-1.5 lg:-top-1.5 lg:h-4 lg:w-4 lg:text-[9px]">!</span> : null}</button></div>
            <div className={`${compact ? 'mt-0' : 'mt-0.5'} grid grid-cols-2 gap-1.5 lg:mt-1 lg:gap-2`}><span className="weather-alerts__record-surface flex h-5 items-center justify-between rounded-lg border px-2 lg:h-6 lg:px-2.5"><small className="text-[6px] font-bold uppercase leading-[8px] tracking-[0.035em] text-[var(--text-secondary)]">Hotovo</small><strong className="text-[10px] tabular-nums text-[var(--text-primary)]">{state.progressDone}/{state.progressTotal}</strong></span><span className="weather-alerts__record-surface flex h-5 items-center justify-between rounded-lg border px-2 lg:h-6 lg:px-2.5"><small className="text-[6px] font-bold uppercase leading-[8px] tracking-[0.035em] text-[var(--text-secondary)]">Zbývá</small><strong className="text-[10px] tabular-nums text-[var(--text-primary)]">{remaining}</strong></span></div>
            <div className={`${compact ? 'mt-0.5 lg:mt-1' : 'mt-1 lg:mt-1.5'} flex items-center gap-1.5 lg:gap-2`}><span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-border)]"><i className="block h-full rounded-full bg-sky-500 transition-[width] duration-700" style={{ width: `${Math.min(100, state.progressPercent)}%` }} /></span><strong className="w-8 text-right text-[7px] tabular-nums text-[var(--accent)]">{state.progressPercent.toLocaleString('cs-CZ')}%</strong><small className="w-[72px] truncate text-right text-[6px] text-[var(--text-secondary)]">{cezNewStageLabel(state.stage)}</small></div>
          </div>
        }
        const source = card.source
        const discovery = source.discovery
        const presentation = discoveryStatusPresentation(discovery.status)
        return <div key={source.source} className={`weather-alerts__record-surface rounded-xl border px-2.5 py-1 lg:px-3 lg:py-2 ${compact ? 'h-[62px] lg:h-[78px]' : 'h-[70px] lg:h-[94px]'}`}>
        <div className="flex items-center justify-between gap-2">
          <strong className="text-[13px] text-[var(--text-primary)]">{sourceLabel(source.source)}</strong>
          <button type="button" onClick={() => openSource(source.source)} className={`relative inline-flex h-6 w-[98px] items-center justify-center gap-1 rounded-lg border px-1.5 text-center text-[7px] font-bold uppercase leading-none tracking-[0.055em] transition hover:-translate-y-px lg:h-8 lg:w-[104px] lg:gap-1.5 lg:rounded-xl lg:px-2 lg:text-[8px] lg:tracking-[0.065em] ${presentation.badge}`} title={discovery.statusMessage} aria-label={`${sourceLabel(source.source)}: ${discoveryStatusLabel(discovery.status)}. ${discovery.statusMessage} Zobrazit provozní detail.`}><i className={`h-1.5 w-1.5 shrink-0 rounded-full ${presentation.dot}`} /><span className="translate-y-px">{discoveryStatusLabel(discovery.status)}</span>{presentation.attention || discovery.errorTargetCount > 0 ? <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-[8px] font-black leading-none text-amber-950 shadow-sm lg:-right-1.5 lg:-top-1.5 lg:h-4 lg:w-4 lg:text-[9px]">!</span> : null}</button>
        </div>
        <div className={`${compact ? 'mt-0' : 'mt-0.5'} grid grid-cols-2 gap-1.5 lg:mt-1 lg:gap-2`}>
          <span className="weather-alerts__record-surface flex h-5 items-center justify-between rounded-lg border px-2 lg:h-6 lg:px-2.5"><small className="text-[6px] font-bold uppercase leading-[8px] tracking-[0.035em] text-[var(--text-secondary)]">Prověřeno</small><strong className="text-[10px] tabular-nums text-[var(--text-primary)]">{discovery.completedTargetCount}/{discovery.totalTargetCount}</strong></span>
          <span className="weather-alerts__record-surface flex h-5 items-center justify-between rounded-lg border px-2 lg:h-6 lg:px-2.5"><small className="text-[6px] font-bold uppercase leading-[8px] tracking-[0.035em] text-[var(--text-secondary)]">Zbývá</small><strong className="text-[10px] tabular-nums text-[var(--text-primary)]">{discovery.remainingTargetCount}</strong></span>
        </div>
        <div className={`${compact ? 'mt-0.5 lg:mt-1' : 'mt-1 lg:mt-1.5'} flex items-center gap-1.5 lg:gap-2`}><span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-border)]"><i className="block h-full rounded-full bg-sky-500 transition-[width] duration-700" style={{ width: `${Math.min(100, discovery.progressPercent)}%` }} /></span><strong className="w-7 text-right text-[7px] tabular-nums text-[var(--accent)]">{discovery.progressPercent.toLocaleString('cs-CZ')}%</strong><small className="w-[72px] truncate text-right text-[6px] text-[var(--text-secondary)]">{formatRelativeDate(discovery.lastProgressAt)}</small></div>
      </div>})}
    </div>
    {selectedSource && typeof document !== 'undefined' ? createPortal(<CompleteSourceDiagnosticPopup source={selectedSource} diagnostic={diagnostic} loading={loading} error={error} isAdmin={workspace.currentUser.isAdmin} onReload={() => loadDiagnostic(selectedSource, false)} onClose={() => { setSelectedSource(null); setDiagnostic(null); setError(null) }} />, document.body) : null}
    {showCezNew && cezNew && typeof document !== 'undefined' ? createPortal(<CompleteCezNewDiagnosticPopup state={cezNew} isAdmin={workspace.currentUser.isAdmin} onClose={() => setShowCezNew(false)} />, document.body) : null}
  </PanelShell>
}

function CompleteProviderDiagnosticPopup({ provider, diagnostic, loading, error, isAdmin, onReload, onClose }: {
  provider: CompleteProviderState['provider']
  diagnostic: CompleteProviderDiagnostic | null
  loading: boolean
  error: string | null
  isAdmin: boolean
  onReload: () => void | Promise<void>
  onClose: () => void
}) {
  const presentation = diagnostic ? providerStatusPresentation(diagnostic.state.status) : providerStatusPresentation('waiting')
  const lastRequestAge = diagnostic?.state.lastRequestAt ? new Date(diagnostic.observedAt).getTime() - new Date(diagnostic.state.lastRequestAt).getTime() : Number.POSITIVE_INFINITY
  const minuteRequests = lastRequestAge <= 60_000 ? diagnostic?.state.minuteRequestCount ?? 0 : 0
  const dayRequests = lastRequestAge <= 24 * 60 * 60_000 ? diagnostic?.state.dayRequestCount ?? 0 : 0
  const providerRecoveryBlocked = recoveryNeedsManualRepair(
    diagnostic?.task?.lastErrorCode ?? diagnostic?.recentErrors[0]?.errorCode,
    diagnostic?.task?.lastErrorMessage ?? diagnostic?.recentErrors[0]?.errorMessage,
  )

  return <PowerOutagePopupShell titleId={`complete-provider-${provider}`} eyebrow="KOMPLETNÍ SBĚR · DOHLEDÁVÁNÍ FIREM" title={providerLabel(provider)} icon={<SearchCheck aria-hidden size={21} />} onClose={onClose}>
    {loading ? <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center p-6 text-center"><span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--surface-border)] border-t-[var(--accent)]" /><strong className="mt-4 text-sm text-[var(--text-primary)]">Načítám provozní stav…</strong></div> : error || !diagnostic ? <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center p-6 text-center"><CircleAlert aria-hidden size={28} className="text-red-500" /><strong className="mt-3 text-sm text-[var(--text-primary)]">Detail poskytovatele se nepodařilo načíst</strong><p className="mt-1 max-w-md text-xs leading-5 text-[var(--text-secondary)]">{error ?? 'Data nejsou dostupná.'}</p></div> : <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5"><span><small className="block text-[8px] font-bold uppercase tracking-[0.09em] text-[var(--text-secondary)]">Aktuální stav poskytovatele</small><strong className="mt-1 block text-sm text-[var(--text-primary)]">{providerStatusLabel(diagnostic.state.status)}</strong><span className="mt-1 block max-w-lg text-[9px] leading-4 text-[var(--text-secondary)]">{diagnostic.state.statusMessage}</span></span><span className={`relative inline-flex h-8 w-[92px] shrink-0 items-center justify-center gap-1 rounded-xl border px-2 text-center text-[8px] font-bold leading-none tracking-[0.07em] ${presentation.badge}`}><i className={`h-1.5 w-1.5 shrink-0 rounded-full ${presentation.dot}`} /><span className="translate-y-px">{providerStatusLabel(diagnostic.state.status)}</span></span></div>

      {diagnostic.state.status === 'processing' ? <section className="mt-3 rounded-2xl border border-sky-400/25 bg-sky-500/8 p-3.5"><div className="flex items-center gap-3"><LoaderCircle aria-hidden size={18} className="animate-spin text-sky-500" /><span><small className="block text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Živý stav procesu</small><strong className="mt-1 block text-[10px] text-[var(--text-primary)]">Probíhá zpracování další bezpečné dávky dotazů</strong></span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-950/10 [html[data-theme=dark]_&]:bg-white/10"><div className="h-full w-2/5 animate-pulse rounded-full bg-sky-500 motion-reduce:animate-none" /></div><p className="mt-2 text-[9px] leading-4 text-[var(--text-secondary)]">Detail se obnovuje z databáze každých 20 sekund. Nevytváří tím další externí požadavky.</p></section> : null}

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><PowerOutageDetailRow label="Úspěšné dotazy" value={String(diagnostic.state.readyCount)} /><PowerOutageDetailRow label="Čekající dotazy" value={String(diagnostic.state.pendingCount)} /><PowerOutageDetailRow label="Bez nálezu" value={String(diagnostic.state.notFoundCount)} /><PowerOutageDetailRow label="Chybné dotazy" value={String(diagnostic.state.errorCount)} /><PowerOutageDetailRow label="Poslední požadavek" value={formatDate(diagnostic.state.lastRequestAt)} /><PowerOutageDetailRow label="Poslední úspěšný běh" value={formatDate(diagnostic.task?.lastSuccessAt ?? null)} /><PowerOutageDetailRow label="Stav úlohy" value={providerTaskStatusLabel(diagnostic.task?.status ?? null)} /><PowerOutageDetailRow label="Selhání v řadě" value={String(diagnostic.task?.consecutiveFailureCount ?? 0)} /></div>

      <section className="mt-5"><h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><TimerReset aria-hidden size={14} /> Limity a cache</h3><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><PowerOutageDetailRow label="Minutový limit" value={`${minuteRequests} / ${diagnostic.limits.minute}`} /><PowerOutageDetailRow label="Denní limit" value={`${dayRequests} / ${diagnostic.limits.day}`} /><PowerOutageDetailRow label="Maximum v dávce" value={String(diagnostic.limits.maxPerRun)} /><PowerOutageDetailRow label="Platnost cache" value={diagnostic.limits.cacheHours == null ? 'Bez omezení' : `${diagnostic.limits.cacheHours} hodin`} /></div>{provider === 'mapy' ? <div className="mt-2 grid gap-2 sm:grid-cols-3"><PowerOutageDetailRow label="Měsíční spotřeba celkem" value={`${diagnostic.state.monthlyCreditCount.toLocaleString('cs-CZ')} / ${diagnostic.state.monthlyCreditLimit.toLocaleString('cs-CZ')}`} /><PowerOutageDetailRow label="KOMPLETNÍ" value={`${diagnostic.state.completeCreditCount.toLocaleString('cs-CZ')} kreditů`} /><PowerOutageDetailRow label="MARKETY" value={`${diagnostic.state.marketsCreditCount.toLocaleString('cs-CZ')} kreditů`} /></div> : null}<p className="mt-2 text-[9px] leading-4 text-[var(--text-secondary)]">Limity jsou hlídané atomicky v databázi. Výsledek z cache nezvyšuje počet externích požadavků.</p></section>

      {(diagnostic.state.status === 'partial' || diagnostic.state.status === 'error') && (diagnostic.task?.lastErrorMessage || diagnostic.recentErrors.length > 0) ? <section className="mt-5"><h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-amber-700 [html[data-theme=dark]_&]:text-amber-300"><CircleAlert aria-hidden size={14} /> Co vyžaduje pozornost</h3>{diagnostic.task?.lastErrorMessage ? <p className="mt-2 rounded-2xl border border-amber-400/30 bg-amber-500/8 p-3.5 text-xs leading-5 text-[var(--text-primary)]">{diagnostic.task.lastErrorCode ? `${diagnostic.task.lastErrorCode}: ` : ''}{diagnostic.task.lastErrorMessage}</p> : null}<div className="mt-2 space-y-2">{diagnostic.recentErrors.map((item) => <div key={item.id} className="rounded-2xl border border-red-400/25 bg-red-500/5 px-3.5 py-3"><strong className="block text-[10px] text-[var(--text-primary)]">{item.queryText}</strong><small className="mt-1 block text-[9px] leading-4 text-[var(--text-secondary)]">Pokusů {item.attemptCount} · poslední {formatDate(item.lastAttemptAt)} · další {formatDate(item.nextAttemptAt)}</small>{item.errorMessage ? <p className="mt-1 text-[9px] leading-4 text-red-600 [html[data-theme=dark]_&]:text-red-300">{item.errorCode}: {item.errorMessage}</p> : null}</div>)}</div>{diagnostic.state.configured && diagnostic.recentErrors.length > 0 ? <RecoveryControl isAdmin={isAdmin} blocked={providerRecoveryBlocked} label="Opakovat chybné dotazy" request={{ target: 'provider_discovery', provider }} onRecovered={onReload} /> : null}</section> : null}

      <section className="mt-5"><h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><History aria-hidden size={14} /> Poslední běhy</h3><div className="mt-2 space-y-2">{diagnostic.runs.map((run) => <div key={run.id} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3"><div className="flex items-start justify-between gap-3"><span><strong className="block text-[11px] text-[var(--text-primary)]">{runStatusLabel(run.status)} · {run.processedCount} zpracovaných dotazů</strong><small className="mt-0.5 block text-[9px] leading-4 text-[var(--text-secondary)]">Externí {run.externalRequestCount} · cache {run.cacheHitCount} · firmy {run.companyCount} · důkazy {run.evidenceCount}</small></span><time className="shrink-0 text-[9px] font-semibold tabular-nums text-[var(--text-secondary)]">{formatDate(run.startedAt)}</time></div>{run.quotaReached ? <p className="mt-1 text-[9px] text-amber-700 [html[data-theme=dark]_&]:text-amber-300">Běh byl bezpečně ukončen po dosažení nastavené kvóty.</p> : null}{run.errorMessage ? <p className="mt-1 text-[9px] leading-4 text-red-600 [html[data-theme=dark]_&]:text-red-300">{run.errorCode}: {run.errorMessage}</p> : null}</div>)}{diagnostic.runs.length === 0 ? <p className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--text-secondary)]">Historie běhů zatím není dostupná.</p> : null}</div></section>

      <details className="mt-5 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5"><summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><Info aria-hidden size={14} /> Jak číst statistiky</summary><div className="mt-3 space-y-2 text-[10px] leading-5 text-[var(--text-primary)]"><p><strong>Úspěšné dotazy</strong> jsou adresní dotazy s použitelným výsledkem, nikoli přímo počet jedinečných firem.</p><p><strong>Čekající dotazy</strong> zahrnují již založené dotazy ve frontě tohoto poskytovatele.</p><p><strong>Bez nálezu</strong> znamená úspěšnou odpověď bez nalezeného subjektu. Chyby se automaticky opakují podle nastaveného termínu.</p></div></details>
    </div>}
  </PowerOutagePopupShell>
}

function DiscoveryPanel({ workspace }: { workspace: CompletePowerOutageSidebarWorkspace }) {
  const runtime = workspace.runtime
  const [selectedProvider, setSelectedProvider] = useState<CompleteProviderState['provider'] | null>(null)
  const [diagnostic, setDiagnostic] = useState<CompleteProviderDiagnostic | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadDiagnostic = async (provider: CompleteProviderState['provider'], showLoading = true) => {
    if (showLoading) setLoading(true)
    setError(null)
    const result = await getCompletePowerOutageProviderDiagnosticAction(provider)
    if (result.success) setDiagnostic(result.diagnostic)
    else setError(result.error)
    setLoading(false)
  }
  const openProvider = (provider: CompleteProviderState['provider']) => {
    setSelectedProvider(provider)
    setDiagnostic(null)
    void loadDiagnostic(provider)
  }
  useEffect(() => {
    if (!selectedProvider || diagnostic?.state.status !== 'processing') return
    const interval = window.setInterval(() => { void loadDiagnostic(selectedProvider, false) }, 20_000)
    return () => window.clearInterval(interval)
  }, [selectedProvider, diagnostic?.state.status])

  const RuntimeIcon = runtime.status === 'healthy'
    ? CircleCheck
    : runtime.status === 'processing'
      ? LoaderCircle
      : CircleAlert
  const attentionSource = ['error', 'delayed', 'partial']
    .map((status) => workspace.sources.find((source) => source.discovery.status === status))
    .find(Boolean)
  const attentionProvider = workspace.providers.find((provider) => ['error', 'partial', 'exhausted'].includes(provider.status))
  const conciseAttention = attentionSource
    ? `${sourceLabel(attentionSource.source)}: ${attentionSource.discovery.remainingTargetCount} cílů čeká`
    : attentionProvider
      ? `${providerLabel(attentionProvider.provider)}: ${attentionProvider.errorCount} chyb`
      : 'provozní chyba'
  const runtimeText = runtime.status === 'healthy'
    ? 'Automatické zpracování je v pořádku'
    : runtime.status === 'processing'
      ? `Právě běží ${runtime.runningTaskCount} úloh`
      : runtime.status === 'waiting'
        ? 'Čeká na první automatický běh'
        : `Kontrola · ${conciseAttention}`
  return <PanelShell><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 [html[data-theme=dark]_&]:text-violet-300"><SearchCheck aria-hidden size={18} /></span><span><small className="block text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">ARES · Mapy.com · Google</small><h3 className="text-base font-semibold text-[var(--text-primary)]">Vyhledávání firem</h3></span></div><div className="mt-3 flex min-h-0 flex-1 flex-col justify-between lg:mt-4 lg:block lg:space-y-2.5">{workspace.providers.map((provider) => {
    const presentation = providerStatusPresentation(provider.status)
    const capacityText = provider.configured
      ? provider.provider === 'mapy'
        ? `Volných ${provider.monthlyCreditRemaining.toLocaleString('cs-CZ')} z 250 000 kreditů`
        : `Dnes volných ${provider.dayRequestRemaining.toLocaleString('cs-CZ')} z ${provider.dayRequestLimit.toLocaleString('cs-CZ')} požadavků`
      : 'Kapacita není dostupná · chybí konfigurace'
    return <div key={provider.provider} className={`weather-alerts__record-surface h-[84px] rounded-xl border px-2.5 py-1 lg:h-[108px] lg:px-3 lg:py-2.5 ${provider.configured ? '' : 'opacity-65'}`}><div className="flex items-center justify-between gap-2"><strong className="text-[12px] uppercase text-[var(--text-primary)]">{providerLabel(provider.provider)}</strong><button type="button" onClick={() => openProvider(provider.provider)} className={`relative inline-flex h-7 w-[92px] items-center justify-center gap-1 rounded-xl border px-1.5 text-center text-[7px] font-bold uppercase leading-none tracking-[0.06em] transition hover:-translate-y-px lg:h-8 lg:w-[100px] lg:gap-1.5 lg:px-2 lg:text-[8px] lg:tracking-[0.065em] ${presentation.badge}`} aria-label={`${providerLabel(provider.provider)}: ${providerStatusLabel(provider.status)}. Zobrazit provozní detail.`} title="Zobrazit provozní detail"><i className={`h-1.5 w-1.5 shrink-0 rounded-full ${presentation.dot}`} /><span className="translate-y-px">{providerStatusLabel(provider.status)}</span>{presentation.attention ? <span className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-400 text-[8px] font-black leading-none text-amber-950 shadow-sm lg:-right-1.5 lg:-top-1.5 lg:h-4 lg:w-4 lg:text-[9px]">!</span> : null}</button></div><div className="mt-0.5 grid grid-cols-4 gap-1 text-center lg:mt-1.5 lg:gap-1.5"><span className="weather-alerts__record-surface flex h-8 flex-col items-center justify-center rounded-lg border text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300"><small className="text-[7px] font-bold uppercase leading-[8px]">Nalezeno</small><strong className="text-sm leading-4 tabular-nums text-[var(--text-primary)]">{provider.readyCount}</strong></span><span className="weather-alerts__record-surface flex h-8 flex-col items-center justify-center rounded-lg border text-[var(--text-secondary)]"><small className="text-[7px] font-bold uppercase leading-[8px]">Čeká</small><strong className="text-sm leading-4 tabular-nums text-[var(--text-primary)]">{provider.pendingCount}</strong></span><span className="weather-alerts__record-surface flex h-8 flex-col items-center justify-center rounded-lg border text-amber-700 [html[data-theme=dark]_&]:text-amber-300"><small className="whitespace-nowrap text-[6px] font-bold uppercase leading-[8px]">Bez nálezu</small><strong className="text-sm leading-4 tabular-nums text-[var(--text-primary)]">{provider.notFoundCount}</strong></span><span className="weather-alerts__record-surface flex h-8 flex-col items-center justify-center rounded-lg border text-red-700 [html[data-theme=dark]_&]:text-red-300"><small className="text-[7px] font-bold uppercase leading-[8px]">Chyby</small><strong className="text-sm leading-4 tabular-nums text-[var(--text-primary)]">{provider.errorCount}</strong></span></div><p className="mt-1 truncate text-center text-[8px] leading-4 text-[var(--text-secondary)] lg:mt-2">{capacityText}</p></div>
  })}</div><div className={`mt-auto flex items-center justify-center gap-1.5 pt-2 text-center text-[9px] lg:pt-3 ${runtime.status === 'attention' ? 'text-red-700 [html[data-theme=dark]_&]:text-red-300' : 'text-[var(--text-secondary)]'}`} title={runtime.issues.join('\n')}><RuntimeIcon aria-hidden size={12} className={runtime.status === 'processing' ? 'animate-spin' : ''} /><span className="truncate">{runtimeText}</span></div><p className="mt-0.5 flex items-center justify-center gap-1.5 text-center text-[8px] text-[var(--text-secondary)]"><TimerReset aria-hidden size={11} /><span>Poslední aktivita: {formatDate(runtime.lastActivityAt)}</span></p>{selectedProvider && typeof document !== 'undefined' ? createPortal(<CompleteProviderDiagnosticPopup provider={selectedProvider} diagnostic={diagnostic} loading={loading} error={error} isAdmin={workspace.currentUser.isAdmin} onReload={() => loadDiagnostic(selectedProvider, false)} onClose={() => { setSelectedProvider(null); setDiagnostic(null); setError(null) }} />, document.body) : null}</PanelShell>
}

function AddressCoverageDiagnosticPopup({ diagnostic, loading, error, isAdmin, onReload, onClose }: {
  diagnostic: CompleteAddressCoverageDiagnostic | null
  loading: boolean
  error: string | null
  isAdmin: boolean
  onReload: () => void | Promise<void>
  onClose: () => void
}) {
  const coverage = diagnostic?.coverage
  const percent = coverage && coverage.totalCount > 0 ? Math.round((coverage.normalizedCount / coverage.totalCount) * 1000) / 10 : 0
  const presentation = coverage ? addressCoverageStatusPresentation(coverage.status) : addressCoverageStatusPresentation('waiting')
  const normalizationRecoveryBlocked = recoveryNeedsManualRepair(
    diagnostic?.task?.lastErrorCode,
    diagnostic?.task?.lastErrorMessage,
  )
  return <PowerOutagePopupShell titleId="complete-address-coverage" eyebrow="KOMPLETNÍ SBĚR · DATABÁZE ADRES" title="Detail pokrytí adres" icon={<MapPinned aria-hidden size={21} />} onClose={onClose}>
    {loading ? <div className="flex min-h-[320px] flex-1 flex-col items-center justify-center p-6 text-center"><span className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--surface-border)] border-t-[var(--accent)]" /><strong className="mt-4 text-sm text-[var(--text-primary)]">Načítám pokrytí adres…</strong></div> : error || !diagnostic || !coverage ? <div className="flex min-h-[300px] flex-1 flex-col items-center justify-center p-6 text-center"><CircleAlert aria-hidden size={28} className="text-red-500" /><strong className="mt-3 text-sm text-[var(--text-primary)]">Detail pokrytí se nepodařilo načíst</strong><p className="mt-1 max-w-md text-xs leading-5 text-[var(--text-secondary)]">{error ?? 'Data nejsou dostupná.'}</p></div> : <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
      <section className="rounded-2xl border border-sky-500/25 bg-sky-500/8 p-4"><div className="flex items-end justify-between gap-3"><span><small className="block text-[8px] font-bold uppercase tracking-[0.1em] text-sky-700 [html[data-theme=dark]_&]:text-sky-300">Normalizováno aktuální verzí</small><strong className="mt-1 block text-base text-[var(--text-primary)]">{coverage.normalizedCount} z {coverage.totalCount} adres</strong></span><span className="flex flex-col items-end gap-2"><strong className="text-3xl font-semibold tabular-nums text-[var(--accent)]">{percent.toLocaleString('cs-CZ')} %</strong><span className={`relative inline-flex h-7 w-[92px] items-center justify-center gap-1 rounded-xl border px-2 text-[7px] font-bold tracking-[0.06em] ${presentation.badge}`}><i className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} /><span className="translate-y-px">{addressCoverageStatusLabel(coverage.status)}</span></span></span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-sky-950/10 [html[data-theme=dark]_&]:bg-white/10"><div className="h-full rounded-full bg-sky-500 transition-[width] duration-700" style={{ width: `${Math.min(100, percent)}%` }} /></div><p className="mt-2 text-[9px] leading-4 text-[var(--text-secondary)]">{coverage.statusMessage}</p></section>

      {coverage.status === 'processing' ? <section className="mt-3 rounded-2xl border border-sky-400/25 bg-sky-500/8 p-3.5"><div className="flex items-center gap-3"><LoaderCircle aria-hidden size={18} className="animate-spin text-sky-500" /><span><small className="block text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Živý stav fronty</small><strong className="mt-1 block text-[10px] text-[var(--text-primary)]">Zbývá {coverage.pendingCount} adres · zpracovává se bezpečná dávka</strong></span></div><p className="mt-2 text-[9px] leading-4 text-[var(--text-secondary)]">Údaj se obnovuje každých 20 sekund z databáze. Výsledek právě běžící dávky se projeví po jejím dokončení.</p></section> : null}

      <section className="mt-4"><h3 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Kvalita zpracovaných adres</h3><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{[
        ['Přesné', coverage.exactCount, 'Ulice a konkrétní číslo domu.', 'border-emerald-400/30 bg-emerald-400/8'],
        ['Širší rozsah', coverage.broadCount, 'Pouze ulice nebo obec.', 'border-amber-400/30 bg-amber-400/8'],
        ['Nerozpoznané', coverage.unresolvedCount, 'Bez použitelného adresního rozsahu.', 'border-orange-400/30 bg-orange-400/8'],
        ['Čeká', coverage.pendingCount, 'Dosud neprošlo aktuální verzí.', 'border-slate-400/30 bg-slate-400/8'],
      ].map(([label, value, description, tone]) => <div key={String(label)} className={`rounded-2xl border p-3 ${tone}`}><div className="flex items-baseline justify-between gap-2"><strong className="text-[9px] uppercase text-[var(--text-primary)]">{label}</strong><strong className="text-lg tabular-nums text-[var(--text-primary)]">{value}</strong></div><p className="mt-1 text-[8px] leading-4 text-[var(--text-secondary)]">{description}</p></div>)}</div></section>

      <section className="mt-4"><h3 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Vyhledávací cíle pro firmy</h3><div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4"><PowerOutageDetailRow label="Celkem cílů" value={String(diagnostic.targets.totalCount)} /><PowerOutageDetailRow label="Přesná čísla" value={String(diagnostic.targets.exactCount)} /><PowerOutageDetailRow label="Ulice" value={String(diagnostic.targets.streetCount)} /><PowerOutageDetailRow label="Obce" value={String(diagnostic.targets.municipalityCount)} /></div><p className="mt-2 text-[9px] leading-4 text-[var(--text-secondary)]">Jedna skupinová adresa distributora může vytvořit více konkrétních cílů. Proto počet cílů nemusí odpovídat počtu adres.</p></section>

      <section className="mt-4"><h3 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Pokrytí podle distributora</h3><div className="mt-2 grid gap-2 sm:grid-cols-3">{diagnostic.sources.map((source) => { const sourcePercent = source.totalCount > 0 ? Math.round((source.normalizedCount / source.totalCount) * 1000) / 10 : 0; return <div key={source.source} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3"><div className="flex items-center justify-between"><strong className="text-xs text-[var(--text-primary)]">{sourceLabel(source.source)}</strong><strong className="text-sm tabular-nums text-[var(--accent)]">{sourcePercent.toLocaleString('cs-CZ')} %</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-strong)]"><span className="block h-full rounded-full bg-sky-500" style={{ width: `${Math.min(100, sourcePercent)}%` }} /></div><div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[8px] text-[var(--text-secondary)]"><span>Celkem <strong className="text-[var(--text-primary)]">{source.totalCount}</strong></span><span>Zpracováno <strong className="text-[var(--text-primary)]">{source.normalizedCount}</strong></span><span>Přesné <strong className="text-[var(--text-primary)]">{source.exactCount}</strong></span><span>Širší <strong className="text-[var(--text-primary)]">{source.broadCount}</strong></span></div></div> })}</div></section>

      <section className="mt-4"><h3 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Provoz normalizátoru</h3><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><PowerOutageDetailRow label="Verze normalizátoru" value={String(diagnostic.normalizerVersion)} /><PowerOutageDetailRow label="Stav úlohy" value={providerTaskStatusLabel(diagnostic.task?.status ?? null)} /><PowerOutageDetailRow label="Poslední start" value={formatDate(diagnostic.task?.lastStartedAt ?? null)} /><PowerOutageDetailRow label="Poslední dokončení" value={formatDate(diagnostic.task?.lastFinishedAt ?? null)} /><PowerOutageDetailRow label="Poslední úspěch" value={formatDate(diagnostic.task?.lastSuccessAt ?? null)} /><PowerOutageDetailRow label="Selhání v řadě" value={String(diagnostic.task?.consecutiveFailureCount ?? 0)} /></div>{diagnostic.task?.lastErrorMessage ? <p className="mt-2 rounded-2xl border border-red-400/30 bg-red-500/8 p-3.5 text-xs leading-5 text-[var(--text-primary)]">{diagnostic.task.lastErrorCode ? `${diagnostic.task.lastErrorCode}: ` : ''}{diagnostic.task.lastErrorMessage}</p> : null}{coverage.status === 'error' && diagnostic.task?.status === 'failed' ? <RecoveryControl isAdmin={isAdmin} blocked={normalizationRecoveryBlocked} label="Obnovit normalizaci" request={{ target: 'address_normalization' }} onRecovered={onReload} /> : null}</section>

      <section className="mt-4"><h3 className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]"><History aria-hidden size={14} /> Poslední běhy normalizace</h3><div className="mt-2 space-y-2">{diagnostic.runs.map((run) => <div key={run.id} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 py-3"><div className="flex items-start justify-between gap-3"><span><strong className="block text-[11px] text-[var(--text-primary)]">{runStatusLabel(run.status)} · {run.processedAddressCount} adres</strong><small className="mt-0.5 block text-[9px] leading-4 text-[var(--text-secondary)]">Vytvořeno {run.createdTargetCount} cílů · přesné {run.exactTargetCount} · širší {run.broadTargetCount} · zbývá {run.remainingCount ?? 'neuvedeno'}</small></span><time className="shrink-0 text-[9px] font-semibold tabular-nums text-[var(--text-secondary)]">{formatDate(run.startedAt)}</time></div>{run.errorMessage ? <p className="mt-1 text-[9px] leading-4 text-red-600 [html[data-theme=dark]_&]:text-red-300">{run.errorCode}: {run.errorMessage}</p> : null}</div>)}{diagnostic.runs.length === 0 ? <p className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3 text-xs text-[var(--text-secondary)]">Historie normalizace zatím není dostupná.</p> : null}</div></section>

      <details className="mt-4 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5"><summary className="flex cursor-pointer list-none items-center gap-2 text-[10px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]"><Route aria-hidden size={14} /> Jak proces funguje</summary><div className="mt-3 grid gap-2 sm:grid-cols-4">{['Adresa distributora', 'Normalizace rozsahu a čísel', 'Vytvoření adresních cílů', 'ARES · Mapy.com · Google'].map((step, index) => <div key={step} className="flex items-center gap-2 rounded-xl border border-[var(--surface-border)] px-2.5 py-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-[9px] font-bold text-[var(--accent)]">{index + 1}</span><span className="text-[9px] font-semibold text-[var(--text-primary)]">{step}</span></div>)}</div></details>
    </div>}
  </PowerOutagePopupShell>
}

function CoveragePanel({ workspace }: { workspace: CompletePowerOutageSidebarWorkspace }) {
  const coverage = workspace.addressCoverage
  const [showDetail, setShowDetail] = useState(false)
  const [diagnostic, setDiagnostic] = useState<CompleteAddressCoverageDiagnostic | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const percent = coverage.totalCount > 0 ? Math.round((coverage.normalizedCount / coverage.totalCount) * 1000) / 10 : 0
  const presentation = addressCoverageStatusPresentation(coverage.status)
  const loadDiagnostic = async (showLoading = true) => {
    if (showLoading) setLoading(true)
    setError(null)
    const result = await getCompletePowerOutageAddressCoverageDiagnosticAction()
    if (result.success) setDiagnostic(result.diagnostic)
    else setError(result.error)
    setLoading(false)
  }
  const openDetail = () => { setShowDetail(true); setDiagnostic(null); void loadDiagnostic() }
  useEffect(() => {
    if (!showDetail || diagnostic?.coverage.status !== 'processing') return
    const interval = window.setInterval(() => { void loadDiagnostic(false) }, 20_000)
    return () => window.clearInterval(interval)
  }, [showDetail, diagnostic?.coverage.status])

  return <PanelShell><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 [html[data-theme=dark]_&]:text-emerald-300"><MapPinned aria-hidden size={18} /></span><span><small className="block text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Databáze adres</small><h3 className="text-base font-semibold text-[var(--text-primary)]">Pokrytí adres</h3></span></div><button type="button" onClick={openDetail} className="mt-4 rounded-2xl border border-sky-400/25 bg-sky-500/8 p-3.5 text-left transition hover:-translate-y-px hover:border-sky-400/45 hover:bg-sky-500/10" aria-label="Otevřít detail pokrytí adres"><div className="flex items-end justify-between gap-3"><span><small className="flex items-center gap-1.5 text-[7px] font-bold uppercase text-[var(--text-secondary)]"><i className={`h-1.5 w-1.5 rounded-full ${presentation.dot}`} />Normalizováno</small><strong className="mt-1 block text-[10px] text-[var(--text-primary)]">{coverage.normalizedCount} z {coverage.totalCount}</strong></span><span className="flex items-end gap-2">{coverage.status === 'error' ? <small className={`relative mb-0.5 inline-flex h-6 items-center justify-center rounded-lg border px-2 text-[6px] font-bold tracking-[0.05em] ${presentation.badge}`}>CHYBA<i className="absolute -right-1 -top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-red-400 text-[8px] font-black not-italic text-red-950">!</i></small> : null}<strong className="text-2xl tabular-nums text-[var(--accent)]">{percent.toLocaleString('cs-CZ')} %</strong></span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-border)]"><div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.min(100, percent)}%` }} /></div></button><div className="mt-3 grid grid-cols-3 gap-1.5 text-center"><span className="rounded-xl border border-emerald-400/25 bg-emerald-400/8 p-2 text-[6px] font-bold uppercase text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300">Přesné<strong className="mt-1 block text-sm text-[var(--text-primary)]">{coverage.exactCount}</strong></span><span className="rounded-xl border border-amber-400/25 bg-amber-400/8 p-2 text-[6px] font-bold uppercase text-amber-700 [html[data-theme=dark]_&]:text-amber-300">Širší rozsah<strong className="mt-1 block text-sm text-[var(--text-primary)]">{coverage.broadCount}</strong></span><span className="rounded-xl border border-slate-400/25 bg-slate-400/8 p-2 text-[6px] font-bold uppercase text-slate-600 [html[data-theme=dark]_&]:text-slate-300">Čeká<strong className="mt-1 block text-sm text-[var(--text-primary)]">{coverage.pendingCount}</strong></span></div>{showDetail && typeof document !== 'undefined' ? createPortal(<AddressCoverageDiagnosticPopup diagnostic={diagnostic} loading={loading} error={error} isAdmin={workspace.currentUser.isAdmin} onReload={() => loadDiagnostic(false)} onClose={() => { setShowDetail(false); setDiagnostic(null); setError(null) }} />, document.body) : null}</PanelShell>
}

export function CompletePowerOutageSidebar({ workspace }: { workspace: CompletePowerOutageSidebarWorkspace }) {
  return <div className="-mt-2 min-w-0 lg:mt-0 xl:h-full"><p className="mb-2 flex items-center justify-center gap-1.5 text-center text-[10px] text-[var(--text-secondary)] lg:hidden"><Info aria-hidden size={12} /><span>Přejetím do strany zobrazíte další část.</span></p><aside className="power-outages-mobile-aside-carousel grid min-w-0 auto-cols-[100%] grid-flow-col items-stretch gap-3 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-[24px] lg:block lg:space-y-4 lg:overflow-visible lg:rounded-none" aria-label="Stav kompletního sběru a vyhledávání firem"><div className="min-w-0 snap-start snap-always lg:snap-none"><SourcesPanel workspace={workspace} /></div><div className="min-w-0 snap-start snap-always lg:snap-none"><DiscoveryPanel workspace={workspace} /></div><div className="min-w-0 snap-start snap-always lg:snap-none"><CoveragePanel workspace={workspace} /></div></aside></div>
}
