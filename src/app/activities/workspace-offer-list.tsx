'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Building2, CalendarDays, ChevronRight, CircleDollarSign, Clock3, ExternalLink, FileText, Layers3, UserRound, X } from 'lucide-react'
import { OfferPdfLink } from '@/app/offers/offer-pdf-link'
import { formatCurrency } from '@/lib/offers/calculations'
import type { ActivityWorkspaceOffer, ActivityWorkspaceOfferDetail } from '@/lib/activities/workspace-types'
import { getWorkspaceOfferDetailAction } from './workspace-offer-actions'

const PRAGUE_TIME_ZONE = 'Europe/Prague'

type PreviewAnchor = { top: number; right: number; bottom: number; left: number }

const STATUS_PRESENTATION = {
  draft: { label: 'Koncept', badge: "bg-slate-100 text-slate-700 [html[data-theme='dark']_&]:bg-slate-400/15 [html[data-theme='dark']_&]:text-slate-200", icon: "bg-slate-500/15 text-slate-600 [html[data-theme='dark']_&]:text-slate-300" },
  submitted: { label: 'Ke schválení', badge: "bg-sky-100 text-sky-700 [html[data-theme='dark']_&]:bg-sky-400/15 [html[data-theme='dark']_&]:text-sky-200", icon: "bg-emerald-500/12 text-emerald-600 [html[data-theme='dark']_&]:text-emerald-300" },
  changes_requested: { label: 'Vráceno k úpravě', badge: "bg-amber-100 text-amber-700 [html[data-theme='dark']_&]:bg-amber-400/15 [html[data-theme='dark']_&]:text-amber-200", icon: "bg-amber-500/15 text-amber-600 [html[data-theme='dark']_&]:text-amber-300" },
  approved: { label: 'Schváleno', badge: "bg-emerald-100 text-emerald-700 [html[data-theme='dark']_&]:bg-emerald-400/15 [html[data-theme='dark']_&]:text-emerald-200", icon: "bg-emerald-500/15 text-emerald-600 [html[data-theme='dark']_&]:text-emerald-300" },
  sent_to_client: { label: 'Odesláno klientovi', badge: "bg-sky-100 text-sky-700 [html[data-theme='dark']_&]:bg-sky-400/15 [html[data-theme='dark']_&]:text-sky-200", icon: "bg-sky-500/15 text-sky-600 [html[data-theme='dark']_&]:text-sky-300" },
  in_progress: { label: 'V řešení', badge: "bg-orange-100 text-orange-700 [html[data-theme='dark']_&]:bg-orange-400/15 [html[data-theme='dark']_&]:text-orange-200", icon: "bg-orange-500/15 text-orange-600 [html[data-theme='dark']_&]:text-orange-300" },
  ordered: { label: 'Objednáno', badge: "bg-emerald-100 text-emerald-700 [html[data-theme='dark']_&]:bg-emerald-400/15 [html[data-theme='dark']_&]:text-emerald-200", icon: "bg-emerald-500/15 text-emerald-600 [html[data-theme='dark']_&]:text-emerald-300" },
  rejected: { label: 'Zamítnuto', badge: "bg-rose-100 text-rose-700 [html[data-theme='dark']_&]:bg-rose-400/15 [html[data-theme='dark']_&]:text-rose-200", icon: "bg-rose-500/15 text-rose-600 [html[data-theme='dark']_&]:text-rose-300" },
  realizace: { label: 'Realizace', badge: "bg-violet-100 text-violet-700 [html[data-theme='dark']_&]:bg-violet-400/15 [html[data-theme='dark']_&]:text-violet-200", icon: "bg-violet-500/15 text-violet-600 [html[data-theme='dark']_&]:text-violet-300" },
} as const

function formatDate(value: string | null, includeTime = false) {
  if (!value) return 'Neuvedeno'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Neuvedeno'
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', ...(includeTime ? { timeStyle: 'short' as const } : {}), timeZone: PRAGUE_TIME_ZONE }).format(date)
}

function OfferMetaItem({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return <div className="flex min-w-0 items-start gap-2 sm:gap-2.5"><Icon aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)] sm:h-[15px] sm:w-[15px]" /><div className="min-w-0"><p className="text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)] sm:text-[9px] sm:tracking-[0.1em]">{label}</p><p className="mt-0.5 break-words text-[11px] font-semibold leading-4 text-[var(--text-primary)] sm:text-xs">{value}</p></div></div>
}

function OfferPreview({ summary, anchor, triggerRef, onClose }: { summary: ActivityWorkspaceOffer; anchor: PreviewAnchor; triggerRef: RefObject<HTMLButtonElement | null>; onClose: () => void }) {
  const shellRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [detail, setDetail] = useState<ActivityWorkspaceOfferDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(false)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))

  const loadDetail = useCallback(async () => {
    setLoading(true)
    const result = await getWorkspaceOfferDetailAction(summary.id)
    if (result.success && result.offer) { setDetail(result.offer); setLoadError(null) }
    else setLoadError(result.error ?? 'Detail nabídky se nepodařilo načíst.')
    setLoading(false)
  }, [summary.id])

  const requestClose = useCallback(() => {
    if (closing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return }
    setClosing(true)
    closeTimerRef.current = window.setTimeout(onClose, 150)
  }, [closing, onClose])

  useEffect(() => { let active = true; void getWorkspaceOfferDetailAction(summary.id).then((result) => { if (!active) return; if (result.success && result.offer) { setDetail(result.offer); setLoadError(null) } else setLoadError(result.error ?? 'Detail nabídky se nepodařilo načíst.'); setLoading(false) }); return () => { active = false } }, [summary.id])
  useEffect(() => {
    function resize() { setViewport({ width: window.innerWidth, height: window.innerHeight }) }
    function outside(event: PointerEvent) { if (!shellRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) requestClose() }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') requestClose() }
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus())
    window.addEventListener('resize', resize); document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', resize); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [requestClose, triggerRef])
  useEffect(() => () => { if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current) }, [])

  const mobile = viewport.width < 640
  const width = Math.min(470, viewport.width - 24)
  const maxHeight = Math.min(640, viewport.height - 24)
  const left = Math.min(Math.max(12, anchor.left), Math.max(12, viewport.width - width - 12))
  const top = Math.min(Math.max(12, anchor.bottom + 8), Math.max(12, viewport.height - maxHeight - 12))
  const positionStyle: CSSProperties = mobile ? { top: '50%', right: 12, left: 12, maxHeight: 'calc(100dvh - 24px)', transform: 'translateY(-50%)' } : { top, left, width, maxHeight }
  const current = detail ?? summary
  const presentation = STATUS_PRESENTATION[current.status]

  return <section ref={shellRef} className={`activities-manual-preview activities-page__panel fixed z-[142] flex flex-col overflow-hidden rounded-[24px] border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.98)_0%,rgba(247,250,252,0.96)_52%,rgba(237,244,249,0.95)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_24px_58px_rgba(15,23,42,0.24)] backdrop-blur-[16px] ${mobile ? 'activities-manual-preview--mobile' : ''} ${closing ? 'activities-manual-preview--closing' : ''}`} style={positionStyle} role="dialog" aria-modal="false" aria-labelledby={`offer-preview-${summary.id}`}>
    <header className="activities-manual-preview__header flex shrink-0 items-start justify-between gap-4 border-b border-[var(--surface-border)] px-5 py-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${presentation.badge}`}>{presentation.label}</span>{detail ? <span className="rounded-full bg-[var(--surface-muted)] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)]">Verze {detail.currentVersion}</span> : null}</div><h3 id={`offer-preview-${summary.id}`} className="mt-2.5 break-words text-lg font-semibold leading-6 text-[var(--text-primary)]">{current.offerNumber}</h3><p className="mt-1 break-words text-xs text-[var(--text-secondary)]">{current.title}</p></div><button ref={closeRef} type="button" onClick={requestClose} aria-label="Zavřít náhled nabídky" className="activities-manual-preview__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] shadow-sm transition hover:-translate-y-px hover:border-[#9dc7e5] hover:text-[var(--text-primary)]"><X aria-hidden size={16} /></button></header>
    <div className="activities-manual-preview__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{loading ? <div className="space-y-3" aria-label="Načítám detail nabídky"><div className="h-28 animate-pulse rounded-2xl bg-[var(--surface-muted)]" /><div className="h-36 animate-pulse rounded-2xl bg-[var(--surface-muted)]" /></div> : loadError ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700"><p>{loadError}</p><button type="button" onClick={() => void loadDetail()} className="mt-3 text-[10px] font-bold uppercase underline">Zkusit znovu</button></div> : detail ? <div className="space-y-4">
      <div className="activities-manual-preview__meta grid grid-cols-2 gap-x-2 gap-y-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3 sm:gap-3 sm:p-3.5"><OfferMetaItem icon={Building2} label="Klient" value={detail.clientName ?? 'Bez klienta'} /><OfferMetaItem icon={UserRound} label="Autor" value={detail.authorName} /><OfferMetaItem icon={Layers3} label="Typ nabídky" value={detail.offerType === 'bsafe24' ? 'B-SAFE24' : 'Klasická'} /><OfferMetaItem icon={FileText} label="Položky" value={`${detail.itemCount}`} /><OfferMetaItem icon={CalendarDays} label="Platnost" value={formatDate(detail.validUntil)} /><OfferMetaItem icon={Clock3} label="Poslední úprava" value={`${formatDate(detail.updatedAt, true)}${detail.lastEditorName ? ` · ${detail.lastEditorName}` : ''}`} /></div>
      <section><h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]"><CircleDollarSign aria-hidden size={13} /> Hodnota nabídky</h4><div className="mt-2 grid grid-cols-2 gap-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5"><div><p className="text-[9px] font-bold uppercase text-[var(--text-secondary)]">Bez DPH</p><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{formatCurrency(detail.subtotalWithoutVat, detail.currency)}</p></div><div><p className="text-[9px] font-bold uppercase text-[var(--text-secondary)]">S DPH</p><p className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{formatCurrency(detail.totalWithVat, detail.currency)}</p></div></div></section>
      {detail.internalNote ? <section><h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Interní poznámka</h4><div className="activities-manual-preview__content mt-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-4 py-3.5"><p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-primary)]">{detail.internalNote}</p></div></section> : null}
      {detail.status === 'submitted' ? <section><h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Schvalování</h4><div className="mt-2 rounded-2xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-xs text-sky-800 [html[data-theme='dark']_&]:border-sky-400/20 [html[data-theme='dark']_&]:bg-sky-400/10 [html[data-theme='dark']_&]:text-sky-200"><p>Odeslaná verze: <strong>{detail.submittedVersion ?? detail.currentVersion}</strong></p><p className="mt-1">Odesláno: <strong>{formatDate(detail.submittedAt, true)}</strong></p></div></section> : null}
      {detail.rejectionComment ? <section><h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-700 [html[data-theme='dark']_&]:text-amber-200">Komentář k vrácení</h4><div className="mt-2 rounded-2xl border border-amber-200 bg-amber-50/80 px-4 py-3 [html[data-theme='dark']_&]:border-amber-400/20 [html[data-theme='dark']_&]:bg-amber-400/10"><p className="whitespace-pre-wrap text-sm text-amber-900 [html[data-theme='dark']_&]:text-amber-100">{detail.rejectionComment}</p></div></section> : null}
      {detail.status === 'in_progress' ? <section><div className="flex items-center justify-between gap-3"><h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-orange-700 [html[data-theme='dark']_&]:text-orange-200">Poslední komentář</h4><span className="text-[9px] font-bold text-[var(--text-secondary)]">Celkem {detail.progressNotesTotal}</span></div><div className="mt-2 space-y-2">{detail.progressNotes.map((note) => <div key={note.id} className="rounded-2xl border border-orange-200 bg-orange-50/75 px-3.5 py-3 [html[data-theme='dark']_&]:border-orange-400/20 [html[data-theme='dark']_&]:bg-orange-400/10"><p className="text-[9px] font-bold uppercase text-orange-700/75 [html[data-theme='dark']_&]:text-orange-200/75">{note.authorName} · {formatDate(note.createdAt, true)}</p><p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-5 text-orange-950 [html[data-theme='dark']_&]:text-orange-100">{note.note}</p></div>)}{detail.progressNotes.length === 0 ? <div className="rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-4 py-3 text-sm text-[var(--text-secondary)]">Zatím bez průběžných komentářů.</div> : null}</div></section> : null}
    </div> : null}</div>
    {detail ? <footer className="activities-manual-preview__footer flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--surface-border)] px-5 py-3.5"><OfferPdfLink offerId={detail.id} returnTo="detail" className="activities-manual-preview__secondary inline-flex h-9 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition hover:-translate-y-px hover:border-[#9dc7e5] hover:text-[var(--text-primary)]">PDF</OfferPdfLink><Link href={`/offers/${detail.id}`} className="activities-manual-preview__secondary inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition hover:-translate-y-px hover:border-[#9dc7e5] hover:text-[var(--text-primary)]"><ExternalLink aria-hidden size={12} /> {detail.status === 'submitted' ? 'Otevřít ke schválení' : 'Otevřít nabídku'}</Link></footer> : null}
  </section>
}

function OfferRow({ item }: { item: ActivityWorkspaceOffer }) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<PreviewAnchor | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { const frame = window.requestAnimationFrame(() => setMounted(true)); return () => window.cancelAnimationFrame(frame) }, [])
  function open() { const rect = triggerRef.current?.getBoundingClientRect(); if (rect) setAnchor({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }) }
  return <><button ref={triggerRef} type="button" onClick={open} className="activities-workspace__row flex h-[58px] min-h-[58px] w-full items-center gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2.5 text-left transition hover:-translate-y-px" aria-label={`Otevřít náhled nabídky ${item.offerNumber}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${STATUS_PRESENTATION[item.status].icon}`}><FileText aria-hidden size={15} /></span><span className="min-w-0 flex-1"><strong className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{item.offerNumber} · {item.title}</strong><span className="mt-0.5 block truncate text-[11px] text-[var(--text-secondary)]">{item.clientName ?? 'Bez klienta'}</span></span><ChevronRight aria-hidden size={15} className="shrink-0 text-[var(--text-secondary)]" /></button>{mounted && anchor ? createPortal(<OfferPreview summary={item} anchor={anchor} triggerRef={triggerRef} onClose={() => setAnchor(null)} />, document.body) : null}</>
}

export function WorkspaceOfferList({ items }: { items: ActivityWorkspaceOffer[] }) {
  return <>{items.map((item) => <OfferRow key={item.id} item={item} />)}</>
}
