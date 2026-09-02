'use client'

import { CircleAlert, CircleCheck, DatabaseZap, Info, LoaderCircle, MapPinned, SearchCheck } from 'lucide-react'
import type { CompletePowerOutageWorkspace } from '@/lib/power-outages/complete-types'
import type { PowerOutageSource } from '@/lib/power-outages/types'

const DATE_TIME = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

function formatDate(value: string | null) {
  if (!value) return 'Zatím neproběhlo'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Neuvedeno' : DATE_TIME.format(date)
}

function sourceLabel(source: PowerOutageSource) {
  return source === 'cez' ? 'ČEZ' : source === 'egd' ? 'EG.D' : 'PRE'
}

function coverageLabel(status: CompletePowerOutageWorkspace['sources'][number]['coverageStatus']) {
  return ({ idle: 'ČEKÁ', processing: 'ZPRACOVÁNÍ', complete: 'AKTUÁLNÍ', partial: 'ČÁSTEČNĚ', error: 'CHYBA' } as const)[status]
}

function statusTone(status: CompletePowerOutageWorkspace['sources'][number]['coverageStatus']) {
  if (status === 'complete') return 'border-emerald-400/35 bg-emerald-400/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300'
  if (status === 'error') return 'border-red-400/35 bg-red-400/10 text-red-700 [html[data-theme=dark]_&]:text-red-300'
  if (status === 'processing') return 'border-sky-400/35 bg-sky-400/10 text-sky-700 [html[data-theme=dark]_&]:text-sky-300'
  return 'border-amber-400/35 bg-amber-400/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300'
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return <section className="activities-page__panel flex h-[340px] min-w-0 flex-col rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_16px_36px_rgba(15,23,42,0.1)] sm:p-5 lg:h-auto lg:min-h-[210px] lg:p-4">{children}</section>
}

function SourcesPanel({ workspace }: { workspace: CompletePowerOutageWorkspace }) {
  return <PanelShell><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/10 text-[var(--accent)]"><DatabaseZap aria-hidden size={18} /></span><span><small className="block text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Kompletní sběr</small><h3 className="text-base font-semibold text-[var(--text-primary)]">Stav distributorů</h3></span></div><div className="mt-4 space-y-2">{workspace.sources.map((source) => <div key={source.source} className="weather-alerts__record-surface rounded-xl border p-2.5"><div className="flex items-center justify-between gap-2"><strong className="text-[11px] text-[var(--text-primary)]">{sourceLabel(source.source)}</strong><span className={`inline-flex h-6 min-w-[76px] items-center justify-center rounded-lg border px-2 text-[7px] font-bold uppercase ${statusTone(source.coverageStatus)}`} title={source.coverageMessage ?? undefined} aria-label={`${sourceLabel(source.source)}: ${coverageLabel(source.coverageStatus)}${source.coverageMessage ? `. ${source.coverageMessage}` : ''}`}>{coverageLabel(source.coverageStatus)}</span></div><div className="mt-2 grid grid-cols-2 gap-2 text-[8px] text-[var(--text-secondary)]"><span>Odstávky <strong className="ml-1 text-[var(--text-primary)]">{source.publishedOutageCount}</strong></span><span>Adresy <strong className="ml-1 text-[var(--text-primary)]">{source.publishedAddressCount}</strong></span></div>{source.source === 'cez' && source.coverageStatus === 'partial' ? <p className="mt-2 flex gap-1.5 text-[7px] leading-3 text-amber-700 [html[data-theme=dark]_&]:text-amber-300"><CircleAlert aria-hidden size={10} className="shrink-0" />{source.coverageMessage ?? 'Používá se současné pokrytí ČEZ; celoplošná fronta bude doplněna později.'}</p> : null}</div>)}</div></PanelShell>
}

function DiscoveryPanel({ workspace }: { workspace: CompletePowerOutageWorkspace }) {
  const runtime = workspace.runtime
  const RuntimeIcon = runtime.status === 'healthy'
    ? CircleCheck
    : runtime.status === 'processing'
      ? LoaderCircle
      : CircleAlert
  const runtimeText = runtime.status === 'healthy'
    ? 'Automatické zpracování je v pořádku'
    : runtime.status === 'processing'
      ? `Právě běží ${runtime.runningTaskCount} úloh`
      : runtime.status === 'waiting'
        ? 'Čeká na první automatický běh'
        : `Vyžaduje kontrolu · ${runtime.issues[0] ?? 'provozní chyba'}`
  return <PanelShell><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600 [html[data-theme=dark]_&]:text-violet-300"><SearchCheck aria-hidden size={18} /></span><span><small className="block text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">ARES · Mapy.com · Google</small><h3 className="text-base font-semibold text-[var(--text-primary)]">Vyhledávání firem</h3></span></div><div className="mt-4 space-y-2">{workspace.providers.map((provider) => <div key={provider.provider} className={`weather-alerts__record-surface rounded-xl border px-3 py-2.5 ${provider.configured ? '' : 'opacity-60'}`}><div className="flex items-center justify-between gap-2"><strong className="text-[10px] uppercase text-[var(--text-primary)]">{provider.provider === 'mapy' ? 'Mapy.com' : provider.provider}</strong><small className="text-[7px] text-[var(--text-secondary)]">{provider.configured ? `Dnes ${provider.dayRequestCount} požadavků` : 'NEAKTIVNÍ'}</small></div><div className="mt-2 grid grid-cols-4 gap-1 text-center"><span className="rounded-lg bg-emerald-500/8 px-1 py-1.5 text-[6px] uppercase text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300">Nalezeno<strong className="mt-0.5 block text-[10px] text-[var(--text-primary)]">{provider.readyCount}</strong></span><span className="rounded-lg bg-slate-500/8 px-1 py-1.5 text-[6px] uppercase text-[var(--text-secondary)]">Čeká<strong className="mt-0.5 block text-[10px] text-[var(--text-primary)]">{provider.pendingCount}</strong></span><span className="rounded-lg bg-amber-500/8 px-1 py-1.5 text-[6px] uppercase text-amber-700 [html[data-theme=dark]_&]:text-amber-300">Bez nálezu<strong className="mt-0.5 block text-[10px] text-[var(--text-primary)]">{provider.notFoundCount}</strong></span><span className="rounded-lg bg-red-500/8 px-1 py-1.5 text-[6px] uppercase text-red-700 [html[data-theme=dark]_&]:text-red-300">Chyby<strong className="mt-0.5 block text-[10px] text-[var(--text-primary)]">{provider.errorCount}</strong></span></div></div>)}</div><div className={`mt-auto flex items-center gap-1.5 pt-3 text-[7px] ${runtime.status === 'attention' ? 'text-red-700 [html[data-theme=dark]_&]:text-red-300' : 'text-[var(--text-secondary)]'}`} title={runtime.issues.join('\n')}><RuntimeIcon aria-hidden size={11} className={runtime.status === 'processing' ? 'animate-spin' : ''} /><span className="truncate">{runtimeText}</span></div><p className="mt-1 text-[7px] text-[var(--text-secondary)]">Poslední aktivita: {formatDate(runtime.lastActivityAt)}</p></PanelShell>
}

function CoveragePanel({ workspace }: { workspace: CompletePowerOutageWorkspace }) {
  const coverage = workspace.addressCoverage
  const percent = coverage.totalCount > 0 ? Math.round((coverage.normalizedCount / coverage.totalCount) * 1000) / 10 : 0
  return <PanelShell><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 [html[data-theme=dark]_&]:text-emerald-300"><MapPinned aria-hidden size={18} /></span><span><small className="block text-[8px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Databáze adres</small><h3 className="text-base font-semibold text-[var(--text-primary)]">Pokrytí adres</h3></span></div><div className="mt-4 rounded-2xl border border-sky-400/25 bg-sky-500/8 p-3.5"><div className="flex items-end justify-between gap-3"><span><small className="block text-[7px] font-bold uppercase text-[var(--text-secondary)]">Normalizováno</small><strong className="mt-1 block text-[10px] text-[var(--text-primary)]">{coverage.normalizedCount} z {coverage.totalCount}</strong></span><strong className="text-2xl tabular-nums text-[var(--accent)]">{percent.toLocaleString('cs-CZ')} %</strong></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-border)]"><div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.min(100, percent)}%` }} /></div></div><div className="mt-3 grid grid-cols-3 gap-1.5 text-center"><span className="rounded-xl border border-emerald-400/25 bg-emerald-400/8 p-2 text-[6px] font-bold uppercase text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300">Přesné<strong className="mt-1 block text-sm text-[var(--text-primary)]">{coverage.exactCount}</strong></span><span className="rounded-xl border border-amber-400/25 bg-amber-400/8 p-2 text-[6px] font-bold uppercase text-amber-700 [html[data-theme=dark]_&]:text-amber-300">Nedostatečné<strong className="mt-1 block text-sm text-[var(--text-primary)]">{coverage.insufficientCount}</strong></span><span className="rounded-xl border border-red-400/25 bg-red-400/8 p-2 text-[6px] font-bold uppercase text-red-700 [html[data-theme=dark]_&]:text-red-300">Chyby<strong className="mt-1 block text-sm text-[var(--text-primary)]">{coverage.errorCount}</strong></span></div></PanelShell>
}

export function CompletePowerOutageSidebar({ workspace }: { workspace: CompletePowerOutageWorkspace }) {
  return <div className="-mt-2 min-w-0 lg:mt-0 xl:h-full"><p className="mb-2 flex items-center justify-center gap-1.5 text-center text-[10px] text-[var(--text-secondary)] lg:hidden"><Info aria-hidden size={12} /><span>Přejetím do strany zobrazíte další část.</span></p><aside className="power-outages-mobile-aside-carousel grid min-w-0 auto-cols-[100%] grid-flow-col items-stretch gap-3 snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-[24px] lg:block lg:space-y-4 lg:overflow-visible lg:rounded-none" aria-label="Stav kompletního sběru a vyhledávání firem"><div className="min-w-0 snap-start snap-always lg:snap-none"><SourcesPanel workspace={workspace} /></div><div className="min-w-0 snap-start snap-always lg:snap-none"><DiscoveryPanel workspace={workspace} /></div><div className="min-w-0 snap-start snap-always lg:snap-none"><CoveragePanel workspace={workspace} /></div></aside></div>
}
