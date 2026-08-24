'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, useTransition, type CSSProperties, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  Bell,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  Flag,
  ListTodo,
  LoaderCircle,
  Repeat2,
  UserRound,
  X,
} from 'lucide-react'
import EditTaskButton from '@/app/tasks/edit-task-button'
import { endTaskRecurrence, updateTaskStatus } from '@/app/tasks/actions'
import {
  getPriorityBadgeClass,
  getPriorityLabel,
  getRepeatIntervalLabel,
  getStatusBadgeClass,
  getStatusLabel,
  getTaskDueBadgeClass,
} from '@/app/tasks/taskUi'
import { ActionFeedbackToast, useAnimatedActionToast, type ActionFeedbackToastValue } from '@/components/ui/action-feedback-toast'
import type {
  ActivityWorkspaceFormOptions,
  ActivityWorkspaceTask,
  ActivityWorkspaceTaskDetail,
} from '@/lib/activities/workspace-types'
import { getWorkspaceTaskDetailAction } from './workspace-task-actions'

type TaskPreviewAnchor = {
  top: number
  right: number
  bottom: number
  left: number
}

function parseDateOnly(value: string | null) {
  if (!value) return null
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

function dueDateState(value: string | null, status: string | null) {
  const date = parseDateOnly(value)
  if (!date || status === 'done') return { isToday: false, isOverdue: false }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return {
    isToday: date.getTime() === today.getTime(),
    isOverdue: date.getTime() < today.getTime(),
  }
}

function formatDate(value: string | null, includeTime = false) {
  if (!value) return 'Neuvedeno'
  const date = parseDateOnly(value) ?? new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date)
}

function formatShortDate(value: string | null) {
  const date = value ? parseDateOnly(value) : null
  if (!date) return 'Bez termínu'
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
  }).format(date)
}

function TaskMetaItem({ icon: Icon, label, value }: {
  icon: typeof UserRound
  label: string
  value: string
}) {
  return (
    <div className="flex min-w-0 items-start gap-2 sm:gap-2.5">
      <Icon aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent)] sm:h-[15px] sm:w-[15px]" />
      <div className="min-w-0">
        <p className="text-[8px] font-bold uppercase tracking-[0.08em] text-[var(--text-secondary)] sm:text-[9px] sm:tracking-[0.1em]">{label}</p>
        <p className="mt-0.5 break-words text-[11px] font-semibold leading-4 text-[var(--text-primary)] sm:text-xs">{value}</p>
      </div>
    </div>
  )
}

function WorkspaceTaskPreview({
  summary,
  anchor,
  triggerRef,
  users,
  clients,
  contacts,
  onClose,
  onFeedback,
}: {
  summary: ActivityWorkspaceTask
  anchor: TaskPreviewAnchor
  triggerRef: RefObject<HTMLButtonElement | null>
  users: ActivityWorkspaceFormOptions['taskUsers']
  clients: ActivityWorkspaceFormOptions['clients']
  contacts: ActivityWorkspaceFormOptions['taskContacts']
  onClose: () => void
  onFeedback: (toast: ActionFeedbackToastValue) => void
}) {
  const router = useRouter()
  const shellRef = useRef<HTMLElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [detail, setDetail] = useState<ActivityWorkspaceTaskDetail | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [pending, startTransition] = useTransition()
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))

  const loadDetail = useCallback(async () => {
    setLoading(true)
    const result = await getWorkspaceTaskDetailAction(summary.id)
    if (result.success && result.task) {
      setDetail(result.task)
      setLoadError(null)
    } else {
      setLoadError(result.error ?? 'Detail úkolu se nepodařilo načíst.')
    }
    setLoading(false)
  }, [summary.id])

  const requestClose = useCallback(() => {
    if (closing) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onClose()
      return
    }
    setClosing(true)
    closeTimerRef.current = window.setTimeout(onClose, 150)
  }, [closing, onClose])

  useEffect(() => {
    let active = true
    void getWorkspaceTaskDetailAction(summary.id).then((result) => {
      if (!active) return
      if (result.success && result.task) {
        setDetail(result.task)
        setLoadError(null)
      } else {
        setLoadError(result.error ?? 'Detail úkolu se nepodařilo načíst.')
      }
      setLoading(false)
    })
    return () => { active = false }
  }, [summary.id])

  useEffect(() => {
    function syncViewport() {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    function closeOnOutside(event: PointerEvent) {
      const target = event.target as Node
      const targetElement = event.target instanceof Element ? event.target : null
      if (shellRef.current?.contains(target) || triggerRef.current?.contains(target) || targetElement?.closest('.tasks-modal__shell')) return
      requestClose()
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !document.querySelector('.tasks-modal__shell')) requestClose()
    }
    const focusFrame = window.requestAnimationFrame(() => closeRef.current?.focus())
    window.addEventListener('resize', syncViewport)
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('resize', syncViewport)
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [requestClose, triggerRef])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
  }, [])

  const mobile = viewport.width < 640
  const width = Math.min(440, viewport.width - 24)
  const maxHeight = Math.min(590, viewport.height - 24)
  const left = Math.min(Math.max(12, anchor.left), Math.max(12, viewport.width - width - 12))
  const top = Math.min(Math.max(12, anchor.bottom + 8), Math.max(12, viewport.height - maxHeight - 12))
  const positionStyle: CSSProperties = mobile
    ? { top: '50%', right: 12, left: 12, maxHeight: 'calc(100dvh - 24px)', transform: 'translateY(-50%)' }
    : { top, left, width, maxHeight }

  const currentTask = detail ?? summary
  const dueState = dueDateState(currentTask.dueDate, currentTask.status)
  const dueBadgeClass = getTaskDueBadgeClass({
    hasDueDate: Boolean(currentTask.dueDate),
    ...dueState,
  })

  function completeTask() {
    startTransition(async () => {
      try {
        await updateTaskStatus(summary.id, 'done')
        onFeedback({ title: 'ÚKOL DOKONČEN', message: 'Úkol byl označen jako hotový.', tone: 'success' })
        requestClose()
        window.setTimeout(() => router.refresh(), 160)
      } catch (error) {
        onFeedback({ title: 'CHYBA', message: error instanceof Error ? error.message : 'Úkol se nepodařilo dokončit.', tone: 'error' })
      }
    })
  }

  function stopRecurrence() {
    startTransition(async () => {
      try {
        await endTaskRecurrence(summary.id)
        onFeedback({ title: 'OPAKOVÁNÍ UKONČENO', message: 'Úkol byl dokončen bez vytvoření dalšího opakování.', tone: 'success' })
        requestClose()
        window.setTimeout(() => router.refresh(), 160)
      } catch (error) {
        onFeedback({ title: 'CHYBA', message: error instanceof Error ? error.message : 'Opakování se nepodařilo ukončit.', tone: 'error' })
      }
    })
  }

  return (
    <section
      ref={shellRef}
      className={`activities-manual-preview activities-page__panel fixed z-[142] flex flex-col overflow-hidden rounded-[24px] border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.98)_0%,rgba(247,250,252,0.96)_52%,rgba(237,244,249,0.95)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_24px_58px_rgba(15,23,42,0.24)] backdrop-blur-[16px] ${mobile ? 'activities-manual-preview--mobile' : ''} ${closing ? 'activities-manual-preview--closing' : ''} ${editing ? 'invisible pointer-events-none opacity-0' : ''}`}
      style={positionStyle}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`workspace-task-preview-${summary.id}`}
    >
      <header className="activities-manual-preview__header flex shrink-0 items-start justify-between gap-4 border-b border-[var(--surface-border)] px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${getStatusBadgeClass(currentTask.status)}`}>{getStatusLabel(currentTask.status)}</span>
            <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${getPriorityBadgeClass(currentTask.priority)}`}>{getPriorityLabel(currentTask.priority)}</span>
            <span className={`rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${dueBadgeClass}`}>{currentTask.dueDate ? formatDate(currentTask.dueDate) : 'Bez termínu'}</span>
          </div>
          <h3 id={`workspace-task-preview-${summary.id}`} className="mt-2.5 break-words text-lg font-semibold leading-6 text-[var(--text-primary)]">{currentTask.title}</h3>
        </div>
        <button ref={closeRef} type="button" onClick={requestClose} aria-label="Zavřít náhled úkolu" className="activities-manual-preview__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] shadow-sm transition hover:-translate-y-px hover:border-[#9dc7e5] hover:text-[var(--text-primary)]"><X aria-hidden size={16} /></button>
      </header>

      <div className="activities-manual-preview__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        {loading ? (
          <div className="space-y-3" aria-label="Načítám detail úkolu">
            <div className="h-24 animate-pulse rounded-2xl bg-[var(--surface-muted)]" />
            <div className="h-32 animate-pulse rounded-2xl bg-[var(--surface-muted)]" />
          </div>
        ) : loadError ? (
          <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
            <p>{loadError}</p>
            <button type="button" onClick={() => void loadDetail()} className="mt-3 text-[10px] font-bold uppercase underline">Zkusit znovu</button>
          </div>
        ) : detail ? (
          <>
            <div className="activities-manual-preview__meta grid grid-cols-2 gap-x-2 gap-y-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3 sm:gap-3 sm:p-3.5">
              <TaskMetaItem icon={Building2} label="Klient" value={detail.clientName ?? detail.companyName ?? 'Bez klienta'} />
              <TaskMetaItem icon={CalendarDays} label="Termín" value={detail.dueDate ? formatDate(detail.dueDate) : 'Bez termínu'} />
              <TaskMetaItem icon={UserRound} label="Přiřazeno" value={detail.assigneeName} />
              <TaskMetaItem icon={UserRound} label="Zadal" value={detail.creatorName} />
              <TaskMetaItem icon={UserRound} label="Kontaktní osoba" value={detail.contactPerson || '—'} />
              <TaskMetaItem icon={Repeat2} label="Opakování" value={getRepeatIntervalLabel(detail.repeatInterval)} />
              <TaskMetaItem icon={Clock3} label="Vytvořeno" value={formatDate(detail.createdAt, true)} />
            </div>

            <section className="mt-4">
              <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Zadání úkolu</h4>
              <div className="activities-manual-preview__content mt-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-4 py-3.5">
                <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-primary)]">{detail.note?.trim() || 'Bez doplňujícího zadání nebo poznámky.'}</p>
              </div>
            </section>
          </>
        ) : null}
      </div>

      {detail ? (
        <footer className="activities-manual-preview__footer flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--surface-border)] px-5 py-3.5">
          {detail.repeatInterval && detail.status !== 'done' ? <button type="button" disabled={pending} onClick={stopRecurrence} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 text-[10px] font-bold uppercase text-amber-700 transition hover:-translate-y-px hover:bg-amber-100 disabled:opacity-50"><Repeat2 aria-hidden size={13} /> Ukončit opakování</button> : null}
          <EditTaskButton
            task={{
              id: detail.id,
              title: detail.title,
              note: detail.note,
              due_date: detail.dueDate,
              status: detail.status,
              priority: detail.priority,
              repeat_interval: detail.repeatInterval,
              assigned_to: detail.assignedTo,
              client_id: detail.clientId,
              client_contact_id: detail.clientContactId,
              company_name: detail.companyName,
              contact_person: detail.contactPerson,
            }}
            users={users}
            clients={clients}
            contacts={contacts}
            onSaved={() => { void loadDetail(); router.refresh(); onFeedback({ title: 'ÚKOL UPRAVEN', message: 'Změny byly uloženy.', tone: 'success' }) }}
            onOpen={() => setEditing(true)}
            onClosed={onClose}
            className="activities-manual-preview__secondary inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition hover:-translate-y-px hover:border-[#9dc7e5] hover:text-[var(--text-primary)]"
            label="UPRAVIT"
          />
          <Link href={`/tasks/${detail.id}`} className="activities-manual-preview__secondary inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition hover:-translate-y-px hover:border-[#9dc7e5] hover:text-[var(--text-primary)]"><ExternalLink aria-hidden size={12} /> Celý detail</Link>
          {detail.status !== 'done' ? <button type="button" disabled={pending} onClick={completeTask} className="activities-manual-preview__complete inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 text-[10px] font-bold uppercase text-emerald-700 transition hover:-translate-y-px hover:border-emerald-300 hover:bg-emerald-100 disabled:opacity-50">{pending ? <LoaderCircle aria-hidden size={13} className="animate-spin" /> : <Check aria-hidden size={13} />} Dokončit</button> : null}
        </footer>
      ) : null}
    </section>
  )
}

function WorkspaceTaskRow({
  item,
  users,
  clients,
  contacts,
  onFeedback,
}: {
  item: ActivityWorkspaceTask
  users: ActivityWorkspaceFormOptions['taskUsers']
  clients: ActivityWorkspaceFormOptions['clients']
  contacts: ActivityWorkspaceFormOptions['taskContacts']
  onFeedback: (toast: ActionFeedbackToastValue) => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [anchor, setAnchor] = useState<TaskPreviewAnchor | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMounted(true))
    return () => window.cancelAnimationFrame(frame)
  }, [])

  function openPreview() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    setAnchor({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left })
  }

  return (
    <>
      <button ref={triggerRef} type="button" onClick={openPreview} className="activities-workspace__row flex h-[58px] min-h-[58px] w-full items-stretch gap-3 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2.5 text-left transition hover:-translate-y-px" aria-label={`Otevřít detail úkolu ${item.title}`}>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-xl ${item.priority === 'high' ? 'bg-rose-500/12 text-rose-600' : 'bg-sky-500/12 text-sky-600'}`}><ListTodo aria-hidden size={15} /></span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-start justify-between gap-2">
            <strong className="block min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text-primary)]">{item.title}</strong>
            <span className="flex shrink-0 items-center gap-1.5 text-[var(--text-secondary)]">
              {item.hasNotification ? <Bell aria-label="Úkol má notifikaci" size={13} /> : null}
              {item.repeatInterval ? <Repeat2 aria-label="Opakovaný úkol" size={13} /> : null}
              {item.priority ? <Flag aria-label={`Priorita: ${getPriorityLabel(item.priority)}`} size={13} className={item.priority === 'high' ? 'text-rose-600' : item.priority === 'medium' ? 'text-amber-600' : 'text-sky-600'} /> : null}
            </span>
          </span>
          <span className="mt-auto flex min-w-0 items-end justify-between gap-3 pt-0.5">
            <span className="min-w-0 truncate text-[11px] text-[var(--text-secondary)]">{item.clientName ?? item.companyName ?? 'Bez klienta'}</span>
            <span className="shrink-0 text-right text-[10px] text-[var(--text-secondary)]">{formatShortDate(item.dueDate)}</span>
          </span>
        </span>
        <ChevronRight aria-hidden size={15} className="shrink-0 self-center text-[var(--text-secondary)]" />
      </button>
      {mounted && anchor ? createPortal(<WorkspaceTaskPreview summary={item} anchor={anchor} triggerRef={triggerRef} users={users} clients={clients} contacts={contacts} onClose={() => setAnchor(null)} onFeedback={onFeedback} />, document.body) : null}
    </>
  )
}

export function WorkspaceTaskList({
  items,
  users,
  clients,
  contacts,
}: {
  items: ActivityWorkspaceTask[]
  users: ActivityWorkspaceFormOptions['taskUsers']
  clients: ActivityWorkspaceFormOptions['clients']
  contacts: ActivityWorkspaceFormOptions['taskContacts']
}) {
  const { toast, isVisible, showToast } = useAnimatedActionToast()
  return (
    <>
      {items.map((item) => <WorkspaceTaskRow key={item.id} item={item} users={users} clients={clients} contacts={contacts} onFeedback={showToast} />)}
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}
    </>
  )
}
