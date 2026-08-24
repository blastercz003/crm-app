'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Bell, CalendarClock, Check, Clock3, LoaderCircle, Pencil, Repeat2, UserRound, X } from 'lucide-react'
import { ActivityFormModal } from './new-activity-button'
import {
  completeManualActivityAction,
  deleteManualActivityAction,
  updateManualActivityAction,
} from './actions'
import { ActionFeedbackToast, useAnimatedActionToast } from '@/components/ui/action-feedback-toast'
import { ModalHeading } from '@/components/ui/modal-heading'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import type { ActivityActionState, ActivityClientOption, ActivityListItem } from '@/lib/activities/types'
import {
  formatManualActivityDateTime,
  manualActivityRecurrenceLabel,
  manualActivityStatusLabel,
  manualActivityTypeLabel,
} from '@/lib/activities/manual-activity-presentation'

export type ManualActivityPreviewAnchor = {
  top: number
  right: number
  bottom: number
  left: number
  width: number
}

function CompleteActivityModal({
  activity,
  pending,
  onClose,
  onComplete,
}: {
  activity: ActivityListItem
  pending: boolean
  onClose: () => void
  onComplete: (result: string) => void
}) {
  const [result, setResult] = useState('')
  useBodyScrollLock(true)

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pending) onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose, pending])

  return (
    <div
      className="activities-complete-modal fixed inset-0 z-[135] overflow-y-auto bg-zinc-950/42 p-4 backdrop-blur-[5px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="complete-activity-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !pending) onClose()
      }}
    >
      <div className="flex min-h-full items-center justify-center py-4">
        <section className="activities-complete-modal__shell w-full max-w-lg overflow-hidden rounded-3xl border border-zinc-200/85 bg-[linear-gradient(168deg,rgba(255,255,255,0.98)_0%,rgba(249,250,251,0.96)_48%,rgba(244,244,245,0.94)_100%)] shadow-[0_30px_76px_rgba(24,24,27,0.35)]">
          <header className="activities-complete-modal__header flex items-start justify-between gap-4 border-b border-zinc-200/75 px-5 py-4">
            <ModalHeading id="complete-activity-title" section="RUČNÍ AKTIVITA" title="Dokončit aktivitu" />
            <button type="button" onClick={onClose} disabled={pending} aria-label="Zavřít" className="activities-complete-modal__close inline-flex h-9 w-9 items-center justify-center rounded-xl border border-zinc-200 bg-white/90 text-zinc-600 transition hover:-translate-y-px disabled:opacity-50"><X aria-hidden size={17} /></button>
          </header>
          <div className="px-5 py-5">
            <div className="activities-complete-modal__activity rounded-2xl border border-zinc-200/80 bg-white/65 px-4 py-3">
              <p className="text-sm font-semibold text-zinc-900">{activity.title}</p>
              <p className="mt-1 text-xs text-zinc-500">{activity.client_name ?? 'Bez klienta'}</p>
              {activity.recurrence_unit ? <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-violet-600 [html[data-theme='dark']_&]:text-violet-300"><Repeat2 aria-hidden size={13} /> Po dokončení vznikne další termín · {manualActivityRecurrenceLabel(activity.recurrence_unit, activity.recurrence_interval)}</p> : null}
            </div>
            <label className="activities-modal__label mt-4 block text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
              Výsledek <span className="font-normal normal-case tracking-normal text-zinc-400">(volitelné)</span>
              <textarea
                value={result}
                onChange={(event) => setResult(event.target.value)}
                maxLength={5000}
                rows={4}
                placeholder="Např. klient má zájem, ozvu se znovu příští týden…"
                className="activities-modal__input mt-2 min-h-28 w-full resize-y rounded-2xl border border-zinc-200 bg-white/85 px-4 py-3 text-sm font-normal normal-case tracking-normal text-zinc-900 outline-none transition focus:border-[#6fa9d1] focus:ring-2 focus:ring-[#b9d8ef]/55"
              />
            </label>
            <footer className="mt-5 flex flex-col-reverse gap-3 border-t border-zinc-200/75 pt-4 sm:flex-row sm:justify-end">
              <button type="button" onClick={onClose} disabled={pending} className="activities-complete-modal__secondary inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-600 transition hover:bg-zinc-50 disabled:opacity-50">ZRUŠIT</button>
              <button type="button" onClick={() => onComplete(result)} disabled={pending} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[#2473aa] bg-[linear-gradient(155deg,#4d96cb_0%,#2f7fb8_55%,#236a9e_100%)] px-5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(35,106,158,0.25)] transition hover:-translate-y-px disabled:cursor-wait disabled:opacity-60">
                {pending ? <LoaderCircle aria-hidden size={15} className="animate-spin" /> : <Check aria-hidden size={15} />}
                {pending ? 'UKLÁDÁM…' : 'DOKONČIT AKTIVITU'}
              </button>
            </footer>
          </div>
        </section>
      </div>
    </div>
  )
}

function ManualActivityPreviewPopover({
  activity,
  anchor,
  trigger,
  canManage,
  pending,
  deleteArmed,
  onClose,
  onEdit,
  onComplete,
  onDelete,
}: {
  activity: ActivityListItem
  anchor: ManualActivityPreviewAnchor
  trigger: HTMLElement | null
  canManage: boolean
  pending: boolean
  deleteArmed: boolean
  onClose: () => void
  onEdit: () => void
  onComplete: () => void
  onDelete: () => void
}) {
  const shellRef = useRef<HTMLElement>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [closing, setClosing] = useState(false)
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))

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
    function syncViewport() {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node
      if (shellRef.current?.contains(target) || trigger?.contains(target)) return
      requestClose()
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') requestClose()
    }

    const focusFrame = window.requestAnimationFrame(() => shellRef.current?.focus({ preventScroll: true }))
    window.addEventListener('resize', syncViewport)
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      window.cancelAnimationFrame(focusFrame)
      window.removeEventListener('resize', syncViewport)
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [requestClose, trigger])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
  }, [])

  const isMobile = viewport.width < 640
  const popoverWidth = Math.min(440, viewport.width - 24)
  const desktopMaxHeight = Math.min(560, viewport.height - 24)
  const desktopLeft = Math.min(
    Math.max(12, anchor.left),
    Math.max(12, viewport.width - popoverWidth - 12),
  )
  const desktopTop = Math.min(
    Math.max(12, anchor.bottom + 8),
    Math.max(12, viewport.height - desktopMaxHeight - 12),
  )
  const positionStyle: CSSProperties = isMobile
    ? {
        top: '50%',
        right: 12,
        left: 12,
        maxHeight: 'calc(100dvh - 24px)',
        transform: 'translateY(-50%)',
      }
    : {
        top: desktopTop,
        left: desktopLeft,
        width: popoverWidth,
        maxHeight: desktopMaxHeight,
      }

  const dateLabel = activity.status === 'planned' ? 'Termín' : 'Datum zápisu'
  const dateValue = activity.status === 'planned' ? activity.scheduled_for : activity.occurred_at

  return (
    <section
      ref={shellRef}
      className={`activities-manual-preview activities-page__panel fixed z-[142] flex flex-col overflow-hidden rounded-[24px] border border-white/75 bg-[linear-gradient(160deg,rgba(255,255,255,0.98)_0%,rgba(247,250,252,0.96)_52%,rgba(237,244,249,0.95)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_24px_58px_rgba(15,23,42,0.24)] backdrop-blur-[16px] ${isMobile ? 'activities-manual-preview--mobile' : ''} ${closing ? 'activities-manual-preview--closing' : ''}`}
      style={positionStyle}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-labelledby={`manual-activity-preview-${activity.id}`}
    >
      <header className="activities-manual-preview__header flex shrink-0 items-start justify-between gap-4 border-b border-[var(--surface-border)] px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="activities-manual-preview__badge activities-manual-preview__badge--type rounded-full border border-sky-200/80 bg-sky-50 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] text-sky-700">{manualActivityTypeLabel(activity.activity_type)}</span>
            <span className={`activities-manual-preview__badge rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.08em] ${activity.status === 'planned' ? 'activities-manual-preview__badge--planned border-amber-200/80 bg-amber-50 text-amber-700' : 'activities-manual-preview__badge--logged border-emerald-200/80 bg-emerald-50 text-emerald-700'}`}>{manualActivityStatusLabel(activity.status)}</span>
          </div>
          <h3 id={`manual-activity-preview-${activity.id}`} className="mt-2.5 break-words text-lg font-semibold leading-6 text-[var(--text-primary)]">{activity.title}</h3>
        </div>
        <button type="button" onClick={requestClose} aria-label="Zavřít náhled aktivity" className="activities-manual-preview__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--text-secondary)] shadow-sm transition hover:-translate-y-px hover:border-[#9dc7e5] hover:text-[var(--text-primary)]"><X aria-hidden size={16} /></button>
      </header>

      <div className="activities-manual-preview__body min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
        <div className="activities-manual-preview__meta grid gap-2.5 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] p-3.5 sm:grid-cols-2">
          <div className="flex min-w-0 items-start gap-2.5"><UserRound aria-hidden size={15} className="mt-0.5 shrink-0 text-sky-600" /><div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Klient</p><p className="mt-0.5 break-words text-xs font-semibold text-[var(--text-primary)]">{activity.client_name ?? 'Bez klienta'}</p></div></div>
          <div className="flex min-w-0 items-start gap-2.5">{activity.status === 'planned' ? <CalendarClock aria-hidden size={15} className="mt-0.5 shrink-0 text-amber-600" /> : <Clock3 aria-hidden size={15} className="mt-0.5 shrink-0 text-emerald-600" />}<div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">{dateLabel}</p><p className="mt-0.5 text-xs font-semibold text-[var(--text-primary)]">{formatManualActivityDateTime(dateValue, true)}</p></div></div>
          {activity.user_name ? <div className="flex min-w-0 items-start gap-2.5 sm:col-span-2"><UserRound aria-hidden size={15} className="mt-0.5 shrink-0 text-violet-500" /><div className="min-w-0"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Uživatel</p><p className="mt-0.5 break-words text-xs font-semibold text-[var(--text-primary)]">{activity.user_name}</p></div></div> : null}
          {activity.status === 'planned' && activity.reminder_enabled ? <div className="flex items-center gap-2.5 sm:col-span-2"><Bell aria-hidden size={15} className="shrink-0 text-sky-600" /><p className="text-xs font-semibold text-sky-700">Připomínka je zapnutá · 15 minut předem</p></div> : null}
          {activity.status === 'planned' && activity.recurrence_unit ? <div className="flex items-center gap-2.5 sm:col-span-2"><Repeat2 aria-hidden size={15} className="shrink-0 text-violet-500" /><p className="text-xs font-semibold text-violet-700 [html[data-theme='dark']_&]:text-violet-300">{manualActivityRecurrenceLabel(activity.recurrence_unit, activity.recurrence_interval)} · další termín vznikne po dokončení</p></div> : null}
        </div>

        <section className="mt-4">
          <h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Plné znění</h4>
          <div className="activities-manual-preview__content mt-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-4 py-3.5">
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-[var(--text-primary)]">{activity.description?.trim() || 'Bez doplňujícího textu.'}</p>
          </div>
        </section>

        {activity.completion_result?.trim() ? <section className="mt-4"><h4 className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--text-secondary)]">Výsledek</h4><div className="activities-manual-preview__result mt-2 rounded-2xl border border-emerald-200/75 bg-emerald-50/75 px-4 py-3.5 [html[data-theme='dark']_&]:border-emerald-400/20 [html[data-theme='dark']_&]:bg-emerald-500/10"><p className="whitespace-pre-wrap break-words text-sm leading-6 text-emerald-900 [html[data-theme='dark']_&]:text-emerald-200">{activity.completion_result}</p></div></section> : null}
      </div>

      {canManage ? (
        <footer className="activities-manual-preview__footer flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-[var(--surface-border)] px-5 py-3.5">
          {activity.status === 'planned' ? <button type="button" disabled={pending} onClick={onComplete} className="activities-manual-preview__complete inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 text-[10px] font-bold uppercase text-emerald-700 transition hover:-translate-y-px hover:border-emerald-300 hover:bg-emerald-100 disabled:opacity-50 [html[data-theme='dark']_&]:border-emerald-400/20 [html[data-theme='dark']_&]:bg-emerald-500/10 [html[data-theme='dark']_&]:text-emerald-300"><Check aria-hidden size={13} /> Dokončit</button> : null}
          <button type="button" disabled={pending} onClick={onEdit} className="activities-manual-preview__secondary inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3.5 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition hover:-translate-y-px hover:border-[#9dc7e5] hover:text-[var(--text-primary)] disabled:opacity-50"><Pencil aria-hidden size={12} /> Upravit</button>
          <button type="button" disabled={pending} onClick={onDelete} className={`activities-manual-preview__delete inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border px-3.5 text-[10px] font-bold uppercase transition hover:-translate-y-px disabled:opacity-50 ${deleteArmed ? 'border-rose-700 bg-rose-700 text-white' : 'border-rose-200 bg-rose-50 text-rose-700 hover:border-rose-300 hover:bg-rose-100'}`}>{pending && deleteArmed ? <LoaderCircle aria-hidden size={12} className="animate-spin" /> : <X aria-hidden size={13} />}{deleteArmed ? 'SMAZAT' : 'Odstranit'}</button>
        </footer>
      ) : null}
    </section>
  )
}

export function ManualActivityControls({ activity, clients, canManage = true, initiallyEditing = false, previewOpen = false, previewAnchor = null, previewTrigger = null, onPreviewClose }: {
  activity: ActivityListItem
  clients: ActivityClientOption[]
  canManage?: boolean
  initiallyEditing?: boolean
  previewOpen?: boolean
  previewAnchor?: ManualActivityPreviewAnchor | null
  previewTrigger?: HTMLElement | null
  onPreviewClose?: () => void
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(initiallyEditing)
  const [completing, setCompleting] = useState(false)
  const [deleteArmed, setDeleteArmed] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [pending, startTransition] = useTransition()
  const [mounted] = useState(() => typeof window !== 'undefined')
  const { toast, isVisible, showToast } = useAnimatedActionToast()
  const updateAction = useMemo(
    () => updateManualActivityAction.bind(null, activity.id) as (
      state: ActivityActionState,
      formData: FormData,
    ) => Promise<ActivityActionState>,
    [activity.id],
  )

  useEffect(() => {
    if (!deleteArmed) return
    const timer = window.setTimeout(() => setDeleteArmed(false), 3500)
    return () => window.clearTimeout(timer)
  }, [deleteArmed])

  function showError(message: string) {
    showToast({ title: 'CHYBA', message, tone: 'error' })
  }

  function openEdit() {
    setDeleteArmed(false)
    onPreviewClose?.()
    setFormKey((current) => current + 1)
    setEditing(true)
  }

  function openComplete() {
    setDeleteArmed(false)
    onPreviewClose?.()
    setCompleting(true)
  }

  function handleEdited() {
    setEditing(false)
    showToast({ title: 'AKTIVITA UPRAVENA', message: 'Změny byly uloženy.', tone: 'success' })
    router.refresh()
  }

  function completeActivity(result: string) {
    startTransition(async () => {
      const response = await completeManualActivityAction(activity.id, { result })
      if (!response.success) {
        showError(response.error ?? 'Aktivitu se nepodařilo dokončit.')
        return
      }
      setCompleting(false)
      showToast({
        title: 'AKTIVITA DOKONČENA',
        message: response.nextActivityId
          ? 'Aktivita byla dokončena a další termín byl automaticky naplánován.'
          : 'Aktivita byla přesunuta do posledních zápisů.',
        tone: 'success',
      })
      router.refresh()
    })
  }

  function requestDelete() {
    if (!deleteArmed) {
      setDeleteArmed(true)
      return
    }

    startTransition(async () => {
      const response = await deleteManualActivityAction(activity.id)
      if (!response.success) {
        setDeleteArmed(false)
        showError(response.error ?? 'Aktivitu se nepodařilo odstranit.')
        return
      }
      showToast({ title: 'AKTIVITA ODSTRANĚNA', message: 'Záznam byl přesunut mimo aktivní historii.', tone: 'success' })
      onPreviewClose?.()
      router.refresh()
    })
  }

  return (
    <>
      {canManage ? <div className="activities-workspace__manual-actions hidden shrink-0 items-center gap-1 sm:flex" aria-label="Akce ruční aktivity">
        {activity.status === 'planned' ? (
          <button type="button" disabled={pending} onClick={openComplete} aria-label="Dokončit aktivitu" title="Dokončit aktivitu" className="activities-workspace__manual-action activities-workspace__manual-action--complete">
            <Check aria-hidden size={14} />
          </button>
        ) : null}
        <button type="button" disabled={pending} onClick={openEdit} aria-label="Upravit aktivitu" title="Upravit aktivitu" className="activities-workspace__manual-action">
          <Pencil aria-hidden size={13} />
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={requestDelete}
          aria-label={deleteArmed ? 'Potvrdit odstranění aktivity' : 'Odstranit aktivitu'}
          title={deleteArmed ? 'Kliknutím potvrďte odstranění' : activity.recurrence_unit ? 'Odstranit a ukončit další opakování' : 'Odstranit aktivitu'}
          className={`activities-workspace__manual-action activities-workspace__manual-action--delete ${deleteArmed ? 'activities-workspace__manual-action--armed' : ''}`}
        >
          {pending && deleteArmed ? <LoaderCircle aria-hidden size={13} className="animate-spin" /> : deleteArmed ? 'SMAZAT' : <X aria-hidden size={14} />}
        </button>
      </div> : null}
      {mounted && previewOpen && previewAnchor ? createPortal(
        <ManualActivityPreviewPopover
          activity={activity}
          anchor={previewAnchor}
          trigger={previewTrigger}
          canManage={canManage}
          pending={pending}
          deleteArmed={deleteArmed}
          onClose={() => onPreviewClose?.()}
          onEdit={openEdit}
          onComplete={openComplete}
          onDelete={requestDelete}
        />,
        document.body,
      ) : null}
      {mounted && canManage && editing ? createPortal(
        <ActivityFormModal key={formKey} clients={clients} activity={activity} action={updateAction} onClose={() => setEditing(false)} onSaved={handleEdited} />,
        document.body,
      ) : null}
      {mounted && canManage && completing ? createPortal(
        <CompleteActivityModal activity={activity} pending={pending} onClose={() => { if (!pending) setCompleting(false) }} onComplete={completeActivity} />,
        document.body,
      ) : null}
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}
    </>
  )
}
