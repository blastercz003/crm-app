'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronRight, Clock3, ExternalLink, ListTodo, Mail, MapPin, Phone, UserRound, X } from 'lucide-react'
import { EditMeetingButton } from '@/app/meetings/edit-meeting-button'
import { getPriorityLabel } from '@/app/tasks/taskUi'
import { ActionFeedbackToast, useAnimatedActionToast } from '@/components/ui/action-feedback-toast'
import type { ActivityWorkspaceFormOptions, ActivityWorkspaceMeeting, ActivityWorkspaceMeetingDetail } from '@/lib/activities/workspace-types'
import { getWorkspaceMeetingDetailAction } from './workspace-meeting-actions'

const PRAGUE_TIME_ZONE = 'Europe/Prague'

type MeetingPreviewAnchor = { top: number; right: number; bottom: number; left: number }

function formatDateTime(value: string | null) {
  if (!value) return 'Bez termínu'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Neznámý termín'
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'full', timeStyle: 'short', timeZone: PRAGUE_TIME_ZONE }).format(date)
}

function formatShortDateTime(value: string | null) {
  if (!value) return 'Bez termínu'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Bez termínu'
  return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: PRAGUE_TIME_ZONE }).format(date)
}

function formatDate(value: string | null) {
  if (!value) return 'Neuvedeno'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Neuvedeno'
  return new Intl.DateTimeFormat('cs-CZ', { dateStyle: 'medium', timeZone: PRAGUE_TIME_ZONE }).format(date)
}

function getMeetingStatus(meeting: Pick<ActivityWorkspaceMeeting, 'status' | 'meetingDateTime'>) {
  if (meeting.status === 'completed') return { label: 'Proběhlo', className: "bg-emerald-100 text-emerald-700 [html[data-theme='dark']_&]:bg-emerald-400/15 [html[data-theme='dark']_&]:text-emerald-200" }
  const date = meeting.meetingDateTime ? new Date(meeting.meetingDateTime) : null
  if (date && !Number.isNaN(date.getTime()) && date.getTime() < Date.now()) return { label: 'Po termínu', className: "bg-amber-100 text-amber-700 [html[data-theme='dark']_&]:bg-amber-400/15 [html[data-theme='dark']_&]:text-amber-200" }
  return { label: 'Naplánováno', className: "bg-sky-100 text-sky-700 [html[data-theme='dark']_&]:bg-sky-400/15 [html[data-theme='dark']_&]:text-sky-200" }
}

function MeetingMetaItem({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) {
  return <div className="flex min-w-0 items-start gap-2 sm:gap-2.5"><Icon aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-600 sm:h-[15px] sm:w-[15px]" /><div className="min-w-0"><p className="text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)] sm:text-[9px] sm:tracking-[0.1em]">{label}</p><p className="mt-0.5 break-words text-[11px] font-semibold leading-4 text-[var(--text-primary)] sm:text-xs">{value}</p></div></div>
}

function MeetingTextSection({ title, value, emptyText }: { title: string; value: string | null; emptyText: string }) {
  return <section><h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">{title}</h4><div className="activities-manual-preview__content mt-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-4 py-3.5"><p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-primary)]">{value?.trim() || emptyText}</p></div></section>
}

function MeetingPreview({ summary, anchor, triggerRef, clients, contacts, onClose, onSaved }: {
  summary: ActivityWorkspaceMeeting
  anchor: MeetingPreviewAnchor
  triggerRef: RefObject<HTMLButtonElement | null>
  clients: ActivityWorkspaceFormOptions['clients']
  contacts: ActivityWorkspaceFormOptions['meetingContacts']
  onClose: () => void
  onSaved: () => void
}) {
  const router = useRouter()
  const shellRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [detail, setDetail] = useState<ActivityWorkspaceMeetingDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))

  const loadDetail = useCallback(async () => {
    setLoading(true)
    const result = await getWorkspaceMeetingDetailAction(summary.id)
    if (result.success && result.meeting) { setDetail(result.meeting); setLoadError(null) }
    else setLoadError(result.error ?? 'Detail schůzky se nepodařilo načíst.')
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
    void getWorkspaceMeetingDetailAction(summary.id).then((result) => {
      if (!active) return
      if (result.success && result.meeting) { setDetail(result.meeting); setLoadError(null) }
      else setLoadError(result.error ?? 'Detail schůzky se nepodařilo načíst.')
      setLoading(false)
    })
    return () => { active = false }
  }, [summary.id])

  useEffect(() => {
    function syncViewport() { setViewport({ width: window.innerWidth, height: window.innerHeight }) }
    function closeOnOutside(event: PointerEvent) {
      const target = event.target as Node
      const targetElement = event.target instanceof Element ? event.target : null
      if (shellRef.current?.contains(target) || triggerRef.current?.contains(target) || targetElement?.closest('.meetings-modal__shell')) return
      requestClose()
    }
    function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape' && !document.querySelector('.meetings-modal__shell')) requestClose() }
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus())
    window.addEventListener('resize', syncViewport)
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => { window.cancelAnimationFrame(focusFrame); window.removeEventListener('resize', syncViewport); document.removeEventListener('pointerdown', closeOnOutside); document.removeEventListener('keydown', closeOnEscape) }
  }, [requestClose, triggerRef])

  useEffect(() => () => { if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current) }, [])

  const mobile = viewport.width < 640
  const width = Math.min(460, viewport.width - 24)
  const maxHeight = Math.min(620, viewport.height - 24)
  const left = Math.min(Math.max(12, anchor.left), Math.max(12, viewport.width - width - 12))
  const top = Math.min(Math.max(12, anchor.bottom + 8), Math.max(12, viewport.height - maxHeight - 12))
  const positionStyle: CSSProperties = mobile ? { top: '50%', right: 12, left: 12, maxHeight: 'calc(100dvh - 24px)', transform: 'translateY(-50%)' } : { top, left, width, maxHeight }
  const currentMeeting = detail ?? summary
  const status = getMeetingStatus(currentMeeting)
  const company = currentMeeting.clientName ?? currentMeeting.companyName ?? 'Bez klienta'

  return <section ref={shellRef} className={`activities-manual-preview activities-page__panel fixed z-[142] flex flex-col overflow-hidden rounded-[24px] border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.98)_0%,rgba(247,250,252,0.96)_52%,rgba(237,244,249,0.95)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_24px_58px_rgba(15,23,42,0.24)] backdrop-blur-[16px] ${mobile ? 'activities-manual-preview--mobile' : ''} ${closing ? 'activities-manual-preview--closing' : ''} ${editing ? 'invisible pointer-events-none opacity-0' : ''}`} style={positionStyle} role="dialog" aria-modal="false" aria-labelledby={`workspace-meeting-preview-${summary.id}`}>
    <header className="activities-manual-preview__header flex shrink-0 items-start justify-between gap-4 border-b border-[var(--surface-border)] px-5 py-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${status.className}`}>{status.label}</span><span className="rounded-full bg-violet-100 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-violet-700 [html[data-theme='dark']_&]:bg-violet-400/15 [html[data-theme='dark']_&]:text-violet-200">{formatDateTime(currentMeeting.meetingDateTime)}</span></div><h3 id={`workspace-meeting-preview-${summary.id}`} className="mt-2.5 break-words text-lg font-semibold leading-6 text-[var(--text-primary)]">{currentMeeting.title || company}</h3></div><button ref={closeRef} type="button" onClick={requestClose} aria-label="Zavřít náhled schůzky" className="activities-manual-preview__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] shadow-sm transition hover:-translate-y-px hover:border-[#9dc7e5] hover:text-[var(--text-primary)]"><X aria-hidden size={16} /></button></header>
    <div className="activities-manual-preview__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
      {loading ? <div className="space-y-3" aria-label="Načítám detail schůzky"><div className="h-28 animate-pulse rounded-2xl bg-[var(--surface-muted)]" /><div className="h-32 animate-pulse rounded-2xl bg-[var(--surface-muted)]" /></div> : loadError ? <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700"><p>{loadError}</p><button type="button" onClick={() => void loadDetail()} className="mt-3 text-[10px] font-bold uppercase underline">Zkusit znovu</button></div> : detail ? <div className="space-y-4">
        <div className="activities-manual-preview__meta grid grid-cols-2 gap-x-2 gap-y-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3 sm:gap-3 sm:p-3.5"><MeetingMetaItem icon={CalendarDays} label="Datum a čas" value={formatDateTime(detail.meetingDateTime)} /><MeetingMetaItem icon={UserRound} label="Přiřazeno" value={detail.assignedUserName} /><MeetingMetaItem icon={MapPin} label="Klient" value={company} /><MeetingMetaItem icon={UserRound} label="Kontaktní osoba" value={detail.contactPerson || 'Neuvedena'} /><MeetingMetaItem icon={Phone} label="Telefon" value={detail.contactPhone || 'Neuveden'} /><MeetingMetaItem icon={Mail} label="E-mail" value={detail.contactEmail || 'Neuveden'} /><MeetingMetaItem icon={MapPin} label="Adresa" value={detail.address || 'Neuvedena'} /><MeetingMetaItem icon={Clock3} label="Vytvořeno" value={`${formatDate(detail.createdAt)} · ${detail.creatorName}`} /></div>
        <MeetingTextSection title="Poznámka před schůzkou" value={detail.preMeetingNote} emptyText="Zatím bez poznámky před schůzkou." />
        <MeetingTextSection title="Výsledek schůzky" value={detail.resultNote} emptyText="Výsledek schůzky zatím nebyl doplněn." />
        {detail.followUpTask ? <section><h4 className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]"><ListTodo aria-hidden size={13} /> Navazující úkol</h4><div className="activities-manual-preview__content mt-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-4 py-3.5"><p className="font-semibold text-[var(--text-primary)]">{detail.followUpTask}</p>{detail.followUpTaskNote ? <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">{detail.followUpTaskNote}</p> : null}<p className="mt-2 text-[10px] font-semibold uppercase text-[var(--text-secondary)]">{getPriorityLabel(detail.followUpTaskPriority)} · {detail.followUpTaskDueDate ? formatDate(detail.followUpTaskDueDate) : 'Bez termínu'}</p></div></section> : null}
      </div> : null}
    </div>
    {detail ? <footer className="activities-manual-preview__footer flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--surface-border)] px-5 py-3.5"><EditMeetingButton meeting={{ id: detail.id, client_id: detail.clientId, client_contact_id: detail.clientContactId, company_name: detail.companyName, contact_person: detail.contactPerson, contact_phone: detail.contactPhone, contact_email: detail.contactEmail, address: detail.address, title: detail.title, meeting_datetime: detail.meetingDateTime, pre_meeting_note: detail.preMeetingNote, result_note: detail.resultNote, follow_up_task: detail.followUpTask, follow_up_task_note: detail.followUpTaskNote, follow_up_task_priority: detail.followUpTaskPriority, follow_up_task_due_date: detail.followUpTaskDueDate, status: detail.status === 'completed' ? 'completed' : 'planned' }} clients={clients} contacts={contacts} onOpen={() => setEditing(true)} onClosed={onClose} onSaved={() => { router.refresh(); onSaved() }} className="activities-manual-preview__secondary inline-flex h-9 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition hover:-translate-y-px hover:border-[#9dc7e5] hover:text-[var(--text-primary)]" label="UPRAVIT" /><Link href={`/meetings/${detail.id}`} className="activities-manual-preview__secondary inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition hover:-translate-y-px hover:border-[#9dc7e5] hover:text-[var(--text-primary)]"><ExternalLink aria-hidden size={12} /> Celý detail</Link></footer> : null}
  </section>
}

export function WorkspaceMeetingDetail({ meeting, clients, contacts }: { meeting: ActivityWorkspaceMeeting; clients: ActivityWorkspaceFormOptions['clients']; contacts: ActivityWorkspaceFormOptions['meetingContacts'] }) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<MeetingPreviewAnchor | null>(null)
  const [mounted, setMounted] = useState(false)
  const { toast, isVisible, showToast } = useAnimatedActionToast()
  useEffect(() => { const frame = window.requestAnimationFrame(() => setMounted(true)); return () => window.cancelAnimationFrame(frame) }, [])
  function openPreview() { const rect = triggerRef.current?.getBoundingClientRect(); if (rect) setAnchor({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left }) }
  return <><button ref={triggerRef} type="button" onClick={openPreview} className="activities-workspace__row flex h-[58px] min-h-[58px] w-full items-stretch gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2.5 text-left transition hover:-translate-y-px" aria-label={`Otevřít detail schůzky ${meeting.title || meeting.clientName || meeting.companyName || ''}`}><span className="flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-xl bg-violet-500/12 text-violet-600"><CalendarDays aria-hidden size={15} /></span><span className="flex min-w-0 flex-1 flex-col"><strong className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{meeting.title || meeting.clientName || meeting.companyName || 'Schůzka'}</strong><span className="mt-auto flex min-w-0 items-end justify-between gap-3 pt-0.5"><span className="min-w-0 truncate text-[11px] text-[var(--text-secondary)]">{meeting.clientName ?? meeting.companyName ?? 'Bez klienta'}</span><span className="shrink-0 text-right text-[10px] text-[var(--text-secondary)]">{formatShortDateTime(meeting.meetingDateTime)}</span></span></span><ChevronRight aria-hidden size={15} className="shrink-0 self-center text-[var(--text-secondary)]" /></button>{mounted && anchor ? createPortal(<MeetingPreview summary={meeting} anchor={anchor} triggerRef={triggerRef} clients={clients} contacts={contacts} onClose={() => setAnchor(null)} onSaved={() => showToast({ title: 'SCHŮZKA UPRAVENA', message: 'Změny byly uloženy.', tone: 'success' })} />, document.body) : null}{toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}</>
}
