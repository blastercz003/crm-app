'use client'

import {
  Archive,
  Building2,
  CalendarDays,
  ChevronDown,
  CircleCheck,
  Eye,
  ExternalLink,
  MapPin,
  Search,
  SearchCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  CompleteCandidateStatus,
  CompleteEntityKind,
  CompletePowerOutageDetail,
  CompletePowerOutageListItem,
  CompletePowerOutageWorkspace,
} from '@/lib/power-outages/complete-types'
import type { PowerOutageSource } from '@/lib/power-outages/types'
import { getCompletePowerOutageDetailAction } from './actions'
import { PowerOutageDetailRow, PowerOutagePopupShell } from './power-outage-popups'

type Tab = 'current' | 'archive'
type StatusFilter = 'visible' | CompleteCandidateStatus

const DATE_TIME = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

function formatDateTime(value: string | null) {
  if (!value) return 'Neuvedeno'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Neuvedeno' : DATE_TIME.format(date)
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('cs-CZ').trim()
}

function sourceLabel(source: PowerOutageSource) {
  return source === 'cez' ? 'ČEZ' : source === 'egd' ? 'EG.D' : 'PRE'
}

function entityLabel(kind: CompleteEntityKind) {
  return kind === 'registered_office' ? 'SÍDLO' : kind === 'establishment' ? 'PROVOZOVNA' : 'SÍDLO + PROVOZOVNA'
}

function statusLabel(status: CompleteCandidateStatus) {
  return ({ new: 'NOVÉ', confirmed: 'POTVRZENO', needs_review: 'K OVĚŘENÍ', dismissed: 'ZAMÍTNUTO', stale: 'NEAKTUÁLNÍ' } as const)[status]
}

function SourceBadge({ source }: { source: PowerOutageSource }) {
  return <span className="inline-flex h-6 w-[44px] items-center justify-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] text-[8px] font-bold uppercase tracking-[0.06em] text-[var(--accent)]">{sourceLabel(source)}</span>
}

function StatusBadge({ status }: { status: CompleteCandidateStatus }) {
  const tone = status === 'confirmed'
    ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300'
    : status === 'needs_review' || status === 'new'
      ? 'border-amber-400/45 bg-amber-400/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300'
      : 'border-slate-400/40 bg-slate-400/10 text-[var(--text-secondary)]'
  return <span className={`inline-flex h-6 w-[88px] items-center justify-center rounded-full border px-2 text-[7px] font-bold uppercase tracking-[0.045em] ${tone}`}>{statusLabel(status)}</span>
}

function EntityBadge({ kind }: { kind: CompleteEntityKind }) {
  return <span className="inline-flex h-6 min-w-[72px] items-center justify-center rounded-full border border-violet-400/30 bg-violet-400/8 px-2 text-[7px] font-bold uppercase tracking-[0.04em] text-violet-700 [html[data-theme=dark]_&]:text-violet-300">{entityLabel(kind)}</span>
}

function ProviderBadges({ providers }: { providers: CompletePowerOutageListItem['providers'] }) {
  return <span className="flex flex-wrap gap-1">{providers.map((provider) => <span key={provider} className="inline-flex h-5 items-center rounded-lg border border-sky-400/20 bg-sky-500/8 px-1.5 text-[6px] font-bold uppercase text-[var(--accent)]">{provider === 'mapy' ? 'MAPY' : provider.toUpperCase()}</span>)}</span>
}

function addressLabel(item: CompletePowerOutageListItem) {
  const number = [item.houseNumber, item.orientationNumber].filter(Boolean).join('/')
  return [item.street && `${item.street}${number ? ` ${number}` : ''}`, item.townPart].filter(Boolean).join(', ') || item.rawAddress
}

function SelectControl({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="relative min-w-0"><span className="sr-only">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full appearance-none rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] pl-3 pr-8 text-[10px] font-medium text-[var(--text-primary)] outline-none focus:border-[var(--accent)]">{children}</select><ChevronDown aria-hidden size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" /></label>
}

function LoadingDetail() {
  return <div className="flex min-h-[280px] items-center justify-center"><span className="h-8 w-8 animate-spin rounded-full border-2 border-sky-500/20 border-t-sky-500" /></div>
}

function CompleteDetailPopup({ item, detail, loading, error, onClose }: { item: CompletePowerOutageListItem; detail: CompletePowerOutageDetail | null; loading: boolean; error: string | null; onClose: () => void }) {
  return <PowerOutagePopupShell titleId="complete-power-outage-detail" eyebrow="KOMPLETNÍ ODSTÁVKY · DETAIL FIRMY" title={item.companyName} icon={<Building2 aria-hidden size={21} />} onClose={onClose}>
    {loading ? <LoadingDetail /> : error ? <div className="m-5 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-700 [html[data-theme=dark]_&]:text-red-300">{error}</div> : detail ? <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
      <section className="rounded-2xl border border-sky-400/25 bg-sky-500/8 p-4">
        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={detail.candidateStatus} /><EntityBadge kind={detail.entityKind} /><strong className="ml-auto text-xl tabular-nums text-[var(--accent)]">{Math.round(detail.confidence * 100)} %</strong></div>
        <h3 className="mt-3 text-lg font-semibold text-[var(--text-primary)]">{detail.companyName}</h3>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">{detail.displayAddress || `${addressLabel(detail)}, ${detail.municipality}`}</p>
      </section>
      <section className="mt-4"><h4 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Vyhodnocení systému</h4><div className="mt-2 grid gap-2 sm:grid-cols-2"><PowerOutageDetailRow label="Výsledek" value={statusLabel(detail.candidateStatus)} /><PowerOutageDetailRow label="Jistota" value={`${Math.round(detail.confidence * 100)} %`} /><PowerOutageDetailRow label="Typ" value={entityLabel(detail.entityKind)} /><PowerOutageDetailRow label="Počet důkazů" value={String(detail.evidenceCount)} /></div>{detail.evaluationExplanations.length ? <ul className="mt-3 space-y-2">{detail.evaluationExplanations.map((text) => <li key={text} className="flex gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2 text-[10px] leading-4 text-[var(--text-primary)]"><CircleCheck aria-hidden size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" />{text}</li>)}</ul> : <p className="mt-3 text-xs text-[var(--text-secondary)]">Výsledek zatím čeká na první vyhodnocení.</p>}</section>
      <section className="mt-4"><h4 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Firma a dotčená adresa</h4><div className="mt-2 grid gap-2 sm:grid-cols-2"><PowerOutageDetailRow label="IČO" value={detail.ico || 'Neuvedeno'} /><PowerOutageDetailRow label="Právní forma" value={detail.legalForm || 'Neuvedena'} /><PowerOutageDetailRow label="Obec" value={detail.municipality} /><PowerOutageDetailRow label="Adresa distributora" value={addressLabel(detail) || detail.rawAddress} /></div></section>
      <section className="mt-4"><h4 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Termín odstávky</h4><div className="mt-2 grid gap-2 sm:grid-cols-2"><PowerOutageDetailRow label="Distributor" value={sourceLabel(detail.source)} /><PowerOutageDetailRow label="Stav zdroje" value={detail.sourceStatus.toUpperCase()} /><PowerOutageDetailRow label="Termín od" value={formatDateTime(detail.startsAt)} /><PowerOutageDetailRow label="Termín do" value={formatDateTime(detail.endsAt)} /></div>{detail.sourceUrl ? <a href={detail.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--accent)] hover:underline">Otevřít stránku distributora <ExternalLink aria-hidden size={12} /></a> : null}</section>
      <section className="mt-4"><h4 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Zdrojové důkazy</h4><div className="mt-2 space-y-2">{detail.evidence.length ? detail.evidence.map((evidence) => <article key={evidence.id} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3"><div className="flex items-center justify-between gap-3"><strong className="text-[9px] uppercase tracking-[0.08em] text-[var(--accent)]">{evidence.provider}</strong><span className="text-[10px] font-bold tabular-nums text-[var(--text-primary)]">{Math.round(evidence.confidence * 100)} %</span></div><p className="mt-1 text-[11px] font-semibold text-[var(--text-primary)]">{evidence.displayName}</p>{evidence.displayAddress ? <p className="mt-0.5 text-[9px] text-[var(--text-secondary)]">{evidence.displayAddress}</p> : null}<div className="mt-2 flex items-center justify-between gap-2 text-[8px] uppercase text-[var(--text-secondary)]"><span>{evidence.matchLevel.replaceAll('_', ' ')}</span>{evidence.sourceUrl ? <a href={evidence.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent)]">Zdroj <ExternalLink aria-hidden size={10} /></a> : null}</div></article>) : <p className="text-xs text-[var(--text-secondary)]">Důkazy zatím nejsou dostupné.</p>}</div></section>
    </div> : null}
  </PowerOutagePopupShell>
}

function MobileCard({ item, onDetail }: { item: CompletePowerOutageListItem; onDetail: () => void }) {
  return <article className="power-outages-mobile-card weather-alerts__record-surface rounded-[18px] border px-3 py-3"><div className="flex items-start justify-between gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-[var(--accent)]"><Building2 aria-hidden size={14} /></span><div className="flex flex-wrap justify-end gap-1"><SourceBadge source={item.source} /><StatusBadge status={item.candidateStatus} /></div></div><div className="mt-2 flex items-baseline gap-2"><strong className="min-w-0 truncate text-[13px] text-[var(--text-primary)]">{item.companyName}</strong>{item.ico ? <small className="shrink-0 text-[8px] font-semibold text-[var(--text-secondary)]">IČO {item.ico}</small> : null}</div><p className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px]"><MapPin aria-hidden size={11} className="shrink-0 text-[var(--text-secondary)]" /><strong className="shrink-0 text-[var(--text-primary)]">{item.municipality}</strong><span className="truncate text-[var(--text-secondary)]">· {addressLabel(item)}</span></p><div className="mt-2 flex items-center justify-between gap-2"><div className="min-w-0"><strong className="block truncate text-[10px] tabular-nums text-[var(--text-primary)]">{formatDateTime(item.startsAt)} → {formatDateTime(item.endsAt)}</strong><div className="mt-1 flex items-center gap-1.5"><EntityBadge kind={item.entityKind} /><ProviderBadges providers={item.providers} /></div></div><button type="button" onClick={onDetail} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-sky-400/20 bg-sky-500/10 px-2.5 text-[7px] font-bold uppercase text-[var(--accent)]"><Eye aria-hidden size={12} /> Detail</button></div></article>
}

export function CompletePowerOutageRecords({ workspace }: { workspace: CompletePowerOutageWorkspace }) {
  const [tab, setTab] = useState<Tab>('current')
  const [query, setQuery] = useState('')
  const [company, setCompany] = useState('all')
  const [source, setSource] = useState<'all' | PowerOutageSource>('all')
  const [entity, setEntity] = useState<'all' | CompleteEntityKind>('all')
  const [status, setStatus] = useState<StatusFilter>('visible')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState<CompletePowerOutageListItem | null>(null)
  const [detail, setDetail] = useState<CompletePowerOutageDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const records = tab === 'current' ? workspace.currentItems : workspace.archivedItems
  const filtered = useMemo(() => records.filter((item) => {
    if (company !== 'all' && item.companyName !== company) return false
    if (source !== 'all' && item.source !== source) return false
    if (entity !== 'all' && item.entityKind !== entity) return false
    if (status === 'visible' && ['dismissed', 'stale'].includes(item.candidateStatus)) return false
    if (status !== 'visible' && item.candidateStatus !== status) return false
    if (query.trim()) {
      const haystack = normalize([item.companyName, item.ico, item.municipality, item.street, item.rawAddress].filter(Boolean).join(' '))
      if (!haystack.includes(normalize(query))) return false
    }
    return true
  }), [company, entity, query, records, source, status])
  const activeFilterCount = [query.trim(), company !== 'all', source !== 'all', entity !== 'all', status !== 'visible'].filter(Boolean).length
  const openDetail = async (item: CompletePowerOutageListItem) => {
    setSelected(item); setDetail(null); setDetailError(null); setDetailLoading(true)
    const result = await getCompletePowerOutageDetailAction(item.candidateId)
    if (result.success) setDetail(result.detail); else setDetailError(result.error)
    setDetailLoading(false)
  }
  const clear = () => { setQuery(''); setCompany('all'); setSource('all'); setEntity('all'); setStatus('visible') }
  return <section className="activities-page__panel min-w-0 rounded-[28px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] sm:p-5 xl:col-span-3 xl:flex xl:h-0 xl:min-h-full xl:flex-col xl:overflow-hidden">
    <div className="grid gap-3 xl:grid-cols-[175px_minmax(0,1fr)_160px] xl:items-center xl:gap-2"><div><div className="flex items-center justify-between gap-2"><span className="text-[9px] font-bold uppercase tracking-[0.13em] text-[var(--text-secondary)]">Databáze firem</span><div className="weather-alerts__record-surface grid h-8 w-[112px] grid-cols-2 rounded-xl border p-0.5 xl:hidden"><button onClick={() => setTab('current')} className={`rounded-[10px] text-[6px] font-bold uppercase ${tab === 'current' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)]'}`}>Aktuální</button><button onClick={() => setTab('archive')} className={`rounded-[10px] text-[6px] font-bold uppercase ${tab === 'archive' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)]'}`}>Archiv</button></div></div><h2 className="mt-1 whitespace-nowrap text-xl font-semibold text-[var(--text-primary)]">Přehled kompletních odstávek</h2></div>
      <div className="weather-alerts__record-surface rounded-[22px] border p-1 xl:col-start-2"><button type="button" onClick={() => setFiltersOpen((value) => !value)} className="flex h-8 w-full items-center gap-2 rounded-xl px-2.5 text-[9px] font-bold uppercase text-[var(--text-secondary)] xl:hidden"><SlidersHorizontal aria-hidden size={14} className="text-[var(--accent)]" /><span className="flex-1 text-left">Filtry</span>{activeFilterCount ? <span className="rounded-full bg-sky-500 px-1.5 py-0.5 text-white">{activeFilterCount}</span> : null}<ChevronDown aria-hidden size={14} className={filtersOpen ? 'rotate-180' : ''} /></button><div className={`${filtersOpen ? 'grid' : 'hidden'} mt-1 gap-2 p-1 sm:grid-cols-2 xl:mt-0 xl:grid xl:grid-cols-[minmax(120px,1.35fr)_repeat(4,minmax(80px,1fr))] xl:gap-1.5 xl:p-0`}><label className="relative min-w-0 sm:col-span-2 xl:col-span-1"><Search aria-hidden size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Firma, IČO, město nebo ulice…" className="h-10 w-full rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] pl-9 pr-3 text-[10px] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]" /></label><SelectControl label="Firma" value={company} onChange={setCompany}><option value="all">Všechny firmy</option>{workspace.filters.companies.map((value) => <option key={value}>{value}</option>)}</SelectControl><SelectControl label="Distributor" value={source} onChange={(value) => setSource(value as typeof source)}><option value="all">Všichni distributoři</option><option value="cez">ČEZ</option><option value="egd">EG.D</option><option value="pre">PRE</option></SelectControl><SelectControl label="Typ" value={entity} onChange={(value) => setEntity(value as typeof entity)}><option value="all">Všechny typy</option><option value="registered_office">Sídla</option><option value="establishment">Provozovny</option><option value="mixed">Sídla + provozovny</option></SelectControl><SelectControl label="Stav" value={status} onChange={(value) => setStatus(value as StatusFilter)}><option value="visible">Běžné výsledky</option><option value="confirmed">Potvrzené</option><option value="needs_review">K ověření</option><option value="new">Nové</option><option value="dismissed">Zamítnuté</option></SelectControl></div>{activeFilterCount ? <button type="button" onClick={clear} className="ml-1 mt-2 inline-flex items-center gap-1 text-[8px] font-bold uppercase text-[var(--text-secondary)] xl:hidden"><X aria-hidden size={11} /> Zrušit filtry</button> : null}</div>
      <div className="weather-alerts__record-surface hidden h-12 grid-cols-2 rounded-2xl border p-1 xl:grid"><button onClick={() => setTab('current')} className={`rounded-xl text-[9px] font-bold uppercase ${tab === 'current' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)]'}`}>Aktuální</button><button onClick={() => setTab('archive')} className={`rounded-xl text-[9px] font-bold uppercase ${tab === 'archive' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)]'}`}>Archiv</button></div></div>
    <div className="power-outages-records-shell weather-alerts__record-surface mt-3 overflow-visible rounded-[22px] border lg:overflow-hidden xl:flex xl:min-h-0 xl:flex-1 xl:flex-col"><div className="hidden h-11 items-center justify-between border-b border-[var(--surface-border)] px-4 lg:flex"><span className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">{tab === 'current' ? <CalendarDays aria-hidden size={14} className="text-[var(--accent)]" /> : <Archive aria-hidden size={14} className="text-[var(--accent)]" />}{tab === 'current' ? 'Aktuální firmy v odstávkách' : 'Archiv firem v odstávkách'}</span><span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] px-2 text-[9px] font-bold text-[var(--text-secondary)]">{filtered.length}</span></div>
      {filtered.length ? <div className="-mx-2 max-h-[610px] overflow-y-auto px-2 py-1 lg:mx-0 lg:max-h-[500px] lg:px-0 lg:py-0 xl:min-h-0 xl:max-h-none xl:flex-1"><div className="hidden lg:block"><table className="w-full table-fixed border-collapse text-left"><thead className="power-outages-table__header sticky top-0 z-10"><tr className="text-[7px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]"><th className="w-[18%] px-3 py-2.5">Firma / subjekt</th><th className="w-[17%] px-3 py-2.5">Adresa</th><th className="w-[7%] px-3 py-2.5">Distributor</th><th className="w-[13%] px-3 py-2.5">Termín od</th><th className="w-[13%] px-3 py-2.5">Termín do</th><th className="w-[17%] px-3 py-2.5">Typ / zdroje</th><th className="w-[10%] px-3 py-2.5">Stav</th><th className="w-[5%] px-3 py-2.5 text-right">Akce</th></tr></thead><tbody className="divide-y divide-[var(--surface-border)]">{filtered.map((item) => <tr key={item.candidateId} className="hover:bg-[var(--surface-muted)]"><td className="px-3 py-3"><div className="flex min-w-0 items-center gap-2"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-[var(--accent)]"><Building2 aria-hidden size={14} /></span><span className="min-w-0"><strong className="block truncate text-[10px] text-[var(--text-primary)]">{item.companyName}</strong><small className="block truncate text-[8px] text-[var(--text-secondary)]">{item.ico ? `IČO ${item.ico}` : 'IČO neuvedeno'}</small></span></div></td><td className="px-3 py-3"><strong className="block truncate text-[9px] text-[var(--text-primary)]">{item.municipality}</strong><small className="block truncate text-[8px] text-[var(--text-secondary)]">{addressLabel(item)}</small></td><td className="px-3 py-3"><SourceBadge source={item.source} /></td><td className="px-3 py-3 text-[9px] font-semibold tabular-nums text-[var(--text-primary)]">{formatDateTime(item.startsAt)}</td><td className="px-3 py-3 text-[9px] font-semibold tabular-nums text-[var(--text-primary)]">{formatDateTime(item.endsAt)}</td><td className="px-3 py-3"><div className="flex flex-col items-start gap-1"><EntityBadge kind={item.entityKind} /><ProviderBadges providers={item.providers} /></div></td><td className="px-3 py-3"><div className="flex flex-col items-start gap-1"><StatusBadge status={item.candidateStatus} /><small className="pl-1 text-[7px] font-semibold tabular-nums text-[var(--text-secondary)]">Jistota {Math.round(item.confidence * 100)} %</small></div></td><td className="px-3 py-3 text-right"><button onClick={() => void openDetail(item)} aria-label={`Detail firmy ${item.companyName}`} className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-500/10 text-[var(--accent)]"><Eye aria-hidden size={14} /></button></td></tr>)}</tbody></table></div><div className="grid gap-2.5 lg:hidden">{filtered.map((item) => <MobileCard key={item.candidateId} item={item} onDetail={() => void openDetail(item)} />)}</div></div> : <div className="flex min-h-[300px] flex-col items-center justify-center px-5 text-center"><SearchCheck aria-hidden size={26} className="text-[var(--accent)]" /><strong className="mt-3 text-sm text-[var(--text-primary)]">{activeFilterCount ? 'Žádný výsledek neodpovídá filtrům.' : 'Zatím nebyla nalezena žádná firma.'}</strong><span className="mt-1 text-xs text-[var(--text-secondary)]">{activeFilterCount ? 'Upravte nebo zrušte aktivní filtry.' : 'Výsledky se zobrazí po dokončení vyhledávací fronty.'}</span></div>}
    </div>
    {selected && typeof document !== 'undefined' ? createPortal(<CompleteDetailPopup item={selected} detail={detail} loading={detailLoading} error={detailError} onClose={() => { setSelected(null); setDetail(null); setDetailError(null) }} />, document.body) : null}
  </section>
}
