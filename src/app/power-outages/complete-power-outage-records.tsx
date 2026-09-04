'use client'

import {
  Archive,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  CircleCheck,
  Clipboard,
  Eye,
  ExternalLink,
  FileText,
  LoaderCircle,
  MapPin,
  MessageSquareText,
  Save,
  Search,
  SearchCheck,
  Send,
  SlidersHorizontal,
  UserRound,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  CompleteCandidateStatus,
  CompleteCommunicationStatus,
  CompletePowerOutageAssignment,
  CompletePowerOutageCommunicationNote,
  CompleteEntityKind,
  CompletePowerOutageDetail,
  CompletePowerOutageListItem,
  CompletePowerOutagePageCursor,
  CompletePowerOutagePageFilters,
  CompletePowerOutageWorkspace,
} from '@/lib/power-outages/complete-types'
import type { PowerOutageSource } from '@/lib/power-outages/types'
import {
  getCompletePowerOutageDetailAction,
  getCompletePowerOutageCommunicationNotesAction,
  getCompletePowerOutagePageAction,
  releaseCompletePowerOutageAssignmentAction,
  saveCompletePowerOutageAssignmentAction,
} from './actions'
import { copyPowerOutageAnnouncement, PowerOutageAnnouncementPreview, type PowerOutageAnnouncementData } from './power-outage-announcement'
import { PowerOutageDetailRow, PowerOutagePopupShell } from './power-outage-popups'

type Tab = 'current' | 'archive'
type StatusFilter = CompletePowerOutagePageFilters['candidateStatus']

const DATE_TIME = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
})

const MOBILE_DATE = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', year: 'numeric',
})

const MOBILE_TIME = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit',
})

function formatDateTime(value: string | null) {
  if (!value) return 'Neuvedeno'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Neuvedeno' : DATE_TIME.format(date)
}

function formatMobilePeriod(startsAt: string, endsAt: string) {
  const starts = new Date(startsAt)
  const ends = new Date(endsAt)
  if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime())) return 'Termín neuveden'

  const startDate = MOBILE_DATE.format(starts)
  const endDate = MOBILE_DATE.format(ends)
  const start = `${startDate} ${MOBILE_TIME.format(starts)}`
  const end = startDate === endDate
    ? MOBILE_TIME.format(ends)
    : `${endDate} ${MOBILE_TIME.format(ends)}`

  return `${start} → ${end}`
}

function sourceLabel(source: PowerOutageSource) {
  return source === 'cez' ? 'ČEZ' : source === 'egd' ? 'EG.D' : 'PRE'
}

function entityLabel(kind: CompleteEntityKind) {
  return kind === 'registered_office' ? 'SÍDLO' : kind === 'establishment' ? 'PROVOZOVNA' : 'SÍDLO + PROVOZOVNA'
}

function statusLabel(status: CompleteCandidateStatus) {
  return ({ new: 'ANALÝZA', confirmed: 'POTVRZENO', needs_review: 'K OVĚŘENÍ', dismissed: 'ZAMÍTNUTO', stale: 'NEAKTUÁLNÍ' } as const)[status]
}

function SourceBadge({ source }: { source: PowerOutageSource }) {
  return <span className="inline-flex h-6 w-[44px] items-center justify-center whitespace-nowrap rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] px-1.5 text-[8px] font-bold uppercase tracking-[0.06em] text-[var(--accent)] lg:text-[9px] lg:tracking-[0.08em]">{sourceLabel(source)}</span>
}

function StatusBadge({ status, assignment, desktop = false }: { status: CompleteCandidateStatus; assignment?: CompletePowerOutageAssignment | null; desktop?: boolean }) {
  const tone = status === 'confirmed'
    ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-700 [html[data-theme=dark]_&]:text-emerald-300'
    : status === 'new'
      ? 'border-sky-400/45 bg-sky-400/10 text-sky-700 [html[data-theme=dark]_&]:text-sky-300'
      : status === 'needs_review'
      ? 'border-amber-400/45 bg-amber-400/10 text-amber-700 [html[data-theme=dark]_&]:text-amber-300'
      : 'border-slate-400/40 bg-slate-400/10 text-[var(--text-secondary)]'
  return <span className="relative inline-flex h-6 w-[88px] shrink-0 items-center justify-center whitespace-nowrap rounded-full">
    <span className={`inline-flex h-6 w-full items-center justify-center whitespace-nowrap rounded-full border px-2 font-bold uppercase ${desktop ? 'text-[8px] tracking-[0.07em]' : 'text-[7px] tracking-[0.045em]'} ${tone}`}>{statusLabel(status)}</span>
    {assignment ? <span title={`Záznam spravuje ${assignment.ownerName}`} className="absolute -right-2.5 -top-2.5 z-[1] inline-flex h-5 max-w-[84px] items-center rounded-full border border-white/80 bg-sky-600 px-2.5 text-[7px] font-extrabold uppercase leading-none tracking-[0.03em] text-white shadow-sm [html[data-theme=dark]_&]:border-slate-900"><span className="truncate">{assignment.ownerName}</span></span> : null}
  </span>
}

function EntityBadge({ kind, desktop = false }: { kind: CompleteEntityKind; desktop?: boolean }) {
  return <span className={`inline-flex h-6 shrink-0 items-center justify-center whitespace-nowrap rounded-full border border-violet-400/30 bg-violet-400/8 font-bold uppercase text-violet-700 [html[data-theme=dark]_&]:text-violet-300 ${desktop ? 'px-2 text-[8px] tracking-[0.04em]' : 'min-w-[72px] px-2 text-[7px] tracking-[0.04em]'}`}>{entityLabel(kind)}</span>
}

function addressLabel(item: CompletePowerOutageListItem) {
  if (item.displayAddress?.trim()) return item.displayAddress.trim()
  const number = [item.houseNumber, item.orientationNumber].filter(Boolean).join('/')
  return [item.street && `${item.street}${number ? ` ${number}` : ''}`, item.townPart].filter(Boolean).join(', ') || item.rawAddress
}

function SelectControl({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="relative min-w-0"><span className="sr-only">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-10 w-full appearance-none rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] pl-3 pr-8 text-[11px] font-medium text-[var(--text-primary)] outline-none transition focus:border-[var(--accent)]">{children}</select><ChevronDown aria-hidden size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" /></label>
}

function LoadingDetail() {
  return <div className="flex min-h-[280px] items-center justify-center"><span className="h-8 w-8 animate-spin rounded-full border-2 border-sky-500/20 border-t-sky-500" /></div>
}

function CompleteDetailPopup({ item, detail, loading, error, archived, onClose }: { item: CompletePowerOutageListItem; detail: CompletePowerOutageDetail | null; loading: boolean; error: string | null; archived: boolean; onClose: () => void }) {
  const showCezAnnouncement = detail?.source === 'cez'
    && Boolean(detail.announcementUrl)
    && !archived
  return <PowerOutagePopupShell titleId="complete-power-outage-detail" eyebrow="KOMPLETNÍ ODSTÁVKY · DETAIL FIRMY" title={item.companyName} icon={<Building2 aria-hidden size={21} />} onClose={onClose}>
    {loading ? <LoadingDetail /> : error ? <div className="m-5 rounded-2xl border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-700 [html[data-theme=dark]_&]:text-red-300">{error}</div> : detail ? <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
      <section className="rounded-2xl border border-sky-400/25 bg-sky-500/8 p-4">
        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={detail.candidateStatus} assignment={detail.assignment} /><EntityBadge kind={detail.entityKind} /><strong className="ml-auto text-xl tabular-nums text-[var(--accent)]">{Math.round(detail.confidence * 100)} %</strong></div>
        <h3 className="mt-3 text-lg font-semibold text-[var(--text-primary)]">{detail.companyName}</h3>
        <p className="mt-1 text-xs text-[var(--text-secondary)]">{detail.displayAddress || `${addressLabel(detail)}, ${detail.municipality}`}</p>
      </section>
      <section className="mt-4"><h4 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Vyhodnocení systému</h4><div className="mt-2 grid gap-2 sm:grid-cols-2"><PowerOutageDetailRow label="Výsledek" value={statusLabel(detail.candidateStatus)} /><PowerOutageDetailRow label="Jistota" value={`${Math.round(detail.confidence * 100)} %`} /><PowerOutageDetailRow label="Typ" value={entityLabel(detail.entityKind)} /><PowerOutageDetailRow label="Počet důkazů" value={String(detail.evidenceCount)} /></div>{detail.evaluationExplanations.length ? <ul className="mt-3 space-y-2">{detail.evaluationExplanations.map((text) => <li key={text} className="flex gap-2 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2 text-[10px] leading-4 text-[var(--text-primary)]"><CircleCheck aria-hidden size={13} className="mt-0.5 shrink-0 text-[var(--accent)]" />{text}</li>)}</ul> : <p className="mt-3 text-xs text-[var(--text-secondary)]">Výsledek zatím čeká na první vyhodnocení.</p>}</section>
      <section className="mt-4"><h4 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Firma a dotčená adresa</h4><div className="mt-2 grid gap-2 sm:grid-cols-2"><PowerOutageDetailRow label="IČO" value={detail.ico || 'Neuvedeno'} /><PowerOutageDetailRow label="Právní forma" value={detail.legalForm || 'Neuvedena'} /><PowerOutageDetailRow label="Obec" value={detail.municipality} /><PowerOutageDetailRow label="Adresa distributora" value={addressLabel(detail) || detail.rawAddress} /></div></section>
      <section className="mt-4"><h4 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Termín odstávky</h4><div className="mt-2 grid gap-2 sm:grid-cols-2"><PowerOutageDetailRow label="Distributor" value={sourceLabel(detail.source)} /><PowerOutageDetailRow label="Stav zdroje" value={detail.sourceStatus.toUpperCase()} /><PowerOutageDetailRow label="Termín od" value={formatDateTime(detail.startsAt)} /><PowerOutageDetailRow label="Termín do" value={formatDateTime(detail.endsAt)} /></div><div className="mt-2 flex flex-wrap items-center gap-2">{showCezAnnouncement ? <a href={detail.announcementUrl!} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 text-[10px] font-semibold text-[var(--accent)] transition hover:-translate-y-0.5 hover:border-sky-500/50 hover:bg-sky-500/15"><FileText aria-hidden size={13} />Oznámení ČEZ (PDF)<ExternalLink aria-hidden size={11} /></a> : null}{detail.sourceUrl ? <a href={detail.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 text-[10px] font-semibold text-[var(--accent)] transition hover:-translate-y-0.5 hover:border-sky-500/40">Stránka distributora <ExternalLink aria-hidden size={12} /></a> : null}</div></section>
      <section className="mt-4"><h4 className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Zdrojové důkazy</h4><div className="mt-2 space-y-2">{detail.evidence.length ? detail.evidence.map((evidence) => <article key={evidence.id} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3"><div className="flex items-center justify-between gap-3"><strong className="text-[9px] uppercase tracking-[0.08em] text-[var(--accent)]">{evidence.provider}</strong><span className="text-[10px] font-bold tabular-nums text-[var(--text-primary)]">{Math.round(evidence.confidence * 100)} %</span></div><p className="mt-1 text-[11px] font-semibold text-[var(--text-primary)]">{evidence.displayName}</p>{evidence.displayAddress ? <p className="mt-0.5 text-[9px] text-[var(--text-secondary)]">{evidence.displayAddress}</p> : null}<div className="mt-2 flex items-center justify-between gap-2 text-[8px] uppercase text-[var(--text-secondary)]"><span>{evidence.matchLevel.replaceAll('_', ' ')}</span>{evidence.sourceUrl ? <a href={evidence.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--accent)]">Zdroj <ExternalLink aria-hidden size={10} /></a> : null}</div></article>) : <p className="text-xs text-[var(--text-secondary)]">Důkazy zatím nejsou dostupné.</p>}</div></section>
    </div> : null}
  </PowerOutagePopupShell>
}

function announcementData(item: CompletePowerOutageListItem): PowerOutageAnnouncementData {
  return {
    fields: [
      { label: 'Firma / subjekt', value: item.companyName },
      ...(item.ico ? [{ label: 'IČO', value: item.ico }] : []),
      { label: 'Adresa', value: `${addressLabel(item)}, ${item.municipality}` },
      { label: 'Distributor', value: sourceLabel(item.source) },
    ],
    period: `${formatDateTime(item.startsAt)} – ${formatDateTime(item.endsAt)}`,
  }
}

function CompleteAnnouncementPopup({ item, onClose }: { item: CompletePowerOutageListItem; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const data = announcementData(item)
  const copy = async () => {
    try {
      await copyPowerOutageAnnouncement(data)
      setCopyError(null)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2_000)
    } catch {
      setCopyError('Text se nepodařilo zkopírovat. Označte jej prosím ručně.')
    }
  }

  return <PowerOutagePopupShell titleId={`complete-power-outage-announcement-${item.candidateId}`} eyebrow="KOMPLETNÍ ODSTÁVKY" title="Oznámení o odstávce" icon={<FileText aria-hidden size={21} />} onClose={onClose}>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3"><PowerOutageDetailRow label="Firma / subjekt" value={item.companyName} /><PowerOutageDetailRow label="IČO" value={item.ico || 'Neuvedeno'} /><PowerOutageDetailRow label="Distributor" value={sourceLabel(item.source)} /><PowerOutageDetailRow label="Adresa" value={`${addressLabel(item)}, ${item.municipality}`} /><PowerOutageDetailRow label="Termín od" value={formatDateTime(item.startsAt)} /><PowerOutageDetailRow label="Termín do" value={formatDateTime(item.endsAt)} /></div>
      <div className="mt-4 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-4 sm:p-5"><PowerOutageAnnouncementPreview data={data} /></div>
      {copyError ? <p className="mt-2 text-xs font-medium text-red-600 [html[data-theme=dark]_&]:text-red-300">{copyError}</p> : null}
    </div>
    <footer className="shrink-0 border-t border-[var(--surface-border)] p-4 sm:p-5"><button type="button" onClick={copy} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 text-xs font-bold uppercase text-white shadow-[0_10px_24px_var(--shadow-medium)] transition hover:-translate-y-px sm:w-auto">{copied ? <Check aria-hidden size={16} /> : <Clipboard aria-hidden size={16} />}{copied ? 'TEXT ZKOPÍROVÁN' : 'KOPÍROVAT TEXT'}</button></footer>
  </PowerOutagePopupShell>
}

const COMMUNICATION_OPTIONS: Array<{ value: CompleteCommunicationStatus; label: string }> = [
  { value: 'not_contacted', label: 'Zatím neosloveno' },
  { value: 'contacted', label: 'Kontaktováno' },
  { value: 'follow_up', label: 'Navázat komunikaci' },
  { value: 'closed', label: 'Komunikace uzavřena' },
]

function CompleteAssignmentPopup({
  item,
  currentUser,
  onClose,
  onChanged,
}: {
  item: CompletePowerOutageListItem
  currentUser: CompletePowerOutageWorkspace['currentUser']
  onClose: () => void
  onChanged: (assignment: CompletePowerOutageAssignment | null) => void
}) {
  const assignment = item.assignment
  const canEdit = !assignment || assignment.ownerId === currentUser.id
  const canRelease = Boolean(assignment && (assignment.ownerId === currentUser.id || currentUser.isAdmin))
  const [communicationStatus, setCommunicationStatus] = useState<CompleteCommunicationStatus>(assignment?.communicationStatus ?? 'not_contacted')
  const [notes, setNotes] = useState('')
  const [history, setHistory] = useState<CompletePowerOutageCommunicationNote[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void getCompletePowerOutageCommunicationNotesAction(item.candidateId).then((result) => {
      if (!active) return
      if (result.success) {
        const legacy = result.notes.length === 0 && assignment?.notes.trim()
          ? [{ id: `legacy-${item.candidateId}`, authorId: assignment.ownerId, authorName: assignment.ownerName, body: assignment.notes, createdAt: assignment.updatedAt }]
          : []
        setHistory(result.notes.length ? result.notes : legacy)
        setHistoryError(null)
      } else {
        setHistoryError(result.error)
      }
      setHistoryLoading(false)
    })
    return () => { active = false }
  }, [assignment, item.candidateId])

  const save = async () => {
    setSaving(true); setError(null)
    const result = await saveCompletePowerOutageAssignmentAction({ candidateId: item.candidateId, communicationStatus, notes })
    setSaving(false)
    if (!result.success) { setError(result.error); return }
    onChanged(result.assignment)
    onClose()
  }
  const release = async () => {
    setSaving(true); setError(null)
    const result = await releaseCompletePowerOutageAssignmentAction(item.candidateId)
    setSaving(false)
    if (!result.success) { setError(result.error); return }
    onChanged(null)
    onClose()
  }

  return <PowerOutagePopupShell titleId={`complete-power-outage-assignment-${item.candidateId}`} eyebrow="KOMPLETNÍ ODSTÁVKY" title="Správa komunikace" icon={<MessageSquareText aria-hidden size={21} />} onClose={onClose}>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 [scrollbar-gutter:stable] sm:p-5">
      <section className="rounded-2xl border border-sky-400/25 bg-sky-500/8 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="truncate text-base font-semibold text-[var(--text-primary)]">{item.companyName}</h3><p className="mt-1 truncate text-[10px] text-[var(--text-secondary)]">{item.municipality} · {addressLabel(item)}</p></div>
          <StatusBadge status={item.candidateStatus} assignment={assignment} />
        </div>
        <div className="mt-3 flex items-center gap-2 text-[10px] text-[var(--text-secondary)]"><UserRound aria-hidden size={14} className="text-[var(--accent)]" /><span>{assignment ? <>Záznam spravuje <strong className="text-[var(--text-primary)]">{assignment.ownerName}</strong></> : <>Záznam zatím nemá vlastníka. Uložením si jej převezmete.</>}</span></div>
      </section>

      {!canEdit ? <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-400/10 p-3 text-[11px] leading-5 text-amber-800 [html[data-theme=dark]_&]:text-amber-200">Poznámku může upravovat její vlastník. Administrátor může přiřazení uvolnit.</div> : null}
      <section className="mt-4"><h4 className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Historie komunikace</h4>
        {historyLoading ? <div className="mt-2 flex min-h-20 items-center justify-center rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)]"><LoaderCircle aria-label="Načítání historie" size={17} className="animate-spin text-[var(--accent)]" /></div>
          : historyError ? <p className="mt-2 rounded-2xl border border-red-400/30 bg-red-400/10 p-3 text-[10px] text-red-700 [html[data-theme=dark]_&]:text-red-300">{historyError}</p>
            : history.length ? <div className="mt-2 space-y-2">{history.map((entry) => <article key={entry.id} className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3"><div className="flex items-center justify-between gap-3"><strong className="truncate text-[10px] text-[var(--text-primary)]">{entry.authorName}</strong><time dateTime={entry.createdAt} className="shrink-0 text-[8px] tabular-nums text-[var(--text-secondary)]">{formatDateTime(entry.createdAt)}</time></div><p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-5 text-[var(--text-primary)]">{entry.body}</p></article>)}</div>
              : <p className="mt-2 rounded-2xl border border-dashed border-[var(--surface-border)] bg-[var(--surface-muted)] p-4 text-center text-[10px] text-[var(--text-secondary)]">Zatím nebyla zapsána žádná poznámka.</p>}
      </section>
      <label className="mt-4 block"><span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Stav komunikace</span><span className="relative mt-2 block h-11 overflow-hidden rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-strong)] transition focus-within:border-[var(--accent)]"><select disabled={!canEdit || saving} value={communicationStatus} onChange={(event) => setCommunicationStatus(event.target.value as CompleteCommunicationStatus)} className="h-full w-full appearance-none rounded-2xl border-0 bg-transparent py-0 pl-3 pr-10 text-xs font-medium text-[var(--text-primary)] outline-none disabled:opacity-60">{COMMUNICATION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown aria-hidden size={15} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" /></span></label>
      <label className="mt-4 block"><span className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Přidat poznámku</span><textarea disabled={!canEdit || saving} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={10_000} rows={5} placeholder="Zapište průběh komunikace nebo důležité informace…" className="mt-2 w-full resize-y rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-strong)] p-3 text-xs leading-5 text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:border-[var(--accent)] disabled:opacity-60" /><span className="mt-1 block text-right text-[8px] tabular-nums text-[var(--text-secondary)]">{notes.length} / 10 000</span></label>
      {error ? <p className="mt-3 rounded-xl border border-red-400/30 bg-red-400/10 p-3 text-[10px] font-medium text-red-700 [html[data-theme=dark]_&]:text-red-300">{error}</p> : null}
    </div>
    <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-[var(--surface-border)] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      {canRelease ? <button type="button" disabled={saving} onClick={() => void release()} className="inline-flex h-11 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-4 text-[9px] font-bold uppercase text-[var(--text-secondary)] transition hover:-translate-y-px hover:text-[var(--text-primary)] disabled:opacity-60">Uvolnit záznam</button> : <span />}
      {canEdit ? <button type="button" disabled={saving} onClick={() => void save()} className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 text-[9px] font-bold uppercase text-white shadow-[0_10px_24px_var(--shadow-medium)] transition hover:-translate-y-px disabled:translate-y-0 disabled:opacity-60">{saving ? <LoaderCircle aria-hidden size={15} className="animate-spin" /> : <Save aria-hidden size={15} />}{assignment ? 'Uložit změny' : 'Převzít a uložit'}</button> : null}
    </footer>
  </PowerOutagePopupShell>
}

function MobileCard({ item, onDetail, onAnnouncement, onAssignment }: { item: CompletePowerOutageListItem; onDetail: () => void; onAnnouncement: () => void; onAssignment: () => void }) {
  const actionClass = 'inline-flex h-8 min-w-0 items-center justify-center gap-1 rounded-xl border border-sky-400/20 bg-sky-500/10 px-2 text-[7px] font-bold uppercase tracking-[0.035em] text-[var(--accent)] transition hover:-translate-y-px hover:border-sky-400/35 hover:bg-sky-500/20'
  return <article className="power-outages-mobile-card weather-alerts__record-surface min-w-0 rounded-[18px] border px-3 py-2.5"><div className="flex min-w-0 items-start justify-between gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-[var(--accent)]"><Building2 aria-hidden size={14} /></span><div className="flex min-w-0 flex-nowrap justify-end gap-1"><SourceBadge source={item.source} /><StatusBadge status={item.candidateStatus} assignment={item.assignment} /></div></div><div className="mt-1.5 flex min-w-0 items-baseline gap-2"><strong className="min-w-0 truncate text-[13px] text-[var(--text-primary)]">{item.companyName}</strong>{item.ico ? <small className="shrink-0 text-[8px] font-semibold text-[var(--text-secondary)]">IČO {item.ico}</small> : null}</div><p className="mt-1 flex min-w-0 items-center gap-1.5 text-[10px]"><MapPin aria-hidden size={11} className="shrink-0 text-[var(--text-secondary)]" /><strong className="shrink-0 text-[var(--text-primary)]">{item.municipality}</strong><span className="truncate text-[var(--text-secondary)]">· {addressLabel(item)}</span></p><strong className="mt-1.5 block min-w-0 truncate text-[10.5px] font-bold tabular-nums text-[var(--text-primary)]">{formatMobilePeriod(item.startsAt, item.endsAt)}</strong><div className="mt-2 grid min-w-0 grid-cols-3 gap-1.5"><button type="button" onClick={onAssignment} aria-label="Správa komunikace" title="Správa komunikace" className={actionClass}><MessageSquareText aria-hidden size={11} className="shrink-0" /><span className="truncate">Komunikace</span></button><button type="button" onClick={onDetail} aria-label="Detail odstávky" title="Detail odstávky" className={actionClass}><Eye aria-hidden size={12} className="shrink-0" /><span>Detail</span></button><button type="button" onClick={onAnnouncement} aria-label="Oznámení o odstávce" title="Oznámení o odstávce" className={actionClass}><Send aria-hidden size={11} className="shrink-0" /><span className="truncate">Oznámení</span></button></div></article>
}

export function CompletePowerOutageRecords({ workspace }: { workspace: CompletePowerOutageWorkspace }) {
  const [tab, setTab] = useState<Tab>('current')
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [owner, setOwner] = useState('all')
  const [source, setSource] = useState<'all' | PowerOutageSource>('all')
  const [entity, setEntity] = useState<'all' | CompleteEntityKind>('all')
  const [status, setStatus] = useState<StatusFilter>('visible')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [selected, setSelected] = useState<CompletePowerOutageListItem | null>(null)
  const [popupMode, setPopupMode] = useState<'detail' | 'announcement' | 'assignment' | null>(null)
  const [assignmentOverrides, setAssignmentOverrides] = useState<Record<string, CompletePowerOutageAssignment | null>>({})
  const [detail, setDetail] = useState<CompletePowerOutageDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [pageItems, setPageItems] = useState(workspace.initialPage.items)
  const [totalCount, setTotalCount] = useState(workspace.initialPage.totalCount)
  const [hasMore, setHasMore] = useState(workspace.initialPage.hasMore)
  const [pageLoading, setPageLoading] = useState(false)
  const [pageError, setPageError] = useState<string | null>(workspace.initialPageError)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const requestSequence = useRef(0)
  const initialized = useRef(false)
  const loadingRef = useRef(false)
  const nextCursorRef = useRef<CompletePowerOutagePageCursor | null>(workspace.initialPage.nextCursor)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [query])

  const pageFilters = useMemo<CompletePowerOutagePageFilters>(() => ({
    mode: tab,
    query: debouncedQuery,
    owner,
    source,
    entityKind: entity,
    candidateStatus: status,
  }), [debouncedQuery, entity, owner, source, status, tab])
  const filterKey = useMemo(() => JSON.stringify(pageFilters), [pageFilters])

  const loadPage = useCallback(async (reset: boolean) => {
    if (loadingRef.current && !reset) return
    const sequence = ++requestSequence.current
    loadingRef.current = true
    setPageLoading(true)
    setPageError(null)
    if (reset) {
      setPageItems([])
      setTotalCount(0)
      nextCursorRef.current = null
      setHasMore(false)
      scrollContainerRef.current?.scrollTo({ top: 0 })
    }
    const cursor = reset ? null : nextCursorRef.current
    const result = await getCompletePowerOutagePageAction({ filters: pageFilters, cursor })
    if (sequence !== requestSequence.current) return
    loadingRef.current = false
    setPageLoading(false)
    if (!result.success) {
      setPageError(result.error)
      return
    }
    setPageItems((current) => {
      if (reset) return result.page.items
      const known = new Set(current.map((item) => item.candidateId))
      return [...current, ...result.page.items.filter((item) => !known.has(item.candidateId))]
    })
    setTotalCount(result.page.totalCount)
    nextCursorRef.current = result.page.nextCursor
    setHasMore(result.page.hasMore)
  }, [pageFilters])

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      if (!workspace.initialPageError) return
    }
    requestSequence.current += 1
    loadingRef.current = false
    const timeout = window.setTimeout(() => void loadPage(true), 0)
    return () => window.clearTimeout(timeout)
  }, [filterKey, loadPage, workspace.initialPageError])

  useEffect(() => {
    const target = loadMoreRef.current
    const root = scrollContainerRef.current
    if (!target || !root || !hasMore || pageLoading || pageError) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadPage(false)
    }, { root, rootMargin: '180px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [hasMore, loadPage, pageError, pageLoading])

  const records = useMemo(() => pageItems.map((item) => (
    Object.hasOwn(assignmentOverrides, item.candidateId)
      ? { ...item, assignment: assignmentOverrides[item.candidateId] }
      : item
  )), [assignmentOverrides, pageItems])
  const activeFilterCount = [query.trim(), owner !== 'all', source !== 'all', entity !== 'all', status !== 'visible'].filter(Boolean).length
  const openDetail = async (item: CompletePowerOutageListItem) => {
    setSelected(item); setPopupMode('detail'); setDetail(null); setDetailError(null); setDetailLoading(true)
    const result = await getCompletePowerOutageDetailAction(item.candidateId)
    if (result.success) setDetail(result.detail); else setDetailError(result.error)
    setDetailLoading(false)
  }
  const openAnnouncement = (item: CompletePowerOutageListItem) => {
    setSelected(item); setPopupMode('announcement'); setDetail(null); setDetailError(null); setDetailLoading(false)
  }
  const openAssignment = (item: CompletePowerOutageListItem) => {
    setSelected(item); setPopupMode('assignment'); setDetail(null); setDetailError(null); setDetailLoading(false)
  }
  const updateAssignment = (candidateId: string, assignment: CompletePowerOutageAssignment | null) => {
    setAssignmentOverrides((current) => ({ ...current, [candidateId]: assignment }))
  }
  const closePopup = () => { setSelected(null); setPopupMode(null); setDetail(null); setDetailError(null); setDetailLoading(false) }
  const clear = () => { setQuery(''); setOwner('all'); setSource('all'); setEntity('all'); setStatus('visible') }
  return <section className="activities-page__panel min-w-0 rounded-[28px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5 xl:col-span-3 xl:flex xl:h-0 xl:min-h-full xl:flex-col xl:overflow-hidden">
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center xl:grid-cols-[175px_minmax(0,1fr)_160px] xl:gap-2">
      <div className="min-w-0 lg:contents">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <div className="flex min-w-0 items-center justify-between gap-2 lg:block">
            <span className="text-[7px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)] min-[360px]:text-[9px] min-[360px]:tracking-[0.13em] lg:text-[10px] lg:tracking-[0.14em]">Databáze firem</span>
            <div className="weather-alerts__record-surface grid h-8 w-[106px] shrink-0 grid-cols-2 rounded-xl border p-0.5 min-[360px]:h-9 min-[360px]:w-[122px] lg:hidden">
              <button type="button" onClick={() => setTab('current')} aria-pressed={tab === 'current'} className={`rounded-[10px] px-1 text-[6px] font-bold uppercase transition min-[360px]:text-[7px] ${tab === 'current' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>Aktuální</button>
              <button type="button" onClick={() => setTab('archive')} aria-pressed={tab === 'archive'} className={`rounded-[10px] px-1 text-[6px] font-bold uppercase transition min-[360px]:text-[7px] ${tab === 'archive' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>Archiv</button>
            </div>
          </div>
          <h2 className="mt-1 whitespace-nowrap text-xl font-semibold text-[var(--text-primary)]">Přehled odstávek</h2>
        </div>
        <div className="weather-alerts__record-surface hidden h-12 shrink-0 grid-cols-2 rounded-2xl border p-1 lg:col-start-2 lg:row-start-1 lg:grid xl:col-start-3">
          <button type="button" onClick={() => setTab('current')} aria-pressed={tab === 'current'} className={`rounded-xl px-5 text-[10px] font-bold uppercase transition xl:px-3 ${tab === 'current' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>Aktuální</button>
          <button type="button" onClick={() => setTab('archive')} aria-pressed={tab === 'archive'} className={`rounded-xl px-5 text-[10px] font-bold uppercase transition xl:px-3 ${tab === 'archive' ? 'bg-[var(--surface-strong)] text-[var(--accent)] shadow-sm' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>Archiv</button>
        </div>
      </div>
      <div className="weather-alerts__record-surface rounded-[22px] border p-1 lg:col-span-2 lg:col-start-1 lg:row-start-2 lg:p-1.5 xl:col-span-1 xl:col-start-2 xl:row-start-1">
        <button type="button" onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen} aria-controls="complete-power-outage-mobile-filters" className="flex h-8 w-full items-center gap-2 rounded-xl px-2.5 text-left text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)] transition hover:bg-[var(--surface-muted)] lg:hidden"><SlidersHorizontal aria-hidden size={14} className="shrink-0 text-[var(--accent)]" /><span className="flex-1">Filtry</span>{activeFilterCount ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-500 px-1.5 text-[8px] text-white">{activeFilterCount}</span> : null}<ChevronDown aria-hidden size={14} className={`shrink-0 transition-transform ${filtersOpen ? 'rotate-180' : ''}`} /></button>
        <div id="complete-power-outage-mobile-filters" className={`${filtersOpen ? 'grid' : 'hidden'} mt-1.5 gap-2 p-1 sm:grid-cols-2 lg:mt-0 lg:grid lg:p-0 xl:grid-cols-[minmax(120px,1.35fr)_repeat(4,minmax(82px,1fr))] xl:gap-1.5`}>
          <label className="relative min-w-0 sm:col-span-2 xl:col-span-1"><span className="sr-only">Vyhledat odstávku</span><Search aria-hidden size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-secondary)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Firma, IČO, město nebo ulice…" className="h-10 w-full rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] pl-9 pr-8 text-[11px] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:border-[var(--accent)]" />{query ? <button type="button" onClick={() => setQuery('')} aria-label="Vymazat hledání" className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-[var(--surface-muted)] hover:text-[var(--text-primary)]"><X aria-hidden size={13} /></button> : null}</label>
          <SelectControl label="Vlastník" value={owner} onChange={setOwner}><option value="all">Všichni vlastníci</option><option value="mine">Moje záznamy</option><option value="unassigned">Nepřiřazené</option>{workspace.filters.owners.filter((value) => value.id !== workspace.currentUser.id).map((value) => <option key={value.id} value={`user:${value.id}`}>{value.name}</option>)}</SelectControl>
          <SelectControl label="Distributor" value={source} onChange={(value) => setSource(value as typeof source)}><option value="all">Všichni distributoři</option><option value="cez">ČEZ</option><option value="egd">EG.D</option><option value="pre">PRE</option></SelectControl>
          <SelectControl label="Typ" value={entity} onChange={(value) => setEntity(value as typeof entity)}><option value="all">Všechny typy</option><option value="registered_office">Sídla</option><option value="establishment">Provozovny</option><option value="mixed">Sídla + provozovny</option></SelectControl>
          <SelectControl label="Stav" value={status} onChange={(value) => setStatus(value as StatusFilter)}><option value="visible">Běžné výsledky</option><option value="confirmed">Potvrzené</option><option value="needs_review">K ověření</option><option value="dismissed">Zamítnuté</option></SelectControl>
        </div>
        {activeFilterCount ? <button type="button" onClick={clear} className={`${filtersOpen ? 'inline-flex' : 'hidden'} mb-1 ml-1 mt-2 h-8 items-center gap-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-3 text-[8px] font-bold uppercase tracking-[0.05em] text-[var(--text-secondary)] lg:hidden`}><X aria-hidden size={12} /> Zrušit filtry</button> : null}
      </div>
    </div>
    <div className="power-outages-records-shell weather-alerts__record-surface mt-3 overflow-visible rounded-[22px] border lg:overflow-hidden xl:flex xl:min-h-0 xl:flex-1 xl:flex-col"><div className="hidden h-11 items-center justify-between border-b border-[var(--surface-border)] px-4 lg:flex"><h3 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">{tab === 'current' ? <CalendarDays aria-hidden size={14} className="text-[var(--accent)]" /> : <Archive aria-hidden size={14} className="text-[var(--accent)]" />}{tab === 'current' ? 'Aktuální firmy v odstávkách' : 'Archiv firem v odstávkách'}</h3><span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-[var(--surface-border)] bg-[var(--surface-strong)] px-2 text-[9px] font-bold text-[var(--text-secondary)]">{totalCount}</span></div>
      {records.length ? <div ref={scrollContainerRef} className="-mx-2 max-h-[610px] overflow-y-auto px-2 py-1 lg:mx-0 lg:max-h-[500px] lg:px-0 lg:py-0 xl:min-h-0 xl:max-h-none xl:flex-1">
        <div className="hidden lg:block"><table className="w-full table-fixed border-collapse text-left">
          <thead className="power-outages-table__header sticky top-0 z-10 shadow-[0_1px_0_var(--surface-border)]"><tr className="text-[8px] font-bold uppercase tracking-[0.09em] text-[var(--text-secondary)]"><th className="w-[17%] px-3 py-2.5">Firma / subjekt</th><th className="w-[16%] px-3 py-2.5">Adresa</th><th className="w-[8%] px-3 py-2.5">Distributor</th><th className="w-[14%] px-3 py-2.5">Termín od</th><th className="w-[14%] px-3 py-2.5">Termín do</th><th className="w-[22%] px-3 py-2.5">Stav</th><th className="w-[9%] px-3 py-2.5 text-right">Akce</th></tr></thead>
          <tbody className="divide-y divide-[var(--surface-border)]">{records.map((item) => <tr key={item.candidateId} className="group transition-colors hover:bg-[var(--surface-muted)]">
            <td className="px-3 py-3 align-middle"><div className="flex min-w-0 items-center gap-2.5"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-[var(--accent)]"><Building2 aria-hidden size={14} /></span><span className="min-w-0"><strong className="block truncate text-[11px] text-[var(--text-primary)]">{item.companyName}</strong><small className="block truncate text-[9px] font-semibold text-[var(--text-secondary)]">{item.ico ? `IČO ${item.ico}` : 'IČO neuvedeno'}</small></span></div></td>
            <td className="px-3 py-3 align-middle"><strong className="block truncate text-[10px] text-[var(--text-primary)]">{item.municipality}</strong><small className="block truncate text-[9px] text-[var(--text-secondary)]">{addressLabel(item)}</small></td>
            <td className="px-3 py-3 align-middle"><SourceBadge source={item.source} /></td>
            <td className="px-3 py-3 align-middle text-[10px] font-semibold tabular-nums text-[var(--text-primary)]">{formatDateTime(item.startsAt)}</td>
            <td className="px-3 py-3 align-middle text-[10px] font-semibold tabular-nums text-[var(--text-primary)]">{formatDateTime(item.endsAt)}</td>
            <td className="py-3 pl-3 pr-0 align-middle"><div className="flex items-center justify-between gap-2"><StatusBadge status={item.candidateStatus} assignment={item.assignment} desktop /><button type="button" onClick={() => openAssignment(item)} aria-label={`Správa komunikace pro firmu ${item.companyName}`} title="Správa komunikace" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-500/10 text-[var(--accent)] transition hover:-translate-y-px hover:border-sky-400/35 hover:bg-sky-500/20"><MessageSquareText aria-hidden size={13} /></button></div></td>
            <td className="py-3 pl-1.5 pr-3 align-middle"><div className="flex justify-end gap-1.5"><button type="button" onClick={() => void openDetail(item)} aria-label={`Otevřít detail odstávky pro firmu ${item.companyName}`} title="Detail odstávky" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-500/10 text-[var(--accent)] transition hover:-translate-y-px hover:border-sky-400/35 hover:bg-sky-500/20"><Eye aria-hidden size={14} /></button><button type="button" onClick={() => openAnnouncement(item)} aria-label={`Vytvořit oznámení o odstávce pro firmu ${item.companyName}`} title="Oznámení o odstávce" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-sky-400/20 bg-sky-500/10 text-[var(--accent)] transition hover:-translate-y-px hover:border-sky-400/35 hover:bg-sky-500/20"><Send aria-hidden size={13} /></button></div></td>
          </tr>)}</tbody>
        </table></div>
        <div className="grid gap-2.5 lg:hidden">{records.map((item) => <MobileCard key={item.candidateId} item={item} onDetail={() => void openDetail(item)} onAnnouncement={() => openAnnouncement(item)} onAssignment={() => openAssignment(item)} />)}</div>
        <div ref={loadMoreRef} className="flex min-h-14 items-center justify-center px-4 py-3">
          {pageLoading ? <span className="inline-flex items-center gap-2 text-[10px] font-semibold text-[var(--text-secondary)]"><LoaderCircle aria-hidden size={15} className="animate-spin text-[var(--accent)]" /> Načítám další záznamy…</span> : pageError ? <div className="flex flex-wrap items-center justify-center gap-2 text-center"><span className="text-[10px] font-medium text-red-600 [html[data-theme=dark]_&]:text-red-300">{pageError}</span><button type="button" onClick={() => void loadPage(false)} className="h-8 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-strong)] px-3 text-[8px] font-bold uppercase text-[var(--accent)] transition hover:-translate-y-px">Zkusit znovu</button></div> : hasMore ? <span className="text-[9px] text-[var(--text-secondary)]">Další záznamy se načtou automaticky.</span> : <span className="text-[9px] text-[var(--text-secondary)]">Zobrazeny všechny výsledky.</span>}
        </div>
      </div> : pageLoading ? <div className="flex min-h-[300px] items-center justify-center"><span className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--text-secondary)]"><LoaderCircle aria-hidden size={18} className="animate-spin text-[var(--accent)]" /> Načítám výsledky…</span></div> : pageError ? <div className="flex min-h-[300px] flex-col items-center justify-center px-5 text-center"><SearchCheck aria-hidden size={26} className="text-red-500" /><strong className="mt-3 text-sm text-[var(--text-primary)]">Výsledky se nepodařilo načíst.</strong><span className="mt-1 max-w-lg text-xs text-[var(--text-secondary)]">{pageError}</span><button type="button" onClick={() => void loadPage(true)} className="mt-4 h-9 rounded-xl bg-[var(--accent)] px-4 text-[9px] font-bold uppercase text-white transition hover:-translate-y-px">Zkusit znovu</button></div> : <div className="flex min-h-[300px] flex-col items-center justify-center px-5 text-center"><SearchCheck aria-hidden size={26} className="text-[var(--accent)]" /><strong className="mt-3 text-sm text-[var(--text-primary)]">{activeFilterCount ? 'Žádný výsledek neodpovídá filtrům.' : 'Zatím nebyla nalezena žádná vyhodnocená firma.'}</strong><span className="mt-1 text-xs text-[var(--text-secondary)]">{activeFilterCount ? 'Upravte nebo zrušte aktivní filtry.' : 'Nezpracované kandidáty systém skryje; výsledky se objeví až po vyhodnocení.'}</span></div>}
    </div>
    {selected && popupMode && typeof document !== 'undefined' ? createPortal(
      popupMode === 'detail'
        ? <CompleteDetailPopup item={selected} detail={detail} loading={detailLoading} error={detailError} archived={tab === 'archive'} onClose={closePopup} />
        : popupMode === 'announcement'
          ? <CompleteAnnouncementPopup item={selected} onClose={closePopup} />
          : <CompleteAssignmentPopup item={selected} currentUser={workspace.currentUser} onClose={closePopup} onChanged={(assignment) => updateAssignment(selected.candidateId, assignment)} />,
      document.body,
    ) : null}
  </section>
}
