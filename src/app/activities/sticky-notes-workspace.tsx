'use client'

import Link from 'next/link'
import { useActionState, useCallback, useEffect, useMemo, useRef, useState, useTransition, type UIEvent } from 'react'
import { createPortal, useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  Archive,
  Bell,
  BellOff,
  Check,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  ListTodo,
  LoaderCircle,
  MessageSquareText,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react'
import { ActionFeedbackToast, useAnimatedActionToast } from '@/components/ui/action-feedback-toast'
import { CreateTaskModal } from '@/app/tasks/new-task-button'
import { ModalHeading } from '@/components/ui/modal-heading'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import type { ActivityClientOption } from '@/lib/activities/types'
import {
  STICKY_NOTE_COLORS,
  type StickyNoteActionState,
  type StickyNoteColor,
  type StickyNoteCounts,
  type StickyNoteListItem,
  type StickyNoteView,
} from '@/lib/sticky-notes/types'
import {
  archiveStickyNoteAction,
  createStickyNoteAction,
  getStickyNotesViewAction,
  moveStickyNoteToTrashAction,
  permanentlyDeleteStickyNoteAction,
  restoreStickyNoteFromArchiveAction,
  restoreStickyNoteFromTrashAction,
  recordStickyNoteConversionAction,
  setStickyNotePinnedAction,
  updateStickyNoteAction,
} from './sticky-note-actions'
import { ActivityFormModal } from './new-activity-button'
import { createManualActivityAction } from './actions'

const INITIAL_STATE: StickyNoteActionState = { success: false, error: null }
const STICKY_MANAGER_INITIAL_LIMIT = 100
const STICKY_MANAGER_BATCH_SIZE = 50
const COLOR_LABELS: Record<StickyNoteColor, string> = {
  yellow: 'Žlutá',
  blue: 'Modrá',
  green: 'Zelená',
  pink: 'Růžová',
  purple: 'Fialová',
  gray: 'Šedá',
}

type StickyFormAction = (
  state: StickyNoteActionState,
  formData: FormData,
) => Promise<StickyNoteActionState>
type NoteAction = 'pin' | 'archive' | 'trash' | 'restore-archive' | 'restore-trash' | 'delete'
type ConfirmableNoteAction = Extract<NoteAction, 'archive' | 'trash' | 'delete'>
type ArmedNoteAction = { noteId: string; action: ConfirmableNoteAction } | null
type ConversionType = 'task' | 'activity'
type ConversionSelection = { note: StickyNoteListItem; type: ConversionType }

type TaskUserOption = { id: string; name: string | null; role: string | null }
type TaskContactOption = { id: string; client_id: string; name: string; is_primary: boolean }

function StickyNoteSubmitButton({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus()

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[#2473aa] bg-[linear-gradient(155deg,#4d96cb_0%,#2f7fb8_55%,#236a9e_100%)] px-5 text-sm font-semibold text-white shadow-[0_10px_22px_rgba(35,106,158,0.25)] transition hover:-translate-y-px hover:border-[#1f5f8e] hover:bg-[linear-gradient(155deg,#458bc0_0%,#286fa7_55%,#1d5f91_100%)] hover:shadow-[0_12px_24px_rgba(35,106,158,0.32)] disabled:cursor-wait disabled:opacity-60"
    >
      {pending ? 'UKLÁDÁM…' : editing ? 'ULOŽIT ZMĚNY' : 'VYTVOŘIT LÍSTEČEK'}
    </button>
  )
}

function getConversionTitle(note: StickyNoteListItem) {
  const fallback = note.content.trim().split(/\r?\n/)[0] || 'Záznam z Lístečku'
  return (note.title?.trim() || fallback).slice(0, 240)
}

function toLocalDateTimeInput(value: string | null) {
  const date = value ? new Date(value) : new Date(Date.now() + 24 * 60 * 60 * 1000)
  if (!value) date.setHours(9, 0, 0, 0)
  const pad = (number: number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function normalizeClientSearch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('cs-CZ')
    .trim()
}

function formatStickyNoteDate(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function StickyNoteFormModal({
  clients,
  note,
  onClose,
  onSaved,
}: {
  clients: ActivityClientOption[]
  note: StickyNoteListItem | null
  onClose: () => void
  onSaved: () => void
}) {
  const updateAction = useMemo(
    () => note
      ? updateStickyNoteAction.bind(null, note.id) as StickyFormAction
      : createStickyNoteAction,
    [note],
  )
  const [state, formAction] = useActionState(updateAction, INITIAL_STATE)
  const [color, setColor] = useState<StickyNoteColor>(note?.color ?? 'yellow')
  const [isPinned, setIsPinned] = useState(note?.is_pinned ?? false)
  const [reminderEnabled, setReminderEnabled] = useState(note?.reminder_enabled ?? false)
  const initialClient = clients.find((client) => client.id === note?.client_id) ?? null
  const clientInputRef = useRef<HTMLInputElement>(null)
  const [clientId, setClientId] = useState(initialClient?.id ?? '')
  const [clientQuery, setClientQuery] = useState(initialClient?.name ?? '')
  const [clientFilter, setClientFilter] = useState(initialClient?.name ?? '')
  const [clientSuggestionsOpen, setClientSuggestionsOpen] = useState(false)
  const [activeClientIndex, setActiveClientIndex] = useState(0)
  const filteredClients = useMemo(() => {
    const normalizedFilter = normalizeClientSearch(clientFilter)
    if (!normalizedFilter) return clients.slice(0, 8)
    return clients
      .filter((client) => normalizeClientSearch(client.name).includes(normalizedFilter))
      .sort((left, right) => {
        const leftStarts = normalizeClientSearch(left.name).startsWith(normalizedFilter)
        const rightStarts = normalizeClientSearch(right.name).startsWith(normalizedFilter)
        return Number(rightStarts) - Number(leftStarts) || left.name.localeCompare(right.name, 'cs')
      })
      .slice(0, 8)
  }, [clientFilter, clients])
  useBodyScrollLock(true)

  function selectClient(client: ActivityClientOption) {
    setClientId(client.id)
    setClientQuery(client.name)
    setClientFilter(client.name)
    setClientSuggestionsOpen(false)
    setActiveClientIndex(0)
  }

  function handleClientChange(value: string) {
    if (!value) {
      setClientId('')
      setClientQuery('')
      setClientFilter('')
      setClientSuggestionsOpen(true)
      setActiveClientIndex(0)
      return
    }

    const normalizedValue = normalizeClientSearch(value)
    const prefixMatch = clients.find((client) => normalizeClientSearch(client.name).startsWith(normalizedValue))

    setClientFilter(value)
    setClientSuggestionsOpen(true)
    setActiveClientIndex(0)

    if (!prefixMatch) {
      setClientId('')
      setClientQuery(value)
      return
    }

    setClientId(prefixMatch.id)
    setClientQuery(prefixMatch.name)
    requestAnimationFrame(() => {
      clientInputRef.current?.setSelectionRange(value.length, prefixMatch.name.length)
    })
  }

  function handleClientKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && clientSuggestionsOpen) {
      event.preventDefault()
      event.stopPropagation()
      setClientSuggestionsOpen(false)
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      setClientSuggestionsOpen(true)
      setActiveClientIndex((current) => {
        if (filteredClients.length === 0) return 0
        const direction = event.key === 'ArrowDown' ? 1 : -1
        return (current + direction + filteredClients.length) % filteredClients.length
      })
      return
    }

    if (event.key === 'Enter' && clientSuggestionsOpen && filteredClients[activeClientIndex]) {
      event.preventDefault()
      selectClient(filteredClients[activeClientIndex])
    }
  }

  useEffect(() => {
    if (state.success) onSaved()
  }, [onSaved, state.success])

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  return (
    <div className="activities-sticky-form fixed inset-0 z-[145] overflow-y-auto bg-zinc-950/42 p-3 backdrop-blur-[5px] sm:p-4" role="dialog" aria-modal="true" aria-labelledby="sticky-form-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="flex min-h-full items-center justify-center py-3 sm:py-5">
        <section className="activities-sticky-form__shell w-full max-w-2xl overflow-hidden rounded-3xl border border-zinc-200/85 bg-[linear-gradient(168deg,rgba(255,255,255,0.98)_0%,rgba(249,250,251,0.96)_48%,rgba(244,244,245,0.94)_100%)] shadow-[0_34px_88px_rgba(24,24,27,0.38)]">
          <header className="activities-sticky-form__header flex items-start justify-between gap-4 border-b border-zinc-200/75 px-5 py-4 sm:px-6">
            <ModalHeading id="sticky-form-title" section="LÍSTEČKY" title={note ? 'Upravit Lísteček' : 'Nový Lísteček'} />
            <button type="button" onClick={onClose} aria-label="Zavřít" className="activities-modal__close activities-sticky__secondary inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white/90 text-zinc-600 shadow-sm transition hover:-translate-y-px hover:border-[#9dc7e5] hover:bg-white hover:text-zinc-900"><X aria-hidden size={18} /></button>
          </header>
          <form action={formAction} className="px-5 py-5 sm:px-6">
            <input type="hidden" name="color" value={color} />
            <input type="hidden" name="is_pinned" value={isPinned ? 'true' : 'false'} />
            <input type="hidden" name="reminder_enabled" value={reminderEnabled ? 'true' : 'false'} />

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="activities-modal__label text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Nadpis <span className="font-normal normal-case tracking-normal text-zinc-400">(volitelný)</span><input name="title" maxLength={120} defaultValue={note?.title ?? ''} placeholder="Krátký nadpis" className="activities-modal__input mt-2 w-full rounded-xl border border-zinc-200 bg-white/85 px-4 py-3 text-sm font-normal normal-case tracking-normal text-zinc-900 outline-none focus:border-[#6fa9d1] focus:ring-2 focus:ring-[#b9d8ef]/55" /></label>
              <div>
                <label htmlFor="sticky-client" className="activities-modal__label text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Klient <span className="font-normal normal-case tracking-normal text-zinc-400">(volitelný)</span></label>
                <input type="hidden" name="client_id" value={clientId} />
                <div className="relative mt-2">
                  <input
                    ref={clientInputRef}
                    id="sticky-client"
                    type="text"
                    role="combobox"
                    aria-autocomplete="both"
                    aria-expanded={clientSuggestionsOpen}
                    aria-controls="sticky-client-suggestions"
                    aria-activedescendant={clientSuggestionsOpen && filteredClients[activeClientIndex] ? `sticky-client-option-${filteredClients[activeClientIndex].id}` : undefined}
                    autoComplete="off"
                    value={clientQuery}
                    onChange={(event) => handleClientChange(event.target.value)}
                    onFocus={() => setClientSuggestionsOpen(true)}
                    onBlur={() => window.setTimeout(() => {
                      setClientSuggestionsOpen(false)
                      if (!clientId) {
                        setClientQuery('')
                        setClientFilter('')
                      }
                    }, 120)}
                    onKeyDown={handleClientKeyDown}
                    className="activities-modal__input w-full rounded-xl border border-zinc-200 bg-white/85 px-4 py-3 text-sm font-normal normal-case tracking-normal text-zinc-900 outline-none focus:border-[#6fa9d1] focus:ring-2 focus:ring-[#b9d8ef]/55"
                    placeholder="Začněte psát název klienta"
                  />
                  {clientSuggestionsOpen ? (
                    <div id="sticky-client-suggestions" role="listbox" className="activities-modal__client-suggestions absolute inset-x-0 top-[calc(100%+0.4rem)] z-30 max-h-56 overflow-y-auto rounded-xl border border-zinc-200 bg-white p-1.5 shadow-[0_18px_40px_rgba(24,24,27,0.18)]">
                      {filteredClients.length > 0 ? filteredClients.map((client, index) => (
                        <button
                          key={client.id}
                          id={`sticky-client-option-${client.id}`}
                          type="button"
                          role="option"
                          aria-selected={client.id === clientId}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => selectClient(client)}
                          className={`activities-modal__client-suggestion flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition ${index === activeClientIndex ? 'activities-modal__client-suggestion--active bg-sky-50 text-sky-800' : 'text-zinc-700 hover:bg-zinc-50'}`}
                        >
                          {client.name}
                        </button>
                      )) : <p className="px-3 py-2 text-sm text-zinc-500">Žádný klient nenalezen.</p>}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <label className="activities-modal__label mt-4 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Obsah<textarea name="content" maxLength={1000} rows={6} defaultValue={note?.content ?? ''} placeholder="Co si nechcete zapomenout?" className="activities-modal__input mt-2 h-32 min-h-32 w-full resize-y rounded-2xl border border-zinc-200 bg-white/85 px-4 py-3 text-sm font-normal normal-case leading-6 tracking-normal text-zinc-900 outline-none focus:border-[#6fa9d1] focus:ring-2 focus:ring-[#b9d8ef]/55 sm:h-auto sm:min-h-36" /></label>

            <fieldset className="mt-4">
              <legend className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Barva</legend>
              <div className="mt-2 grid grid-cols-6 gap-2 sm:flex sm:flex-wrap">
                {STICKY_NOTE_COLORS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setColor(option)}
                    aria-label={COLOR_LABELS[option]}
                    aria-pressed={color === option}
                    title={COLOR_LABELS[option]}
                    className="activities-sticky__color flex h-10 w-full items-center justify-center gap-2 rounded-full border p-0 text-xs font-semibold text-zinc-700 sm:w-auto sm:rounded-xl sm:px-3"
                    data-color={option}
                    data-selected={color === option}
                  >
                    <span className="activities-sticky__color-swatch relative flex h-6 w-6 items-center justify-center rounded-full border border-black/10 sm:h-4 sm:w-4">
                      {color === option ? <Check aria-hidden className="h-[13px] w-[13px] text-white drop-shadow-sm sm:h-[10px] sm:w-[10px]" strokeWidth={3} /> : null}
                    </span>
                    <span className="hidden bg-transparent sm:inline" style={{ background: 'transparent' }}>{COLOR_LABELS[option]}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
              <button type="button" onClick={() => setIsPinned((current) => !current)} aria-pressed={isPinned} className={`activities-sticky__toggle flex min-h-12 min-w-0 items-center gap-2 rounded-2xl border px-2 text-left sm:gap-3 sm:px-4 ${isPinned ? 'activities-sticky__toggle--active' : ''}`}><span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/12 text-amber-600">{isPinned ? <Pin aria-hidden size={15} /> : <PinOff aria-hidden size={15} />}{isPinned ? <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-amber-500 text-white shadow-sm [html[data-theme='dark']_&]:border-slate-900"><Check aria-hidden size={9} strokeWidth={3} /></span> : null}</span><span className="min-w-0"><strong className="block truncate text-xs text-zinc-900 sm:text-sm"><span className="sm:hidden">Připnout</span><span className="hidden sm:inline">Připnout nahoru</span></strong><span className="hidden text-[11px] text-zinc-500 sm:block">Lísteček bude mezi prvními.</span></span></button>
              <button type="button" onClick={() => setReminderEnabled((current) => !current)} aria-pressed={reminderEnabled} className={`activities-sticky__toggle flex min-h-12 min-w-0 items-center gap-2 rounded-2xl border px-2 text-left sm:gap-3 sm:px-4 ${reminderEnabled ? 'activities-sticky__toggle--active' : ''}`}><span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-500/12 text-sky-600">{reminderEnabled ? <Bell aria-hidden size={15} /> : <BellOff aria-hidden size={15} />}{reminderEnabled ? <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full border-2 border-white bg-sky-500 text-white shadow-sm [html[data-theme='dark']_&]:border-slate-900"><Check aria-hidden size={9} strokeWidth={3} /></span> : null}</span><span className="min-w-0"><strong className="block truncate text-xs text-zinc-900 sm:text-sm">Připomenout</strong><span className="hidden text-[11px] text-zinc-500 sm:block">Notifikace přijde 15 minut předem.</span></span></button>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-zinc-500 sm:hidden">Připomenutí přijde 15 minut před termínem.</p>

            {reminderEnabled ? <label className="activities-modal__label mt-4 block text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Termín Lístečku<input type="datetime-local" name="reminder_at" required defaultValue={toLocalDateTimeInput(note?.reminder_at ?? null)} className="activities-modal__input mt-2 w-full rounded-xl border border-zinc-200 bg-white/85 px-4 py-3 text-sm font-normal normal-case tracking-normal text-zinc-900 outline-none focus:border-[#6fa9d1] focus:ring-2 focus:ring-[#b9d8ef]/55" /></label> : null}

            {state.error ? <div role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{state.error}</div> : null}

            <footer className="mt-5 flex justify-end border-t border-zinc-200/75 pt-4"><StickyNoteSubmitButton editing={Boolean(note)} /></footer>
          </form>
        </section>
      </div>
    </div>
  )
}

function StickyNotePreviewPopover({
  note,
  anchor,
  triggerRef,
  onClose,
  onEdit,
  onAction,
  onConvert,
  armedAction,
}: {
  note: StickyNoteListItem
  anchor: { top: number; right: number; bottom: number; left: number }
  triggerRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  onEdit: (note: StickyNoteListItem) => void
  onAction: (action: NoteAction, note: StickyNoteListItem) => void
  onConvert: (note: StickyNoteListItem, type: ConversionType) => void
  armedAction: ConfirmableNoteAction | null
}) {
  const popupRef = useRef<HTMLElement>(null)
  const closeTimerRef = useRef<number | null>(null)
  const [closing, setClosing] = useState(false)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const mobile = viewport.width < 640
  const width = Math.min(460, viewport.width - 24)
  const availableOnRight = viewport.width - anchor.right - 12
  const left = availableOnRight >= width
    ? anchor.right + 10
    : Math.max(12, Math.min(anchor.left, viewport.width - width - 12))
  const top = Math.max(12, Math.min(anchor.top - 32, viewport.height - Math.min(560, viewport.height - 24) - 12))

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
    function closeOnOutsidePointer(event: PointerEvent) {
      const target = event.target as Node
      if (popupRef.current?.contains(target) || triggerRef.current?.contains(target)) return
      requestClose()
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') requestClose()
    }
    function updateViewport() {
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    window.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', updateViewport)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      window.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', updateViewport)
    }
  }, [requestClose, triggerRef])

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
  }, [])

  function runAndClose(action: () => void) {
    onClose()
    action()
  }

  function confirmAction(action: ConfirmableNoteAction) {
    const isConfirmed = armedAction === action
    onAction(action, note)
    if (isConfirmed) onClose()
  }

  return createPortal(
    <section
      ref={popupRef}
      role="dialog"
      aria-modal="false"
      aria-label={`Detail Lístečku ${note.title || 'Bez nadpisu'}`}
      className={`activities-workspace__sticky activities-sticky-preview fixed z-[142] flex max-h-[min(560px,calc(100dvh-24px))] flex-col overflow-hidden rounded-[26px] border shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_26px_64px_rgba(15,23,42,0.28)] ${mobile ? 'activities-sticky-preview--mobile inset-x-3' : ''} ${closing ? 'activities-sticky-preview--closing' : ''}`}
      data-color={note.color}
      style={mobile ? { top: '50%', transform: 'translateY(-50%)' } : { width, left, top }}
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-black/10 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-700/55">Detail Lístečku</p>
          <h2 className="mt-1 break-words text-xl font-semibold leading-tight text-zinc-900">{note.title || 'Bez nadpisu'}</h2>
          <div className="activities-sticky__status-indicators mt-2 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-700/60">
            {note.is_pinned ? <span className="inline-flex items-center gap-1"><Pin aria-hidden size={12} /> Připnuto</span> : null}
            {note.reminder_enabled ? <span className="inline-flex items-center gap-1"><Bell aria-hidden size={12} /> Připomínka</span> : null}
            {note.archived_at ? <span>Archivováno</span> : null}
            {note.deleted_at ? <span>V koši</span> : null}
          </div>
        </div>
        <button type="button" onClick={requestClose} aria-label="Zavřít detail Lístečku" className="activities-sticky__icon-action h-9 min-w-9 rounded-xl bg-white/45"><X aria-hidden size={16} /></button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
        <p className="whitespace-pre-wrap break-words text-sm leading-6 text-zinc-900/85">{note.content || 'Bez dalšího obsahu.'}</p>

        <dl className="mt-5 grid gap-3 border-t border-black/10 pt-4 text-xs sm:grid-cols-2">
          <div><dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-700/50">Klient</dt><dd className="mt-1 font-semibold text-zinc-800/80">{note.client_name ?? 'Soukromý lísteček'}</dd></div>
          {note.reminder_enabled && note.reminder_at ? <div><dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-700/50">Připomenutí</dt><dd className="mt-1 font-semibold text-zinc-800/80">{formatStickyNoteDate(note.reminder_at)}</dd></div> : null}
        </dl>

        {note.conversions.length > 0 ? <div className="mt-4"><p className="text-[9px] font-bold uppercase tracking-[0.12em] text-zinc-700/50">Navázané záznamy</p><div className="mt-2 flex flex-wrap gap-2">{note.conversions.map((conversion) => <Link key={conversion.id} href={conversion.target_path} onClick={onClose} title={conversion.target_title} className="activities-sticky__conversion-link inline-flex max-w-full items-center gap-1.5 rounded-xl border border-black/10 bg-white/40 px-3 py-2 text-[10px] font-semibold uppercase text-zinc-700/75 transition hover:-translate-y-px hover:bg-white/65"><span className="truncate">{conversion.target_type === 'task' ? 'Úkol' : 'Aktivita'} · {conversion.target_title}</span><ExternalLink aria-hidden size={11} /></Link>)}</div></div> : null}
      </div>

      <footer className="flex shrink-0 flex-nowrap items-center gap-2 border-t border-black/10 px-5 py-3 sm:px-6">
        {!note.archived_at && !note.deleted_at ? <>
          <button type="button" onClick={() => runAndClose(() => onConvert(note, 'task'))} title="Převést na úkol" aria-label="Převést Lísteček na úkol" className="activities-sticky__icon-action rounded-xl"><ListTodo aria-hidden size={15} /></button>
          <button type="button" onClick={() => runAndClose(() => onConvert(note, 'activity'))} title="Převést na aktivitu" aria-label="Převést Lísteček na aktivitu" className="activities-sticky__icon-action rounded-xl"><MessageSquareText aria-hidden size={15} /></button>
          <span className="flex-1" />
          <button type="button" onClick={() => runAndClose(() => onAction('pin', note))} title={note.is_pinned ? 'Odepnout Lísteček' : 'Připnout Lísteček'} aria-label={note.is_pinned ? 'Odepnout Lísteček' : 'Připnout Lísteček'} className="activities-sticky__icon-action rounded-xl">{note.is_pinned ? <PinOff aria-hidden size={15} /> : <Pin aria-hidden size={15} />}</button>
          <button type="button" onClick={() => runAndClose(() => onEdit(note))} title="Upravit Lísteček" aria-label="Upravit Lísteček" className="activities-sticky__icon-action rounded-xl"><Pencil aria-hidden size={15} /></button>
          {armedAction === 'archive' ? <button type="button" data-sticky-confirm={`${note.id}-archive`} onClick={() => confirmAction('archive')} className="activities-sticky__text-action activities-sticky__text-action--confirm h-9 rounded-xl px-3">ARCHIVOVAT</button> : armedAction === 'trash' ? <button type="button" data-sticky-confirm={`${note.id}-trash`} onClick={() => confirmAction('trash')} className="activities-sticky__text-action activities-sticky__text-action--danger activities-sticky__text-action--armed h-9 rounded-xl px-3">DO KOŠE</button> : <><button type="button" onClick={() => confirmAction('archive')} title="Archivovat Lísteček" aria-label="Archivovat Lísteček" className="activities-sticky__icon-action rounded-xl"><Archive aria-hidden size={15} /></button><button type="button" onClick={() => confirmAction('trash')} title="Přesunout Lísteček do koše" aria-label="Přesunout Lísteček do koše" className="activities-sticky__icon-action activities-sticky__icon-action--danger rounded-xl"><Trash2 aria-hidden size={15} /></button></>}
        </> : null}
        {note.archived_at && !note.deleted_at ? armedAction === 'trash' ? <button type="button" data-sticky-confirm={`${note.id}-trash`} onClick={() => confirmAction('trash')} className="activities-sticky__text-action activities-sticky__text-action--danger activities-sticky__text-action--armed h-9 rounded-xl px-3">DO KOŠE</button> : <><button type="button" onClick={() => runAndClose(() => onAction('restore-archive', note))} className="activities-sticky__text-action h-9 rounded-xl px-3"><RotateCcw aria-hidden size={14} /> OBNOVIT</button><button type="button" onClick={() => confirmAction('trash')} className="activities-sticky__text-action activities-sticky__text-action--danger h-9 rounded-xl px-3"><Trash2 aria-hidden size={14} /> KOŠ</button></> : null}
        {note.deleted_at ? <><button type="button" onClick={() => runAndClose(() => onAction('restore-trash', note))} className="activities-sticky__text-action h-9 rounded-xl px-3"><RotateCcw aria-hidden size={14} /> OBNOVIT</button><button type="button" data-sticky-confirm={armedAction === 'delete' ? `${note.id}-delete` : undefined} onClick={() => confirmAction('delete')} className={`activities-sticky__text-action activities-sticky__text-action--danger h-9 rounded-xl px-3 ${armedAction === 'delete' ? 'activities-sticky__text-action--armed' : ''}`}>{armedAction === 'delete' ? 'SMAZAT' : <><Trash2 aria-hidden size={14} /> NAVŽDY</>}</button></> : null}
      </footer>
    </section>,
    document.body,
  )
}

function NoteCard({
  note,
  compact = false,
  mobileDeck = false,
  onEdit,
  onAction,
  onConvert,
  focused = false,
  armedAction = null,
}: {
  note: StickyNoteListItem
  compact?: boolean
  mobileDeck?: boolean
  onEdit: (note: StickyNoteListItem) => void
  onAction: (action: NoteAction, note: StickyNoteListItem) => void
  onConvert: (note: StickyNoteListItem, type: ConversionType) => void
  focused?: boolean
  armedAction?: ConfirmableNoteAction | null
}) {
  const articleRef = useRef<HTMLElement>(null)
  const [previewAnchor, setPreviewAnchor] = useState<{ top: number; right: number; bottom: number; left: number } | null>(null)

  useEffect(() => {
    const article = articleRef.current
    if (!article || !mobileDeck) return

    article.style.setProperty(
      'box-shadow',
      'inset 0 1px 0 rgba(255, 255, 255, 0.36), 0 16px 50px -20px rgba(15, 23, 42, 0.11)',
      'important',
    )

    return () => {
      article.style.removeProperty('box-shadow')
    }
  }, [mobileDeck])

  function openPreview() {
    const rect = articleRef.current?.getBoundingClientRect()
    if (!rect) return
    setPreviewAnchor({ top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left })
  }

  function handleCardClick(event: React.MouseEvent<HTMLElement>) {
    if ((event.target as HTMLElement).closest('button, a, input, select, textarea')) return
    openPreview()
  }

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    openPreview()
  }

  return (
    <>
    <article ref={articleRef} role="button" tabIndex={0} aria-label={`Otevřít detail Lístečku ${note.title || 'Bez nadpisu'}`} onClick={handleCardClick} onKeyDown={handleCardKeyDown} className={`activities-workspace__sticky activities-workspace__sticky--interactive group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_8px_18px_rgba(15,23,42,0.08)] ${compact ? 'min-h-36' : 'min-h-32'} ${focused ? 'activities-workspace__notification-focus' : ''}`} data-color={note.color} data-sticky-note-id={note.id}>
      <div className="flex items-start justify-between gap-2"><h3 className="line-clamp-1 text-sm font-semibold text-zinc-900">{note.title || 'Bez nadpisu'}</h3><div className="activities-sticky__status-indicators flex shrink-0 items-center gap-1.5 text-zinc-700/65">{note.reminder_enabled ? <Bell aria-label="Připomínka zapnuta" size={13} /> : null}{note.is_pinned ? <Pin aria-label="Připnuto" size={13} /> : null}</div></div>
      <p className={`${compact ? 'line-clamp-4 min-h-20' : 'line-clamp-3 min-h-15'} mt-2 whitespace-pre-line text-xs leading-5 text-zinc-800/80`}>{note.content || 'Bez dalšího obsahu.'}</p>
      <p className="mt-3 truncate text-[10px] font-medium uppercase tracking-wide text-zinc-700/60">{note.client_name ?? 'Soukromý lísteček'}</p>
      {note.conversions.length > 0 ? <div className="mt-2 flex flex-wrap gap-1.5">{note.conversions.map((conversion) => <Link key={conversion.id} href={conversion.target_path} title={conversion.target_title} className="activities-sticky__conversion-link inline-flex max-w-full items-center gap-1 rounded-lg border border-black/10 bg-white/35 px-2 py-1 text-[9px] font-semibold uppercase text-zinc-700/75 transition hover:bg-white/60"><span className="truncate">{conversion.target_type === 'task' ? 'Úkol' : 'Aktivita'}</span><ExternalLink aria-hidden size={10} /></Link>)}</div> : null}
      <div className="mt-auto flex items-center justify-end gap-1 border-t border-black/8 pt-2">
        {!note.archived_at && !note.deleted_at ? armedAction === 'archive' ? <><span className="mr-auto" /><button type="button" data-sticky-confirm={`${note.id}-archive`} onClick={() => onAction('archive', note)} className="activities-sticky__text-action activities-sticky__text-action--confirm">ARCHIVOVAT</button></> : armedAction === 'trash' ? <><span className="mr-auto" /><button type="button" data-sticky-confirm={`${note.id}-trash`} onClick={() => onAction('trash', note)} className="activities-sticky__text-action activities-sticky__text-action--danger activities-sticky__text-action--armed">DO KOŠE</button></> : <><button type="button" onClick={() => onConvert(note, 'task')} title="Převést na úkol" aria-label="Převést Lísteček na úkol" className="activities-sticky__icon-action"><ListTodo aria-hidden size={13} /></button><button type="button" onClick={() => onConvert(note, 'activity')} title="Převést na aktivitu" aria-label="Převést Lísteček na aktivitu" className="activities-sticky__icon-action"><MessageSquareText aria-hidden size={13} /></button><span className="mr-auto" /><button type="button" onClick={() => onAction('pin', note)} aria-label={note.is_pinned ? 'Odepnout Lísteček' : 'Připnout Lísteček'} className="activities-sticky__icon-action">{note.is_pinned ? <PinOff aria-hidden size={13} /> : <Pin aria-hidden size={13} />}</button><button type="button" onClick={() => onEdit(note)} aria-label="Upravit Lísteček" className="activities-sticky__icon-action"><Pencil aria-hidden size={13} /></button><button type="button" onClick={() => onAction('archive', note)} aria-label="Archivovat Lísteček" className="activities-sticky__icon-action"><Archive aria-hidden size={13} /></button><button type="button" onClick={() => onAction('trash', note)} aria-label="Přesunout Lísteček do koše" className="activities-sticky__icon-action activities-sticky__icon-action--danger"><Trash2 aria-hidden size={13} /></button></> : null}
        {note.archived_at && !note.deleted_at ? armedAction === 'trash' ? <><span className="mr-auto" /><button type="button" data-sticky-confirm={`${note.id}-trash`} onClick={() => onAction('trash', note)} className="activities-sticky__text-action activities-sticky__text-action--danger activities-sticky__text-action--armed">DO KOŠE</button></> : <><button type="button" onClick={() => onAction('restore-archive', note)} className="activities-sticky__text-action"><RotateCcw aria-hidden size={13} /> OBNOVIT</button><button type="button" onClick={() => onAction('trash', note)} className="activities-sticky__icon-action activities-sticky__icon-action--danger" aria-label="Přesunout do koše"><Trash2 aria-hidden size={13} /></button></> : null}
        {note.deleted_at ? <><button type="button" onClick={() => onAction('restore-trash', note)} className="activities-sticky__text-action"><RotateCcw aria-hidden size={13} /> OBNOVIT</button><button type="button" data-sticky-confirm={armedAction === 'delete' ? `${note.id}-delete` : undefined} onClick={() => onAction('delete', note)} className={`activities-sticky__text-action activities-sticky__text-action--danger ${armedAction === 'delete' ? 'activities-sticky__text-action--armed' : ''}`}>{armedAction === 'delete' ? 'SMAZAT' : <><Trash2 aria-hidden size={13} /> NAVŽDY</>}</button></> : null}
      </div>
    </article>
    {previewAnchor ? <StickyNotePreviewPopover note={note} anchor={previewAnchor} triggerRef={articleRef} onClose={() => setPreviewAnchor(null)} onEdit={onEdit} onAction={onAction} onConvert={onConvert} armedAction={armedAction} /> : null}
    </>
  )
}

const STICKY_DECK_BATCH_SIZE = 25

function StickyNotesDeck({
  items,
  total,
  loadingMore,
  onLoadMore,
  onEdit,
  onAction,
  onConvert,
  focusNoteId,
  armedNoteAction,
}: {
  items: StickyNoteListItem[]
  total: number
  loadingMore: boolean
  onLoadMore: () => void
  onEdit: (note: StickyNoteListItem) => void
  onAction: Parameters<typeof NoteCard>[0]['onAction']
  onConvert: Parameters<typeof NoteCard>[0]['onConvert']
  focusNoteId: string
  armedNoteAction: ArmedNoteAction
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const [desktopLayout, setDesktopLayout] = useState({ active: true, gap: 0, overlap: 176 })
  const [mobileDeck, setMobileDeck] = useState(false)
  const [activeIndex, setActiveIndex] = useState(() => {
    const focusedIndex = items.findIndex((note) => note.id === focusNoteId)
    return focusedIndex >= 0 ? focusedIndex : 0
  })
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, items.length - 1))

  const selectIndex = useCallback((index: number, scroll = false) => {
    if (items.length === 0) return
    const nextIndex = Math.max(0, Math.min(index, items.length - 1))
    setActiveIndex(nextIndex)

    if (scroll && !window.matchMedia('(min-width: 768px)').matches) {
      const viewport = viewportRef.current
      const target = viewport?.querySelector<HTMLElement>(`[data-deck-index="${nextIndex}"]`)
      if (viewport && target) {
        const targetLeft = target.offsetLeft - (viewport.clientWidth - target.offsetWidth) / 2
        viewport.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' })
      }
    }

    if (nextIndex >= items.length - 5 && items.length < total && !loadingMore) onLoadMore()
  }, [items.length, loadingMore, onLoadMore, total])

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    function updateDesktopSpacing() {
      const isDesktop = window.matchMedia('(min-width: 768px)').matches
      setMobileDeck(!isDesktop)

      if (!isDesktop || items.length <= 1) {
        setDesktopLayout({ active: false, gap: 12, overlap: 0 })
        return
      }

      const cardWidth = 276
      const usableWidth = Math.max(0, viewport?.clientWidth ?? 0)
      const cardCount = items.length
      const naturalCardsWidth = cardCount * cardWidth
      const spaceBetweenCards = Math.max(1, cardCount - 1)
      const comfortableGap = 20
      const availableGap = (usableWidth - naturalCardsWidth) / spaceBetweenCards
      const gap = Math.max(0, Math.min(comfortableGap, availableGap))
      const overlap = gap > 0
        ? 0
        : Math.min(cardWidth - 18, Math.max(0, (naturalCardsWidth - usableWidth) / spaceBetweenCards))

      setDesktopLayout({ active: true, gap, overlap })
    }

    const frame = window.requestAnimationFrame(updateDesktopSpacing)
    const observer = new ResizeObserver(updateDesktopSpacing)
    observer.observe(viewport)
    return () => {
      window.cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [items.length])

  function updateActiveFromScroll() {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      const viewport = viewportRef.current
      if (!viewport || window.matchMedia('(min-width: 768px)').matches) return
      const center = viewport.scrollLeft + viewport.clientWidth / 2
      let closestIndex = 0
      let closestDistance = Number.POSITIVE_INFINITY
      viewport.querySelectorAll<HTMLElement>('[data-deck-index]').forEach((element) => {
        const elementCenter = element.offsetLeft + element.offsetWidth / 2
        const distance = Math.abs(center - elementCenter)
        if (distance < closestDistance) {
          closestDistance = distance
          closestIndex = Number(element.dataset.deckIndex ?? 0)
        }
      })
      selectIndex(closestIndex)
    })
  }

  if (items.length === 0) {
    return <div className="activities-workspace__empty-state mt-4 flex min-h-28 items-center justify-center rounded-2xl border px-4 text-center text-sm text-[var(--text-secondary)]">Zatím nemáte žádný Lísteček.</div>
  }

  return (
    <div className="activities-sticky-deck mt-3" aria-label={`Balíček Lístečků, zobrazeno ${items.length} z ${total}`}>
      <style>{'@media (max-width: 767px) { .activities-sticky-deck__viewport::-webkit-scrollbar { display: none; width: 0; height: 0; } }'}</style>
      <div className="mb-1.5 flex items-center justify-between gap-3 px-1">
        <p className="activities-sticky-deck__hint truncate text-[10px] font-medium text-[var(--text-secondary)]">
          <span className="hidden md:inline">Najeďte na lísteček nebo použijte šipky.</span>
          <span className="md:hidden">Lístečky posouvejte tahem.</span>
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="min-w-12 text-center text-[10px] font-bold tabular-nums text-[var(--text-secondary)]">{Math.min(safeActiveIndex + 1, items.length)} / {total}</span>
          <span className="hidden items-center gap-1.5 md:flex">
            <button type="button" onClick={() => selectIndex(safeActiveIndex - 1, true)} disabled={safeActiveIndex === 0} aria-label="Předchozí Lísteček" className="activities-sticky-deck__arrow"><ChevronLeft aria-hidden size={14} /></button>
            <button type="button" onClick={() => selectIndex(safeActiveIndex + 1, true)} disabled={safeActiveIndex >= items.length - 1 && items.length >= total} aria-label="Další Lísteček" className="activities-sticky-deck__arrow">{loadingMore ? <LoaderCircle aria-hidden size={13} className="animate-spin" /> : <ChevronRight aria-hidden size={14} />}</button>
          </span>
        </div>
      </div>
      <div
        ref={viewportRef}
        onScroll={updateActiveFromScroll}
        className="activities-sticky-deck__viewport"
        style={desktopLayout.active
          ? { overflow: 'visible' }
          : mobileDeck
            ? {
                marginInline: 'calc(-1 * (1.25rem + 1rem))',
                marginBottom: '-1.95rem',
                padding: '0.45rem 0 3.5rem',
                scrollbarWidth: 'none',
              }
            : undefined}
      >
        <div
          className="activities-sticky-deck__track"
          style={desktopLayout.active
            ? { width: '100%', minWidth: '100%', justifyContent: 'center', gap: desktopLayout.gap, paddingInline: 0 }
            : mobileDeck
              ? { paddingInline: 'calc((100vw - min(82vw, 18rem)) / 2)' }
              : undefined}
        >
          {items.map((note, index) => (
            <div
              key={note.id}
              data-deck-index={index}
              data-active={safeActiveIndex === index ? 'true' : 'false'}
              className="activities-sticky-deck__item"
              style={desktopLayout.active ? {
                marginLeft: index === 0 ? 0 : -desktopLayout.overlap,
                marginRight: 0,
              } : undefined}
              onMouseEnter={() => selectIndex(index)}
              onFocusCapture={() => selectIndex(index)}
            >
              <NoteCard note={note} mobileDeck={mobileDeck} focused={focusNoteId === note.id} onEdit={onEdit} onAction={onAction} onConvert={onConvert} armedAction={armedNoteAction?.noteId === note.id ? armedNoteAction.action : null} />
            </div>
          ))}
          {loadingMore ? <div className="activities-sticky-deck__loader" aria-label="Načítám další Lístečky"><LoaderCircle aria-hidden size={18} className="animate-spin" /></div> : null}
        </div>
      </div>
    </div>
  )
}

function NotesManagerModal({
  view,
  items,
  total,
  counts,
  pending,
  loadingMore,
  onView,
  onLoadMore,
  onClose,
  onEdit,
  onAction,
  onConvert,
  armedNoteAction,
}: {
  view: StickyNoteView
  items: StickyNoteListItem[]
  total: number
  counts: StickyNoteCounts
  pending: boolean
  loadingMore: boolean
  onView: (view: StickyNoteView) => void
  onLoadMore: () => void
  onClose: () => void
  onEdit: (note: StickyNoteListItem) => void
  onAction: Parameters<typeof NoteCard>[0]['onAction']
  onConvert: Parameters<typeof NoteCard>[0]['onConvert']
  armedNoteAction: ArmedNoteAction
}) {
  useBodyScrollLock(true)
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [onClose])

  const tabs: Array<{ value: StickyNoteView; label: string; count: number }> = [
    { value: 'active', label: 'Aktivní', count: counts.active },
    { value: 'archive', label: 'Archiv', count: counts.archive },
    { value: 'trash', label: 'Koš', count: counts.trash },
  ]

  function handleItemsScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget
    if (
      !pending
      && !loadingMore
      && items.length < total
      && element.scrollHeight - element.scrollTop - element.clientHeight < 240
    ) {
      onLoadMore()
    }
  }

  return (
    <div className="activities-sticky-manager fixed inset-0 z-[135] overflow-hidden overscroll-none bg-zinc-950/42 p-3 backdrop-blur-[5px] sm:p-4" role="dialog" aria-modal="true" aria-labelledby="sticky-manager-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="flex h-full min-h-0 items-center justify-center"><section className="activities-sticky-manager__shell flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-zinc-200/85 bg-[linear-gradient(168deg,rgba(255,255,255,0.98)_0%,rgba(249,250,251,0.96)_48%,rgba(244,244,245,0.94)_100%)] shadow-[0_34px_88px_rgba(24,24,27,0.38)]">
        <header className="activities-sticky-manager__header flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200/75 px-5 py-4 sm:px-6"><div><ModalHeading id="sticky-manager-title" section="SOUKROMÁ PRACOVNÍ PLOCHA" title="Lístečky" /><p className="mt-1.5 text-xs text-zinc-500">Zobrazeno {items.length} z {total}</p></div><button type="button" onClick={onClose} aria-label="Zavřít" className="activities-sticky__secondary inline-flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-200 bg-white/90 text-zinc-600"><X aria-hidden size={18} /></button></header>
        <nav className="flex shrink-0 gap-2 overflow-x-auto border-b border-zinc-200/75 px-5 py-3 sm:px-6" aria-label="Zobrazení Lístečků">{tabs.map((tab) => <button key={tab.value} type="button" onClick={() => onView(tab.value)} aria-pressed={view === tab.value} className={`activities-sticky__tab inline-flex h-9 items-center gap-2 rounded-xl border px-4 text-xs font-semibold ${view === tab.value ? 'activities-sticky__tab--active' : ''}`}>{tab.label}<span>{tab.count}</span></button>)}</nav>
        <div onScroll={handleItemsScroll} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          {pending ? <div className="flex items-center justify-center gap-2 py-16 text-sm text-zinc-500"><LoaderCircle aria-hidden size={17} className="animate-spin" /> Načítám Lístečky…</div> : items.length ? (
            <div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{items.map((note) => <NoteCard key={note.id} note={note} compact onEdit={onEdit} onAction={onAction} onConvert={onConvert} armedAction={armedNoteAction?.noteId === note.id ? armedNoteAction.action : null} />)}</div>
              {items.length < total ? (
                <div className="flex justify-center pt-5">
                  <button type="button" onClick={onLoadMore} disabled={loadingMore} className="activities-sticky__secondary inline-flex h-9 items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 text-[10px] font-semibold uppercase text-zinc-600 transition hover:-translate-y-px disabled:cursor-wait disabled:opacity-60">
                    {loadingMore ? <LoaderCircle aria-hidden size={14} className="animate-spin" /> : null}
                    {loadingMore ? 'NAČÍTÁM DALŠÍ…' : 'NAČÍST DALŠÍ'}
                  </button>
                </div>
              ) : <p className="pt-5 text-center text-[10px] font-medium text-zinc-400">Zobrazeny všechny Lístečky.</p>}
            </div>
          ) : <p className="py-16 text-center text-sm text-zinc-500">Tato část je prázdná.</p>}
        </div>
        <footer className="activities-sticky-manager__footer flex shrink-0 items-center justify-between gap-3 border-t border-zinc-200/75 px-5 py-3 text-[11px] text-zinc-500 sm:px-6"><span>{view === 'trash' ? 'Koš se automaticky čistí po 30 dnech.' : 'Lístečky jsou viditelné pouze vám.'}</span><button type="button" onClick={onClose} className="activities-sticky__secondary inline-flex h-9 items-center justify-center rounded-xl border border-zinc-200 bg-white px-4 text-xs font-semibold text-zinc-600">ZAVŘÍT</button></footer>
      </section></div>
    </div>
  )
}

export function StickyNotesWorkspace({
  initialItems,
  initialTotal,
  counts,
  clients,
  taskUsers,
  taskContacts,
  focusNoteId = '',
}: {
  initialItems: StickyNoteListItem[]
  initialTotal: number
  counts: StickyNoteCounts
  clients: ActivityClientOption[]
  taskUsers: TaskUserOption[]
  taskContacts: TaskContactOption[]
  focusNoteId?: string
}) {
  const router = useRouter()
  const [mounted] = useState(() => typeof window !== 'undefined')
  const [formNote, setFormNote] = useState<StickyNoteListItem | null | undefined>(undefined)
  const [conversion, setConversion] = useState<ConversionSelection | null>(null)
  const [managerOpen, setManagerOpen] = useState(false)
  const [managerView, setManagerView] = useState<StickyNoteView>('active')
  const [managerItems, setManagerItems] = useState(initialItems)
  const [managerTotal, setManagerTotal] = useState(initialTotal)
  const [loadingMoreManager, setLoadingMoreManager] = useState(false)
  const loadingMoreManagerRef = useRef(false)
  const managerRequestGenerationRef = useRef(0)
  const [deckItems, setDeckItems] = useState(initialItems)
  const [loadingMoreDeck, setLoadingMoreDeck] = useState(false)
  const loadingMoreDeckRef = useRef(false)
  const [armedNoteAction, setArmedNoteAction] = useState<ArmedNoteAction>(null)
  const [pending, startTransition] = useTransition()
  const handledFocusNoteId = useRef('')
  const { toast, isVisible, showToast } = useAnimatedActionToast()

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setDeckItems(initialItems))
    return () => window.cancelAnimationFrame(frame)
  }, [initialItems])

  useEffect(() => {
    if (!focusNoteId || handledFocusNoteId.current === focusNoteId) return
    handledFocusNoteId.current = focusNoteId
    const visibleNote = initialItems.find((note) => note.id === focusNoteId)
    if (visibleNote) {
      const frame = window.requestAnimationFrame(() => setFormNote(visibleNote))
      return () => window.cancelAnimationFrame(frame)
    }

    startTransition(async () => {
      const response = await getStickyNotesViewAction({ view: 'active', limit: 100 })
      const focusedNote = response.items.find((note) => note.id === focusNoteId)
      if (response.success && focusedNote) setFormNote(focusedNote)
    })
  }, [focusNoteId, initialItems])

  useEffect(() => {
    if (!armedNoteAction) return
    const confirmationSelector = `[data-sticky-confirm="${armedNoteAction.noteId}-${armedNoteAction.action}"]`
    const timer = window.setTimeout(() => setArmedNoteAction(null), 3500)
    function cancelOnPointerDown(event: PointerEvent) {
      if ((event.target as HTMLElement).closest(confirmationSelector)) return
      setArmedNoteAction(null)
    }
    function cancelOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setArmedNoteAction(null)
    }
    document.addEventListener('pointerdown', cancelOnPointerDown, true)
    window.addEventListener('keydown', cancelOnEscape)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', cancelOnPointerDown, true)
      window.removeEventListener('keydown', cancelOnEscape)
    }
  }, [armedNoteAction])

  function loadView(view: StickyNoteView) {
    const requestGeneration = managerRequestGenerationRef.current + 1
    managerRequestGenerationRef.current = requestGeneration
    loadingMoreManagerRef.current = false
    setLoadingMoreManager(false)
    setManagerView(view)
    startTransition(async () => {
      const response = await getStickyNotesViewAction({ view, limit: STICKY_MANAGER_INITIAL_LIMIT })
      if (requestGeneration !== managerRequestGenerationRef.current) return
      if (!response.success) {
        showToast({ title: 'CHYBA', message: response.error ?? 'Lístečky se nepodařilo načíst.', tone: 'error' })
        return
      }
      setManagerItems(response.items)
      setManagerTotal(response.total)
    })
  }

  const loadMoreManager = useCallback(() => {
    if (loadingMoreManagerRef.current || managerItems.length >= managerTotal) return
    const requestGeneration = managerRequestGenerationRef.current
    const view = managerView
    const offset = managerItems.length
    loadingMoreManagerRef.current = true
    setLoadingMoreManager(true)

    void getStickyNotesViewAction({
      view,
      limit: STICKY_MANAGER_BATCH_SIZE,
      offset,
    }).then((response) => {
      if (requestGeneration !== managerRequestGenerationRef.current) return
      if (!response.success) {
        showToast({ title: 'CHYBA', message: response.error ?? 'Další Lístečky se nepodařilo načíst.', tone: 'error' })
        return
      }
      setManagerItems((current) => {
        const knownIds = new Set(current.map((note) => note.id))
        return [...current, ...response.items.filter((note) => !knownIds.has(note.id))]
      })
      setManagerTotal(response.total)
    }).finally(() => {
      if (requestGeneration === managerRequestGenerationRef.current) {
        loadingMoreManagerRef.current = false
        setLoadingMoreManager(false)
      }
    })
  }, [managerItems.length, managerTotal, managerView, showToast])

  function openManager() {
    setManagerOpen(true)
    loadView('active')
  }

  const loadMoreDeck = useCallback(() => {
    if (loadingMoreDeckRef.current || deckItems.length >= initialTotal) return
    loadingMoreDeckRef.current = true
    setLoadingMoreDeck(true)
    void getStickyNotesViewAction({
      view: 'active',
      limit: STICKY_DECK_BATCH_SIZE,
      offset: deckItems.length,
    }).then((response) => {
      if (!response.success) {
        showToast({ title: 'CHYBA', message: response.error ?? 'Další Lístečky se nepodařilo načíst.', tone: 'error' })
        return
      }
      setDeckItems((current) => {
        const knownIds = new Set(current.map((note) => note.id))
        return [...current, ...response.items.filter((note) => !knownIds.has(note.id))]
      })
    }).finally(() => {
      loadingMoreDeckRef.current = false
      setLoadingMoreDeck(false)
    })
  }, [deckItems.length, initialTotal, showToast])

  function finishMutation(title: string, message: string) {
    showToast({ title, message, tone: 'success' })
    router.refresh()
    if (managerOpen) loadView(managerView)
  }

  function runAction(action: NoteAction, note: StickyNoteListItem) {
    const requiresConfirmation = action === 'archive' || action === 'trash' || action === 'delete'
    if (requiresConfirmation && (armedNoteAction?.noteId !== note.id || armedNoteAction.action !== action)) {
      setArmedNoteAction({ noteId: note.id, action })
      return
    }
    setArmedNoteAction(null)
    startTransition(async () => {
      const response = action === 'pin'
        ? await setStickyNotePinnedAction(note.id, !note.is_pinned)
        : action === 'archive'
          ? await archiveStickyNoteAction(note.id)
          : action === 'trash'
            ? await moveStickyNoteToTrashAction(note.id)
            : action === 'restore-archive'
              ? await restoreStickyNoteFromArchiveAction(note.id)
              : action === 'restore-trash'
                ? await restoreStickyNoteFromTrashAction(note.id)
                : await permanentlyDeleteStickyNoteAction(note.id)

      if (!response.success) {
        showToast({ title: 'CHYBA', message: response.error ?? 'Lísteček se nepodařilo upravit.', tone: 'error' })
        return
      }
      finishMutation(action === 'delete' ? 'LÍSTEČEK SMAZÁN' : 'LÍSTEČEK UPRAVEN', action === 'delete' ? 'Lísteček byl definitivně odstraněn.' : 'Změna byla uložena.')
    })
  }

  function handleSaved() {
    setFormNote(undefined)
    finishMutation('LÍSTEČEK ULOŽEN', 'Lísteček je připravený na pracovní ploše.')
  }

  async function finishConversion(selection: ConversionSelection, target: { id?: string; title: string }) {
    if (!target.id) {
      showToast({ title: 'ZÁZNAM VYTVOŘEN', message: 'Záznam vznikl, ale nepodařilo se získat jeho odkaz.', tone: 'error' })
      router.refresh()
      return
    }

    const response = await recordStickyNoteConversionAction({
      noteId: selection.note.id,
      targetType: selection.type,
      targetId: target.id,
      targetTitle: target.title,
      targetPath: selection.type === 'task' ? `/tasks/${target.id}` : `/activities?focus=${target.id}`,
    })

    if (!response.success) {
      showToast({ title: 'ZÁZNAM VYTVOŘEN', message: response.error ?? 'Vazbu na Lísteček se nepodařilo uložit.', tone: 'error' })
      router.refresh()
      return
    }

    finishMutation(selection.type === 'task' ? 'ÚKOL VYTVOŘEN' : 'AKTIVITA VYTVOŘENA', 'Lísteček zůstal na ploše a nyní obsahuje odkaz na nový záznam.')
  }

  return (
    <section data-workspace-card="sticky" className="activities-page__panel relative min-h-[240px] overflow-visible rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] md:overflow-hidden">
      <header className="flex min-h-11 flex-row items-start justify-between gap-1 sm:gap-3"><div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3"><span className="activities-workspace__card-icon relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[14px] border border-[var(--surface-border)] bg-[var(--surface-muted)] text-[var(--accent)] sm:h-10 sm:w-10 sm:rounded-2xl"><StickyNote aria-hidden size={18} /><span className="absolute -right-1.5 -top-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-white/75 bg-[var(--accent-soft)] px-1.5 text-[9px] font-extrabold leading-none text-[var(--accent)] shadow-[0_3px_8px_rgba(15,23,42,0.12)] [html[data-theme=dark]_&]:border-slate-700/80 [html[data-theme=dark]_&]:shadow-[0_3px_9px_rgba(0,0,0,0.32)]">{initialTotal}</span></span><div className="min-w-0 flex-1"><p className="truncate whitespace-nowrap text-[9px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)] sm:text-[10px] sm:tracking-[0.14em]"><span className="sm:hidden">PRACOVNÍ PLOCHA</span><span className="hidden sm:inline">SOUKROMÁ PRACOVNÍ PLOCHA</span></p><div className="mt-0.5 flex items-center gap-2"><h2 className="truncate text-base font-semibold text-[var(--text-primary)] sm:text-lg">Lístečky</h2></div></div></div><div className="flex shrink-0 items-center justify-end gap-1.5 sm:gap-2"><button type="button" onClick={openManager} className="activities-workspace__small-action inline-flex h-8 items-center justify-center rounded-xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-2.5 text-[10px] font-bold uppercase text-[var(--text-secondary)] transition duration-200 hover:-translate-y-px hover:text-[var(--text-primary)] sm:px-3"><span className="sm:hidden">VŠECHNY</span><span className="hidden sm:inline">VŠECHNY LÍSTEČKY</span></button><button type="button" onClick={() => setFormNote(null)} className="activities-workspace__new-action">NOVÝ</button></div></header>
      <StickyNotesDeck items={deckItems} total={initialTotal} loadingMore={loadingMoreDeck} onLoadMore={loadMoreDeck} focusNoteId={focusNoteId} onEdit={(item) => setFormNote(item)} onAction={runAction} onConvert={(item, type) => setConversion({ note: item, type })} armedNoteAction={armedNoteAction} />
      <div className="mt-4 hidden gap-2 border-t border-[var(--surface-border)] pt-3 sm:flex sm:flex-wrap sm:justify-center" aria-label="Přehled Lístečků">
        <span className="activities-sticky__stat inline-flex min-h-7 min-w-0 items-center justify-center gap-1.5 rounded-[10px] border border-slate-300/35 bg-white/50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.04em] text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_4px_9px_rgba(15,23,42,0.05)] [html[data-theme='dark']_&]:border-slate-300/15 [html[data-theme='dark']_&]:bg-slate-500/10 [html[data-theme='dark']_&]:text-slate-300" data-tone="pinned"><Pin aria-hidden size={11} /><span className="whitespace-nowrap">Připnuté</span><strong className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md bg-white/70 text-[9px] font-extrabold shadow-[inset_0_0_0_1px_rgba(15,23,42,0.05)] [html[data-theme='dark']_&]:bg-white/7">{counts.pinned}</strong></span>
        <span className="activities-sticky__stat inline-flex min-h-7 min-w-0 items-center justify-center gap-1.5 rounded-[10px] border border-slate-300/35 bg-white/50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.04em] text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_4px_9px_rgba(15,23,42,0.05)] [html[data-theme='dark']_&]:border-slate-300/15 [html[data-theme='dark']_&]:bg-slate-500/10 [html[data-theme='dark']_&]:text-slate-300" data-tone="reminder"><Bell aria-hidden size={11} /><span className="whitespace-nowrap">S notifikací</span><strong className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md bg-white/70 text-[9px] font-extrabold shadow-[inset_0_0_0_1px_rgba(15,23,42,0.05)] [html[data-theme='dark']_&]:bg-white/7">{counts.reminders}</strong></span>
        <span className="activities-sticky__stat inline-flex min-h-7 min-w-0 items-center justify-center gap-1.5 rounded-[10px] border border-slate-300/35 bg-white/50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.04em] text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_4px_9px_rgba(15,23,42,0.05)] [html[data-theme='dark']_&]:border-slate-300/15 [html[data-theme='dark']_&]:bg-slate-500/10 [html[data-theme='dark']_&]:text-slate-300" data-tone="archive"><Archive aria-hidden size={11} /><span className="whitespace-nowrap">Archiv</span><strong className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md bg-white/70 text-[9px] font-extrabold shadow-[inset_0_0_0_1px_rgba(15,23,42,0.05)] [html[data-theme='dark']_&]:bg-white/7">{counts.archive}</strong></span>
        <span className="activities-sticky__stat inline-flex min-h-7 min-w-0 items-center justify-center gap-1.5 rounded-[10px] border border-slate-300/35 bg-white/50 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.04em] text-slate-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_4px_9px_rgba(15,23,42,0.05)] [html[data-theme='dark']_&]:border-slate-300/15 [html[data-theme='dark']_&]:bg-slate-500/10 [html[data-theme='dark']_&]:text-slate-300" data-tone="trash"><Trash2 aria-hidden size={11} /><span className="whitespace-nowrap">Koš</span><strong className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-md bg-white/70 text-[9px] font-extrabold shadow-[inset_0_0_0_1px_rgba(15,23,42,0.05)] [html[data-theme='dark']_&]:bg-white/7">{counts.trash}</strong></span>
      </div>

      {mounted && formNote !== undefined ? createPortal(<StickyNoteFormModal clients={clients} note={formNote} onClose={() => setFormNote(undefined)} onSaved={handleSaved} />, document.body) : null}
      {mounted && managerOpen ? createPortal(<NotesManagerModal view={managerView} items={managerItems} total={managerTotal} counts={counts} pending={pending} loadingMore={loadingMoreManager} onView={loadView} onLoadMore={loadMoreManager} onClose={() => setManagerOpen(false)} onEdit={(note) => setFormNote(note)} onAction={runAction} onConvert={(note, type) => setConversion({ note, type })} armedNoteAction={armedNoteAction} />, document.body) : null}
      {mounted && conversion?.type === 'task' ? createPortal(<CreateTaskModal users={taskUsers} clients={clients} contacts={taskContacts} initialValues={{ title: getConversionTitle(conversion.note), note: conversion.note.content, client_id: conversion.note.client_id, company_name: conversion.note.client_name }} onClose={() => setConversion(null)} onToast={(nextToast) => showToast({ title: 'CHYBA', message: nextToast.message, tone: 'error' })} suppressSuccessToast onSuccess={(state) => { const selection = conversion; setConversion(null); void finishConversion(selection, { id: state.taskId, title: state.taskTitle ?? getConversionTitle(selection.note) }) }} />, document.body) : null}
      {mounted && conversion?.type === 'activity' ? createPortal(<ActivityFormModal clients={clients} initialClientId={conversion.note.client_id ?? ''} initialValues={{ title: getConversionTitle(conversion.note), description: conversion.note.content, activityType: 'work_log' }} action={createManualActivityAction} onClose={() => setConversion(null)} onSaved={(state) => { const selection = conversion; setConversion(null); void finishConversion(selection, { id: state.activityId, title: getConversionTitle(selection.note) }) }} />, document.body) : null}
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}
    </section>
  )
}
