'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Building2, CalendarDays, ChevronRight, CircleGauge, ClipboardCheck, FileText, MapPin, Settings2, UserRound, Wrench, X } from 'lucide-react'
import { EditJobModalController } from '@/app/jobs/edit-job-button'
import type { ActivityWorkspaceJob, ActivityWorkspaceJobDetail, ActivityWorkspaceJobStatus } from '@/lib/activities/workspace-types'
import { getWorkspaceJobDetailAction } from './workspace-job-actions'

type PreviewAnchor = { top: number; left: number; bottom: number }

const STATUS_META: Record<ActivityWorkspaceJobStatus, { label: string; badge: string; icon: string }> = {
  nova: { label: 'Nová', badge: 'bg-sky-100 text-sky-700 [html[data-theme=\'dark\']_&]:bg-sky-400/15 [html[data-theme=\'dark\']_&]:text-sky-200', icon: 'bg-sky-500/15 text-sky-600 [html[data-theme=\'dark\']_&]:text-sky-300' },
  k_reseni: { label: 'V řešení', badge: 'bg-orange-100 text-orange-700 [html[data-theme=\'dark\']_&]:bg-orange-400/15 [html[data-theme=\'dark\']_&]:text-orange-200', icon: 'bg-orange-500/15 text-orange-600 [html[data-theme=\'dark\']_&]:text-orange-300' },
  realizace: { label: 'Realizace', badge: 'bg-emerald-100 text-emerald-700 [html[data-theme=\'dark\']_&]:bg-emerald-400/15 [html[data-theme=\'dark\']_&]:text-emerald-200', icon: 'bg-emerald-500/15 text-emerald-600 [html[data-theme=\'dark\']_&]:text-emerald-300' },
  ukoncena: { label: 'Ukončená', badge: 'bg-slate-100 text-slate-700 [html[data-theme=\'dark\']_&]:bg-slate-400/15 [html[data-theme=\'dark\']_&]:text-slate-200', icon: 'bg-slate-500/15 text-slate-600 [html[data-theme=\'dark\']_&]:text-slate-300' },
  storno: { label: 'Storno', badge: 'bg-rose-100 text-rose-700 [html[data-theme=\'dark\']_&]:bg-rose-400/15 [html[data-theme=\'dark\']_&]:text-rose-200', icon: 'bg-rose-500/15 text-rose-600 [html[data-theme=\'dark\']_&]:text-rose-300' },
}

const INVOICE_LABEL = { bez_faktury: 'Bez faktury', k_fakturaci: 'K fakturaci', vyfakturovano: 'Vyfakturováno' }
const EVIDENCE_LABEL = { nove: 'Zapsat', zapsano: 'Zapsáno' }

function effectiveStatus(job: Pick<ActivityWorkspaceJob, 'jobStatus' | 'endAt'>): ActivityWorkspaceJobStatus {
  if (job.jobStatus !== 'realizace' && job.jobStatus !== 'ukoncena') return job.jobStatus
  const end = new Date(job.endAt)
  return !Number.isNaN(end.getTime()) && end.getTime() < Date.now() ? 'ukoncena' : 'realizace'
}

function formatDate(value: string, compact = false) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Neuvedeno'
  return new Intl.DateTimeFormat('cs-CZ', compact
    ? { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Prague' }
    : { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Prague' }).format(date)
}

function Meta({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return <div className="flex min-w-0 items-start gap-2 sm:gap-2.5"><Icon aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)] sm:h-[15px] sm:w-[15px]" /><div className="min-w-0"><p className="text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)] sm:text-[9px] sm:tracking-[0.1em]">{label}</p><p className="mt-0.5 break-words text-[11px] font-semibold leading-4 text-[var(--text-primary)] sm:text-xs">{value}</p></div></div>
}

function JobPreview({ summary, anchor, triggerRef, canEdit, onClose, onEdit }: { summary: ActivityWorkspaceJob; anchor: PreviewAnchor; triggerRef: RefObject<HTMLButtonElement | null>; canEdit: boolean; onClose: () => void; onEdit: (job: ActivityWorkspaceJobDetail) => void }) {
  const shellRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [detail, setDetail] = useState<ActivityWorkspaceJobDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))

  const load = useCallback(async () => {
    setLoading(true)
    const result = await getWorkspaceJobDetailAction(summary.id)
    if (result.success && result.job) { setDetail(result.job); setLoadError(null) }
    else setLoadError(result.error ?? 'Detail zakázky se nepodařilo načíst.')
    setLoading(false)
  }, [summary.id])

  const requestClose = useCallback(() => {
    if (closing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { onClose(); return }
    setClosing(true)
    closeTimerRef.current = window.setTimeout(onClose, 150)
  }, [closing, onClose])

  useEffect(() => {
    let active = true
    void getWorkspaceJobDetailAction(summary.id).then((result) => {
      if (!active) return
      if (result.success && result.job) { setDetail(result.job); setLoadError(null) }
      else setLoadError(result.error ?? 'Detail zakázky se nepodařilo načíst.')
      setLoading(false)
    })
    return () => { active = false }
  }, [summary.id])
  useEffect(() => {
    function resize() { setViewport({ width: window.innerWidth, height: window.innerHeight }) }
    function outside(event: PointerEvent) { if (!shellRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) requestClose() }
    function escape(event: KeyboardEvent) { if (event.key === 'Escape') requestClose() }
    const frame = window.requestAnimationFrame(() => closeRef.current?.focus())
    window.addEventListener('resize', resize); document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape)
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', resize); document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [requestClose, triggerRef])
  useEffect(() => () => { if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current) }, [])

  const width = Math.min(500, viewport.width - 24)
  const maxHeight = Math.min(680, viewport.height - 24)
  const left = Math.min(Math.max(12, anchor.left), Math.max(12, viewport.width - width - 12))
  const top = Math.min(Math.max(12, anchor.bottom + 8), Math.max(12, viewport.height - maxHeight - 12))
  const style: CSSProperties = viewport.width < 640 ? { left: 12, right: 12, top: '50%', maxHeight: 'calc(100dvh - 24px)', transform: 'translateY(-50%)' } : { top, left, width, maxHeight }
  const current = detail ?? summary
  const status = effectiveStatus(current)
  const meta = STATUS_META[status]

  return <section ref={shellRef} role="dialog" aria-modal="false" aria-labelledby={`job-preview-${summary.id}`} style={style} className={`activities-manual-preview activities-page__panel fixed z-[142] flex flex-col overflow-hidden rounded-[24px] border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.98)_0%,rgba(247,250,252,0.96)_52%,rgba(237,244,249,0.95)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_24px_58px_rgba(15,23,42,0.24)] backdrop-blur-[16px] ${viewport.width < 640 ? 'activities-manual-preview--mobile' : ''} ${closing ? 'activities-manual-preview--closing' : ''}`}>
    <header className="activities-manual-preview__header flex shrink-0 items-start justify-between gap-4 border-b border-[var(--surface-border)] px-5 py-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${meta.badge}`}>{meta.label}</span>{current.marnyVyjezd ? <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[9px] font-bold uppercase text-rose-700 [html[data-theme='dark']_&]:bg-rose-400/15 [html[data-theme='dark']_&]:text-rose-200">Marný výjezd</span> : null}{current.pohotovost ? <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[9px] font-bold uppercase text-violet-700 [html[data-theme='dark']_&]:bg-violet-400/15 [html[data-theme='dark']_&]:text-violet-200">Pohotovost</span> : null}</div><h3 id={`job-preview-${summary.id}`} className="mt-2.5 break-words text-lg font-semibold leading-6 text-[var(--text-primary)]">Zakázka {current.jobNumber}</h3><p className="mt-1 break-words text-xs text-[var(--text-secondary)]">{current.companyName}</p></div><button ref={closeRef} type="button" onClick={requestClose} aria-label="Zavřít náhled zakázky" className="activities-manual-preview__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] shadow-sm transition hover:-translate-y-px hover:border-[#9dc7e5] hover:text-[var(--text-primary)]"><X aria-hidden size={16} /></button></header>
    <div className="activities-manual-preview__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{loading ? <div className="space-y-3" aria-label="Načítám detail zakázky"><div className="h-32 animate-pulse rounded-2xl bg-[var(--surface-muted)]" /><div className="h-28 animate-pulse rounded-2xl bg-[var(--surface-muted)]" /></div> : loadError ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700"><p>{loadError}</p><button type="button" onClick={() => void load()} className="mt-3 text-[10px] font-bold uppercase underline">Zkusit znovu</button></div> : detail ? <div className="space-y-4">
      <div className="activities-manual-preview__meta grid grid-cols-2 gap-x-2 gap-y-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3 sm:gap-3 sm:p-3.5"><Meta icon={UserRound} label="Obchodník" value={detail.salesOwner} /><Meta icon={Wrench} label="Technik" value={detail.technicianName ?? 'Neuvedeno'} /><Meta icon={Settings2} label="Agregát" value={detail.generatorName ?? 'Neuvedeno'} /><Meta icon={UserRound} label="Kontaktní osoba" value={detail.contactPerson ?? 'Neuvedeno'} /><Meta icon={CalendarDays} label="Začátek" value={formatDate(detail.startAt)} /><Meta icon={CalendarDays} label="Konec" value={formatDate(detail.endAt)} /><Meta icon={MapPin} label="Adresa" value={detail.siteAddress ?? 'Neuvedeno'} /><Meta icon={Building2} label="Prodejna" value={detail.storeNumber ?? 'Neuvedeno'} /></div>
      <div className="grid grid-cols-2 gap-2"><MetaCard icon={ClipboardCheck} label="Evidence" value={EVIDENCE_LABEL[detail.evidenceStatus]} /><MetaCard icon={FileText} label="Fakturace" value={INVOICE_LABEL[detail.invoiceStatus]} /></div>
      {detail.clientOrderNumber ? <MetaCard icon={CircleGauge} label="Číslo objednávky klienta" value={detail.clientOrderNumber} /> : null}
      {detail.infoNote ? <section><h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]"><AlertCircle aria-hidden size={13} /> Info zakázky</h4><div className="activities-manual-preview__content mt-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-4 py-3.5"><p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-primary)]">{detail.infoNote}</p></div></section> : null}
    </div> : null}</div>
    {detail && canEdit ? <footer className="activities-manual-preview__footer flex shrink-0 items-center justify-end gap-2 border-t border-[var(--surface-border)] px-5 py-3.5"><button type="button" onClick={() => onEdit(detail)} className="activities-manual-preview__secondary inline-flex h-9 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition hover:-translate-y-px hover:border-[#9dc7e5] hover:text-[var(--text-primary)]">Upravit</button><Link href={`/jobs?q=${encodeURIComponent(detail.jobNumber)}`} className="activities-manual-preview__secondary inline-flex h-9 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition hover:-translate-y-px hover:border-[#9dc7e5] hover:text-[var(--text-primary)]">Otevřít zakázky</Link></footer> : null}
  </section>
}

function MetaCard({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return <div className="activities-manual-preview__content flex min-w-0 items-start gap-2.5 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5"><Icon aria-hidden size={15} className="mt-0.5 shrink-0 text-[var(--accent)]" /><div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">{label}</p><p className="mt-0.5 break-words text-xs font-semibold text-[var(--text-primary)]">{value}</p></div></div>
}

function JobRow({ item, canEdit }: { item: ActivityWorkspaceJob; canEdit: boolean }) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<PreviewAnchor | null>(null)
  const [editing, setEditing] = useState<ActivityWorkspaceJobDetail | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => { const frame = window.requestAnimationFrame(() => setMounted(true)); return () => window.cancelAnimationFrame(frame) }, [])
  const status = effectiveStatus(item)
  const meta = STATUS_META[status]
  function open() { const rect = triggerRef.current?.getBoundingClientRect(); if (rect) setAnchor({ top: rect.top, left: rect.left, bottom: rect.bottom }) }
  function edit(job: ActivityWorkspaceJobDetail) { setAnchor(null); setEditing(job) }
  const editValues = editing ? {
    id: editing.id, job_number: editing.jobNumber, company_name: editing.companyName, client_id: editing.clientId, offer_id: editing.offerId, client_contact_id: editing.clientContactId, contact_person: editing.contactPerson, sales_owner: editing.salesOwner, start_at: editing.startAt, end_at: editing.endAt, site_address: editing.siteAddress, store_number: editing.storeNumber, client_order_number: editing.clientOrderNumber, technician_name: editing.technicianName, generator_name: editing.generatorName, info_note: editing.infoNote, marny_vyjezd: editing.marnyVyjezd, pohotovost: editing.pohotovost, pp_required: editing.ppRequired, job_status: editing.jobStatus, invoice_status: editing.invoiceStatus,
  } : null
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={open}
        className="activities-workspace__row grid h-[58px] min-h-[58px] w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2.5 text-left transition hover:-translate-y-px sm:grid-cols-[auto_minmax(0,1fr)_auto]"
        aria-label={`Otevřít náhled zakázky ${item.jobNumber}`}
      >
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${meta.icon}`}>
          <Wrench aria-hidden size={16} />
        </span>
        <span className="min-w-0">
          <span className="flex min-w-0 items-center gap-2">
            <strong className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text-primary)]">
              {item.jobNumber} · {item.companyName}
            </strong>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[8px] font-bold uppercase sm:hidden ${meta.badge}`}>
              {meta.label}
            </span>
          </span>
          <span className="mt-1 flex min-w-0 gap-3 text-[10px] text-[var(--text-secondary)]">
            <span className="truncate">Technik: {item.technicianName ?? '—'}</span>
            <span className="truncate">Agregát: {item.generatorName ?? '—'}</span>
          </span>
        </span>
        <span className="hidden min-w-[154px] flex-col items-end gap-1.5 sm:flex">
          <span className={`rounded-full px-2 py-0.5 text-[8px] font-bold uppercase ${meta.badge}`}>{meta.label}</span>
          <span className="whitespace-nowrap text-[9px] font-medium tabular-nums text-[var(--text-secondary)]">
            {formatDate(item.startAt, true)} – {formatDate(item.endAt, true)}
          </span>
        </span>
        <ChevronRight aria-hidden size={14} className="hidden text-[var(--text-secondary)]" />
      </button>
      {mounted && anchor ? createPortal(<JobPreview summary={item} anchor={anchor} triggerRef={triggerRef} canEdit={canEdit} onClose={() => setAnchor(null)} onEdit={edit} />, document.body) : null}
      {editValues ? <EditJobModalController job={editValues} onClose={() => setEditing(null)} /> : null}
    </>
  )
}

export function WorkspaceJobList({ items, canEdit }: { items: ActivityWorkspaceJob[]; canEdit: boolean }) {
  return <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">{items.map((item) => <JobRow key={item.id} item={item} canEdit={canEdit} />)}</div>
}
