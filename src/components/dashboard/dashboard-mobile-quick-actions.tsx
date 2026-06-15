'use client'

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { CreateClientModal } from '@/app/clients/new-client-button'
import { CreateMeetingModal } from '@/app/meetings/new-meeting-button'
import { CreateJobModal } from '@/app/jobs/new-job-button'
import { NewOfferModal } from '@/app/offers/new-offer-button'
import { CreateTaskModal } from '@/app/tasks/new-task-button'
import { ReceivedInvoicesModal } from '@/components/dashboard/received-invoices-modal'
import {
  getMyDashboardQuickNoteAction,
  clearMyDashboardQuickNoteAction,
  upsertMyDashboardQuickNoteAction,
} from '@/app/dashboard/quick-notes-actions'
import {
  getManualNotificationHistoryForAdminAction,
  sendManualNotificationForAdminAction,
} from '@/app/dashboard/manual-notifications-actions'
import {
  getPresenceOverviewForAdminAction,
  getUserActivityForAdminAction,
  trackUserPresenceAction,
} from '@/app/dashboard/online-presence-actions'
import { getTodayJobsForDashboardAction } from '@/app/dashboard/today-jobs-actions'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
import {
  readDashboardQuickCreateEnabled,
  readDashboardQuickNotesEnabled,
  readDashboardTodayJobsEnabled,
} from '@/lib/dashboard/widget-preferences'
import {
  ActionFeedbackToast,
  type ActionFeedbackToastValue,
  useAnimatedActionToast,
} from '@/components/ui/action-feedback-toast'
import {
  buildClientCreatedToast,
  buildErrorToast,
  buildJobCreatedToast,
  buildMeetingCreatedToast,
  buildTaskCreatedToast,
} from '@/components/ui/action-feedback-messages'
import type { CreateClientActionState } from '@/app/clients/actions'
import type { CreateMeetingActionState } from '@/app/meetings/actions'
import type { CreateJobActionState } from '@/app/jobs/actions'
import type { CreateTaskActionState } from '@/app/tasks/actions'

type UserOption = {
  id: string
  name: string | null
  role: string | null
  can_be_assigned_as_technician?: boolean | null
}

type ClientOption = {
  id: string
  name: string
}

type ClientContactOption = {
  id: string
  client_id: string
  name: string
  phone: string | null
  email: string | null
  is_primary: boolean
}

type OfferOption = {
  id: string
  client_id: string
  offer_number: string
  title: string
}

type QuickActionKey =
  | 'meeting'
  | 'task'
  | 'offer'
  | 'job'
  | 'client'
  | 'quick_notes'
  | 'today_jobs'
  | 'manual_notifications'
  | 'received_invoices'

type DashboardMobileQuickActionsProps = {
  users: UserOption[]
  clients: ClientOption[]
  contacts: ClientContactOption[]
  offers: OfferOption[]
  canViewJobs: boolean
  canViewOffers: boolean
  canCreateJobs: boolean
  isAdmin: boolean
  receivedInvoicesDueCount?: number
}

type PresenceUser = {
  id: string
  name: string
  lastSeenAt: string
  lastRoute: string | null
  lastSection: string | null
  lastAction: string | null
  lastActionAt: string | null
  isOnline: boolean
}

type ActivityItem = {
  id: string
  user_id: string
  route: string | null
  section: string | null
  action: string | null
  created_at: string
}

type PresencePeriod = 'today' | '7d' | '30d'

type ManualNotificationHistoryItem = {
  batchId: string
  createdAt: string
  title: string
  message: string | null
  recipientUserIds: string[]
  recipientNames: string[]
  recipientCount: number
}

type TodayJobItem = {
  id: string
  jobNumber: string
  companyName: string
  siteAddress: string | null
  startAt: string
  endAt: string
  technicianName: string | null
  generatorName: string | null
}

const QUICK_NOTE_MAX_LENGTH = 1000
const DASHBOARD_MODAL_BACKDROP_BLUR_DESKTOP = 'blur(5px)'
const DASHBOARD_MODAL_BACKDROP_BLUR_MOBILE = 'blur(6px)'

function QuickNotesModal({
  isDesktopViewport,
  viewportBottomOffset,
  isOpen,
  text,
  isSaving,
  lastSavedAtLabel,
  onChangeText,
  onRequestClose,
  onClearRequest,
}: {
  isDesktopViewport: boolean
  viewportBottomOffset: number
  isOpen: boolean
  text: string
  isSaving: boolean
  lastSavedAtLabel: string | null
  onChangeText: (value: string) => void
  onRequestClose: () => void
  onClearRequest: () => void
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onRequestClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onRequestClose])

  return (
    <div className="fixed inset-0 z-[75]">
      <button
        type="button"
        aria-label="Zavřít poznámky"
        onClick={onRequestClose}
        className={`absolute inset-0 transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isOpen ? 'opacity-100' : 'opacity-0'
        }`}
        style={{
          backgroundColor: isDesktopViewport
            ? 'rgba(15, 23, 42, 0.08)'
            : 'rgba(24, 24, 27, 0.30)',
          backdropFilter: isOpen
            ? isDesktopViewport
              ? DASHBOARD_MODAL_BACKDROP_BLUR_DESKTOP
              : DASHBOARD_MODAL_BACKDROP_BLUR_MOBILE
            : 'blur(0px)',
        }}
      />

      <div
        className={`dashboard-quick-notes-modal absolute overflow-hidden rounded-[28px] border border-[#8dbfe0]/80 bg-[linear-gradient(165deg,rgba(61,129,184,0.94)_0%,rgba(44,113,170,0.9)_48%,rgba(32,91,145,0.88)_100%)] p-3 shadow-[inset_0_1px_0_rgba(198,228,250,0.5)] transition duration-[280ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isOpen
            ? 'translate-x-0 translate-y-0 scale-100 opacity-100 shadow-[0_46px_112px_rgba(9,48,82,0.42)]'
            : 'translate-x-4 translate-y-5 scale-[0.72] opacity-0 shadow-[0_12px_28px_rgba(9,48,82,0.14)]'
        }`}
        style={{
          right: isDesktopViewport ? '28px' : '16px',
          bottom: isDesktopViewport
            ? '104px'
            : `calc(env(safe-area-inset-bottom, 0px) + 86px + ${viewportBottomOffset}px)`,
          width: isDesktopViewport ? '340px' : 'min(290px, calc(100vw - 2rem))',
          transformOrigin: 'bottom right',
          transitionDelay: isOpen ? '34ms' : '0ms',
        }}
        >
        <div
          aria-hidden="true"
          className="dashboard-quick-notes-modal__top-line pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white/80 to-transparent opacity-90"
        />

        <div
          className={`px-2 pb-2 pt-1 transition duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isOpen ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
          }`}
          style={{ transitionDelay: isOpen ? '86ms' : '0ms' }}
        >
          <div className="dashboard-quick-notes-modal__eyebrow text-[12px] font-semibold uppercase tracking-[0.2em] text-white/95">
            Poznámky
          </div>
        </div>

        <div
          className={`space-y-2.5 transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isOpen ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-[0.96] opacity-0'
          }`}
          style={{ transitionDelay: isOpen ? '110ms' : '0ms' }}
        >
          <textarea
            value={text}
            onChange={(event) => onChangeText(event.target.value.slice(0, QUICK_NOTE_MAX_LENGTH))}
            maxLength={QUICK_NOTE_MAX_LENGTH}
            rows={12}
            placeholder="Rychlá poznámka..."
            className="dashboard-quick-notes-modal__textarea w-full resize-none rounded-2xl border border-white/55 bg-white/12 px-3 py-2.5 text-sm leading-5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_10px_22px_rgba(9,48,82,0.16)] outline-none placeholder:text-white/65 focus:border-white/75 focus:ring-2 focus:ring-white/35"
          />

          <div className="flex items-start justify-between gap-3 pt-0.5">
            <div>
              <div className="dashboard-quick-notes-modal__counter text-[10px] text-white/75">
                {text.length}/{QUICK_NOTE_MAX_LENGTH}
              </div>
              <div className="dashboard-quick-notes-modal__saved mt-1 text-[10px] leading-4 text-white/65">
                {isSaving
                  ? 'Ukládám...'
                  : lastSavedAtLabel
                    ? `Naposledy uloženo ${lastSavedAtLabel}`
                    : 'Zatím neuloženo'}
              </div>
            </div>

            <button
              type="button"
              onClick={onClearRequest}
              className="dashboard-quick-notes-modal__clear inline-flex h-8 items-center justify-center rounded-xl border border-red-300/80 bg-[linear-gradient(155deg,rgba(239,68,68,0.92)_0%,rgba(220,38,38,0.9)_100%)] px-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_20px_rgba(127,29,29,0.24)] transition duration-200 hover:-translate-y-[1px]"
            >
              Vymazat
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function formatActivityTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(date)
}

function humanizeOfferStatus(value: string) {
  const normalized = value.trim().toLowerCase()
  const map: Record<string, string> = {
    draft: 'Rozpracováno',
    submitted: 'Ke schválení',
    changes_requested: 'Vráceno k úpravě',
    approved: 'Schváleno',
    sent_to_client: 'Odesláno klientovi',
    in_progress: 'V řešení',
    realizace: 'Realizace',
    ordered: 'Objednáno',
    rejected: 'Zamítnuto',
  }
  return map[normalized] ?? value
}

function formatOnlineActionText(action: string | null) {
  if (!action) return '—'

  let next = action

  const replacements: Array<[RegExp, string]> = [
    [/\btechnician_name\b/g, 'Technik'],
    [/\bgenerator_name\b/g, 'Agregát'],
    [/\bsite_address\b/g, 'Adresa'],
    [/\bstore_number\b/g, 'Prodejna'],
    [/\bcompany_name\b/g, 'Firma'],
    [/\bcontact_person\b/g, 'Kontaktní osoba'],
    [/\bstart_at\b/g, 'Začátek'],
    [/\bend_at\b/g, 'Konec'],
  ]

  for (const [pattern, label] of replacements) {
    next = next.replace(pattern, label)
  }

  next = next.replace(
    /( na )([a-z_]+)\b/gi,
    (_match, prefix: string, code: string) => `${prefix}${humanizeOfferStatus(code)}`
  )

  return next
}

function formatOnlineRoute(route: string | null) {
  if (!route) return '—'
  if (route.startsWith('/offers/')) return '/offers/detail'
  if (route.startsWith('/tasks/')) return '/tasks/detail'
  if (route.startsWith('/jobs/')) return '/jobs/detail'
  if (route.startsWith('/meetings/')) return '/meetings/detail'
  if (route.startsWith('/clients/')) return '/clients/detail'
  return route
}

function formatManualHistoryTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function triggerHaptic(pattern: number | number[]) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return
  }

  navigator.vibrate(pattern)
}

function ManualNotificationModal({
  users,
  historyItems,
  historyLoading,
  onClose,
  onSent,
  onResent,
}: {
  users: UserOption[]
  historyItems: ManualNotificationHistoryItem[]
  historyLoading: boolean
  onClose: () => void
  onSent: (sentCount: number) => Promise<void> | void
  onResent: (sentCount: number) => Promise<void> | void
}) {
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([])
  const [includeTechnicians, setIncludeTechnicians] = useState(false)
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submittingBatchId, setSubmittingBatchId] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const sortedUsers = [...users].sort((a, b) =>
    (a.name ?? 'Uživatel').localeCompare(b.name ?? 'Uživatel', 'cs', { sensitivity: 'base' })
  )

  function toggleUser(userId: string) {
    setSelectedUserIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    )
  }

  async function sendCurrentNotification() {
    setErrorMessage(null)
    setIsSubmitting(true)
    const result = await sendManualNotificationForAdminAction({
      recipientUserIds: selectedUserIds,
      includeTechnicians,
      title,
      message,
    })
    setIsSubmitting(false)

    if (!result.success) {
      setErrorMessage(result.error ?? 'Notifikaci se nepodařilo odeslat.')
      return
    }

    await onSent(result.sentCount ?? 0)
    onClose()
  }

  async function resendFromHistory(item: ManualNotificationHistoryItem) {
    setErrorMessage(null)
    setSubmittingBatchId(item.batchId)
    const result = await sendManualNotificationForAdminAction({
      recipientUserIds: item.recipientUserIds,
      title: item.title,
      message: item.message ?? '',
    })
    setSubmittingBatchId(null)

    if (!result.success) {
      setErrorMessage(result.error ?? 'Notifikaci se nepodařilo odeslat znovu.')
      return
    }

    await onResent(result.sentCount ?? 0)
  }

  return (
    <div className="manual-notifications-modal fixed inset-0 z-[110] hidden lg:block">
      <button
        type="button"
        aria-label="Zavřít ruční notifikace"
        className="manual-notifications-modal__overlay absolute inset-0 bg-zinc-950/38 backdrop-blur-[3.5px]"
        onClick={onClose}
      />

      <div className="absolute inset-0 overflow-y-auto p-4">
        <div className="manual-notifications-modal__shell mx-auto mt-12 w-full max-w-6xl rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_30px_72px_rgba(24,24,27,0.28)] lg:p-6">
          <div className="manual-notifications-modal__header mb-4 flex items-start justify-between gap-4 border-b border-white/70 pb-4">
            <div>
              <h2 className="manual-notifications-modal__title text-xl font-semibold tracking-tight text-gray-900">
                Ruční notifikace
              </h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="manual-notifications-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="manual-notifications-modal__composer rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
              <div className="space-y-3">
                <div>
                  <label className="manual-notifications-modal__label mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
                    Příjemci
                  </label>
                  <label className="manual-notifications-modal__recipient-item mb-2 flex cursor-pointer items-center gap-2 rounded-xl border border-white/75 bg-white/55 px-3 py-2 text-sm text-zinc-800 transition hover:bg-white/75">
                    <input
                      type="checkbox"
                      className="manual-notifications-modal__checkbox h-4 w-4 rounded border-zinc-300 text-[#2f77af] focus:ring-[#2f77af]"
                      checked={includeTechnicians}
                      onChange={() => setIncludeTechnicians((current) => !current)}
                    />
                    <span className="truncate font-semibold">Technici</span>
                  </label>
                  <div className="manual-notifications-modal__recipient-list max-h-[230px] space-y-1.5 overflow-y-auto rounded-xl border border-white/75 bg-white/70 p-2">
                    {sortedUsers.map((user) => {
                      const isChecked = selectedUserIds.includes(user.id)
                      return (
                        <label
                          key={user.id}
                          className="manual-notifications-modal__recipient-item flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-800 transition hover:bg-white/80"
                        >
                          <input
                            type="checkbox"
                            className="manual-notifications-modal__checkbox h-4 w-4 rounded border-zinc-300 text-[#2f77af] focus:ring-[#2f77af]"
                            checked={isChecked}
                            onChange={() => toggleUser(user.id)}
                          />
                          <span className="truncate">{user.name?.trim() || 'Uživatel'}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="manual-notification-title"
                    className="manual-notifications-modal__label mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500"
                  >
                    Nadpis (max 120)
                  </label>
                  <input
                    id="manual-notification-title"
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value.slice(0, 120))}
                    maxLength={120}
                    className="manual-notifications-modal__input h-11 w-full rounded-xl border border-white/75 bg-white/80 px-3 text-sm text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] outline-none ring-[#2f77af]/40 transition focus:ring-2"
                    placeholder="Např. Důležité oznámení"
                  />
                </div>

                <div>
                  <label
                    htmlFor="manual-notification-message"
                    className="manual-notifications-modal__label mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500"
                  >
                    Text (volitelné, max 500)
                  </label>
                  <textarea
                    id="manual-notification-message"
                    value={message}
                    onChange={(event) => setMessage(event.target.value.slice(0, 500))}
                    maxLength={500}
                    rows={4}
                    className="manual-notifications-modal__textarea w-full resize-none rounded-xl border border-white/75 bg-white/80 px-3 py-2 text-sm text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] outline-none ring-[#2f77af]/40 transition focus:ring-2"
                    placeholder="Volitelný text notifikace…"
                  />
                </div>

                {errorMessage ? (
                  <div className="manual-notifications-modal__error rounded-xl border border-red-200/85 bg-red-50/80 px-3 py-2 text-sm text-red-700">
                    {errorMessage}
                  </div>
                ) : null}

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => {
                      void sendCurrentNotification()
                    }}
                    disabled={isSubmitting}
                    className="manual-notifications-modal__send inline-flex min-h-11 items-center rounded-xl border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] px-4 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_24px_rgba(9,48,82,0.38)] transition hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? 'ODESÍLÁM…' : 'ODESLAT NOTIFIKACI'}
                  </button>
                </div>
              </div>
            </section>

            <section className="manual-notifications-modal__history rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
              <div className="manual-notifications-modal__history-title mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Historie odeslaných
              </div>

              <div className="max-h-[62vh] space-y-2 overflow-y-auto pr-1">
                {historyLoading ? (
                  <div className="manual-notifications-modal__history-empty rounded-xl border border-white/75 bg-white/60 px-3 py-4 text-sm text-zinc-500">
                    Načítám historii…
                  </div>
                ) : historyItems.length === 0 ? (
                  <div className="manual-notifications-modal__history-empty rounded-xl border border-white/75 bg-white/60 px-3 py-4 text-sm text-zinc-500">
                    Zatím bez odeslaných ručních notifikací.
                  </div>
                ) : (
                  historyItems.map((item) => (
                    <div
                      key={item.batchId}
                      className="manual-notifications-modal__history-item rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="manual-notifications-modal__history-item-title truncate text-sm font-semibold text-zinc-900">
                            {item.title}
                          </div>
                          <div className="manual-notifications-modal__history-item-meta mt-1 text-[12px] text-zinc-600">
                            {formatManualHistoryTime(item.createdAt)} • Příjemců: {item.recipientCount}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void resendFromHistory(item)
                          }}
                          disabled={submittingBatchId === item.batchId}
                          className="manual-notifications-modal__resend inline-flex min-h-9 shrink-0 items-center rounded-xl border border-[#2b6f9f]/85 bg-[#2f77af]/10 px-3 text-xs font-semibold uppercase tracking-[0.04em] text-[#1f5f8f] transition hover:bg-[#2f77af]/18 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {submittingBatchId === item.batchId ? 'ODESÍLÁM…' : 'ODESLAT ZNOVU'}
                        </button>
                      </div>

                      {item.message ? (
                        <div className="manual-notifications-modal__history-item-message mt-1.5 text-sm text-zinc-700">
                          {item.message}
                        </div>
                      ) : null}

                      <div className="manual-notifications-modal__history-item-recipients mt-2 text-[12px] text-zinc-600">
                        Komu: {item.recipientNames.join(', ')}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

export function DashboardMobileQuickActions({
  users,
  clients,
  contacts,
  offers,
  canViewJobs,
  canViewOffers,
  canCreateJobs,
  isAdmin,
  receivedInvoicesDueCount = 0,
}: DashboardMobileQuickActionsProps) {
  type SpinnableIconKey =
    | 'invoices'
    | 'manual_notifications'
    | 'today_jobs'
    | 'quick_notes'
    | 'quick_create'

  const isHydrated = useSyncExternalStore(
    (callback) => {
      if (typeof window === 'undefined') return () => {}
      const frameId = window.requestAnimationFrame(() => callback())
      return () => window.cancelAnimationFrame(frameId)
    },
    () => true,
    () => false
  )

  const router = useRouter()
  const [activeAction, setActiveAction] = useState<QuickActionKey | null>(null)
  const [isSheetMounted, setIsSheetMounted] = useState(false)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [isTodayJobsMounted, setIsTodayJobsMounted] = useState(false)
  const [isTodayJobsOpen, setIsTodayJobsOpen] = useState(false)
  const [isQuickNotesMounted, setIsQuickNotesMounted] = useState(false)
  const [isQuickNotesOpen, setIsQuickNotesOpen] = useState(false)
  const [isDesktopViewport, setIsDesktopViewport] = useState(false)
  const [viewportBottomOffset, setViewportBottomOffset] = useState(0)
  const [isQuickCreateVisible, setIsQuickCreateVisible] = useState(true)
  const [isQuickNotesVisible, setIsQuickNotesVisible] = useState(true)
  const [isTodayJobsVisible, setIsTodayJobsVisible] = useState(true)
  const [todayJobs, setTodayJobs] = useState<TodayJobItem[]>([])
  const [todayJobsLoading, setTodayJobsLoading] = useState(false)
  const [todayJobsError, setTodayJobsError] = useState<string | null>(null)
  const [todayJobsLoaded, setTodayJobsLoaded] = useState(false)
  const [quickNotesText, setQuickNotesText] = useState('')
  const [isQuickNotesSaving, setIsQuickNotesSaving] = useState(false)
  const [quickNotesLoaded, setQuickNotesLoaded] = useState(false)
  const [quickNotesLastSavedAt, setQuickNotesLastSavedAt] = useState<string | null>(null)
  const [quickNotesSaveError, setQuickNotesSaveError] = useState<string | null>(null)
  const [isQuickNotesClearConfirmOpen, setIsQuickNotesClearConfirmOpen] = useState(false)
  const latestQuickNotesTextRef = useRef('')
  const quickNotesLastSavedTextRef = useRef('')
  const technicianSuggestions = users
    .filter((user) => Boolean(user.can_be_assigned_as_technician) && Boolean(user.name?.trim()))
    .map((user) => user.name!.trim())
  const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([])
  const [presencePeriod, setPresencePeriod] = useState<PresencePeriod>('today')
  const [onlineNames, setOnlineNames] = useState<string[]>([])
  const [onlineCount, setOnlineCount] = useState(0)
  const [isPresenceModalOpen, setIsPresenceModalOpen] = useState(false)
  const [manualHistory, setManualHistory] = useState<ManualNotificationHistoryItem[]>([])
  const [isManualHistoryLoading, setIsManualHistoryLoading] = useState(false)
  const [selectedPresenceUserId, setSelectedPresenceUserId] = useState<string | null>(null)
  const [activityItems, setActivityItems] = useState<ActivityItem[]>([])
  const [isActivityLoading, setIsActivityLoading] = useState(false)
  const [spinningIcon, setSpinningIcon] = useState<SpinnableIconKey | null>(null)
  const [spinningIconDirection, setSpinningIconDirection] = useState<'normal' | 'reverse'>(
    'normal'
  )
  const [, startTransition] = useTransition()
  const closeTimerRef = useRef<number | null>(null)
  const todayJobsCloseTimerRef = useRef<number | null>(null)
  const quickNotesCloseTimerRef = useRef<number | null>(null)
  const iconSpinResetTimerRef = useRef<number | null>(null)
  const { toast, isVisible: isToastVisible, showToast } = useAnimatedActionToast()

  useBodyScrollLock(isSheetMounted && !isDesktopViewport)

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)')
    const syncDesktopViewport = () => {
      setIsDesktopViewport(mediaQuery.matches)
    }

    syncDesktopViewport()
    mediaQuery.addEventListener('change', syncDesktopViewport)

    return () => {
      mediaQuery.removeEventListener('change', syncDesktopViewport)
    }
  }, [])

  useEffect(() => {
    if (!isHydrated) return

    let shouldStopHeartbeat = false

    const runHeartbeat = async () => {
      if (shouldStopHeartbeat) return

      let result:
        | Awaited<ReturnType<typeof trackUserPresenceAction>>
        | null = null

      try {
        result = await trackUserPresenceAction({
          route: '/dashboard',
          section: 'Dashboard',
        })
      } catch {
        shouldStopHeartbeat = true
        return
      }

      if (result && !result.success) {
        const errorMessage = String(result.error ?? '')

        if (errorMessage.includes('Chybí tabulka user_presence')) {
          shouldStopHeartbeat = true
          return
        }
      }
    }

    void runHeartbeat()
    const intervalId = window.setInterval(() => {
      void runHeartbeat()
    }, 30_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isHydrated])

  useEffect(() => {
    if (!isHydrated || !isAdmin || !isDesktopViewport) return

    let isCancelled = false

    const refreshPresenceOverview = async () => {
      const result = await getPresenceOverviewForAdminAction(presencePeriod)

      if (isCancelled) return

      if (!result.success) {
        console.error(result.error)
        setPresenceUsers([])
        setOnlineNames([])
        setOnlineCount(0)
        return
      }

      const allUsers = result.usersInPeriod as PresenceUser[]
      const onlineUsers = allUsers.filter((item) => item.isOnline)
      const nextNames = onlineUsers
        .map((item) => item.name.trim())
        .filter(Boolean)

      setPresenceUsers(allUsers)
      setOnlineNames(nextNames)
      setOnlineCount(onlineUsers.length)

      if (!selectedPresenceUserId && allUsers.length > 0) {
        setSelectedPresenceUserId(allUsers[0]?.id ?? null)
      }
      if (selectedPresenceUserId && !allUsers.some((item) => item.id === selectedPresenceUserId)) {
        setSelectedPresenceUserId(allUsers[0]?.id ?? null)
      }
    }

    void refreshPresenceOverview()
    const intervalId = window.setInterval(() => {
      void refreshPresenceOverview()
    }, 30_000)

    return () => {
      isCancelled = true
      window.clearInterval(intervalId)
    }
  }, [isAdmin, isDesktopViewport, isHydrated, selectedPresenceUserId, presencePeriod])

  useEffect(() => {
    if (!isHydrated || !isAdmin || !isDesktopViewport || !selectedPresenceUserId) return

    let isCancelled = false

    const loadActivity = async () => {
      setIsActivityLoading(true)
      const result = await getUserActivityForAdminAction(selectedPresenceUserId, 30, presencePeriod)
      if (isCancelled) return

      if (!result.success) {
        console.error(result.error)
        setActivityItems([])
        setIsActivityLoading(false)
        return
      }

      setActivityItems((result.items ?? []) as ActivityItem[])
      setIsActivityLoading(false)
    }

    void loadActivity()

    return () => {
      isCancelled = true
    }
  }, [isAdmin, isDesktopViewport, isHydrated, selectedPresenceUserId, presencePeriod])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const isStandalone =
      window.matchMedia?.('(display-mode: standalone)').matches === true ||
      (typeof navigator !== 'undefined' && 'standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))

    if (!isStandalone || !window.visualViewport) return

    const viewport = window.visualViewport
    const syncBottomOffset = () => {
      const nextOffset = Math.max(0, Math.round(window.innerHeight - (viewport.height + viewport.offsetTop)))
      setViewportBottomOffset(nextOffset)
    }

    syncBottomOffset()
    viewport.addEventListener('resize', syncBottomOffset)
    viewport.addEventListener('scroll', syncBottomOffset)
    window.addEventListener('orientationchange', syncBottomOffset)

    return () => {
      viewport.removeEventListener('resize', syncBottomOffset)
      viewport.removeEventListener('scroll', syncBottomOffset)
      window.removeEventListener('orientationchange', syncBottomOffset)
    }
  }, [])

  useEffect(() => {
    if (!isHydrated) return

    const syncVisibility = () => {
      setIsQuickCreateVisible(readDashboardQuickCreateEnabled())
      setIsQuickNotesVisible(readDashboardQuickNotesEnabled())
      setIsTodayJobsVisible(readDashboardTodayJobsEnabled())
    }

    syncVisibility()
    window.addEventListener('storage', syncVisibility)
    window.addEventListener('dashboard-widget-settings-changed', syncVisibility)

    return () => {
      window.removeEventListener('storage', syncVisibility)
      window.removeEventListener('dashboard-widget-settings-changed', syncVisibility)
    }
  }, [isHydrated])

  useEffect(() => {
    if (isQuickCreateVisible) return
    if (!isSheetMounted) return
    closeSheet()
  }, [isQuickCreateVisible, isSheetMounted])

  useEffect(() => {
    if (isQuickNotesVisible) return
    if (activeAction !== 'quick_notes') return
    setIsQuickNotesMounted(false)
    setIsQuickNotesOpen(false)
    setActiveAction(null)
  }, [isQuickNotesVisible, activeAction])

  useEffect(() => {
    if (isTodayJobsVisible) return
    if (activeAction !== 'today_jobs') return
    closeTodayJobs()
  }, [isTodayJobsVisible, activeAction])

  useEffect(() => {
    if (canViewJobs && isTodayJobsVisible) return
    if (activeAction === 'today_jobs') {
      closeTodayJobs()
    }
  }, [activeAction, canViewJobs, isTodayJobsVisible])

  async function loadTodayJobs(options?: { showLoading: boolean }) {
    const showLoading = options?.showLoading ?? false
    if (showLoading) {
      setTodayJobsLoading(true)
    }
    setTodayJobsError(null)

    const result = await getTodayJobsForDashboardAction()
    if (!result.success) {
      setTodayJobs([])
      setTodayJobsError(result.error ?? 'Nepodařilo se načíst dnešní zakázky.')
      setTodayJobsLoading(false)
      setTodayJobsLoaded(false)
      return
    }

    setTodayJobs((result.items ?? []) as TodayJobItem[])
    setTodayJobsLoading(false)
    setTodayJobsLoaded(true)
  }

  useEffect(() => {
    if (!isHydrated || !canViewJobs || !isTodayJobsVisible) return
    if (todayJobsLoaded || todayJobsLoading) return
    void loadTodayJobs({ showLoading: false })
  }, [
    canViewJobs,
    isHydrated,
    isTodayJobsVisible,
    todayJobsLoaded,
    todayJobsLoading,
  ])

  useEffect(() => {
    if (activeAction !== 'today_jobs') return
    if (todayJobsLoaded) return
    void loadTodayJobs({ showLoading: true })
  }, [activeAction, todayJobsLoaded])

  useEffect(() => {
    if (activeAction !== 'quick_notes') return
    if (quickNotesLoaded) return

    let isCancelled = false
    ;(async () => {
      const result = await getMyDashboardQuickNoteAction()
      if (isCancelled) return
      if (result.success) {
        const initialContent = result.content ?? ''
        setQuickNotesText(initialContent)
        latestQuickNotesTextRef.current = initialContent
        quickNotesLastSavedTextRef.current = initialContent
        setQuickNotesLastSavedAt(result.updatedAt ?? null)
      }
      setQuickNotesLoaded(true)
    })()

    return () => {
      isCancelled = true
    }
  }, [activeAction, quickNotesLoaded])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current)
      }
      if (todayJobsCloseTimerRef.current) {
        window.clearTimeout(todayJobsCloseTimerRef.current)
      }
      if (quickNotesCloseTimerRef.current) {
        window.clearTimeout(quickNotesCloseTimerRef.current)
      }
      if (iconSpinResetTimerRef.current) {
        window.clearTimeout(iconSpinResetTimerRef.current)
      }
    }
  }, [])

  function triggerIconSpin(icon: SpinnableIconKey, direction: 'normal' | 'reverse' = 'normal') {
    if (iconSpinResetTimerRef.current) {
      window.clearTimeout(iconSpinResetTimerRef.current)
    }

    setSpinningIconDirection(direction)
    setSpinningIcon(icon)
    iconSpinResetTimerRef.current = window.setTimeout(() => {
      setSpinningIcon(null)
      iconSpinResetTimerRef.current = null
    }, 460)
  }

  function getIconSpinClass(icon: SpinnableIconKey) {
    if (spinningIcon !== icon) return ''
    return spinningIconDirection === 'reverse'
      ? 'animate-[spin_.45s_ease-in-out_1_reverse]'
      : 'animate-[spin_.45s_ease-in-out_1]'
  }

  function openSheet() {
    closeTodayJobsImmediately()

    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }

    setIsSheetMounted(true)
    requestAnimationFrame(() => {
      setIsSheetOpen(true)
    })
    triggerHaptic(10)
  }

  function closeSheet() {
    setIsSheetOpen(false)
    triggerHaptic(8)
    closeTimerRef.current = window.setTimeout(() => {
      setIsSheetMounted(false)
      closeTimerRef.current = null
    }, 180)
  }

  function openQuickNotes() {
    closeTodayJobsImmediately()

    if (quickNotesCloseTimerRef.current) {
      window.clearTimeout(quickNotesCloseTimerRef.current)
      quickNotesCloseTimerRef.current = null
    }

    setActiveAction('quick_notes')
    setIsQuickNotesMounted(true)
    requestAnimationFrame(() => {
      setIsQuickNotesOpen(true)
    })
    triggerHaptic(10)
  }

  function openTodayJobs() {
    if (todayJobsCloseTimerRef.current) {
      window.clearTimeout(todayJobsCloseTimerRef.current)
      todayJobsCloseTimerRef.current = null
    }

    setActiveAction('today_jobs')
    setIsTodayJobsMounted(true)
    requestAnimationFrame(() => {
      setIsTodayJobsOpen(true)
    })
    triggerHaptic(10)
  }

  function closeTodayJobs() {
    setIsTodayJobsOpen(false)
    triggerHaptic(8)
    todayJobsCloseTimerRef.current = window.setTimeout(() => {
      setIsTodayJobsMounted(false)
      setActiveAction((current) => (current === 'today_jobs' ? null : current))
      todayJobsCloseTimerRef.current = null
    }, 180)
  }

  function closeTodayJobsImmediately() {
    if (todayJobsCloseTimerRef.current) {
      window.clearTimeout(todayJobsCloseTimerRef.current)
      todayJobsCloseTimerRef.current = null
    }
    setIsTodayJobsOpen(false)
    setIsTodayJobsMounted(false)
    setActiveAction((current) => (current === 'today_jobs' ? null : current))
  }

  function closeQuickNotesWithAnimation() {
    setIsQuickNotesOpen(false)
    quickNotesCloseTimerRef.current = window.setTimeout(() => {
      setIsQuickNotesMounted(false)
      setActiveAction((current) => (current === 'quick_notes' ? null : current))
      quickNotesCloseTimerRef.current = null
    }, 180)
  }

  async function persistQuickNotes(currentText?: string) {
    if (isQuickNotesSaving) return
    const textToSave = typeof currentText === 'string' ? currentText : latestQuickNotesTextRef.current
    if (textToSave === quickNotesLastSavedTextRef.current) return

    setIsQuickNotesSaving(true)
    setQuickNotesSaveError(null)
    const result = await upsertMyDashboardQuickNoteAction({
      content: textToSave,
    })
    if (!result.success) {
      setQuickNotesSaveError(result.error ?? 'Poznámku se nepodařilo uložit.')
      setIsQuickNotesSaving(false)
      return
    }
    quickNotesLastSavedTextRef.current = textToSave
    setQuickNotesLastSavedAt(result.updatedAt ?? new Date().toISOString())
    setIsQuickNotesSaving(false)
  }

  async function persistQuickNotesAndClose() {
    await persistQuickNotes()
    closeQuickNotesWithAnimation()
  }

  useEffect(() => {
    latestQuickNotesTextRef.current = quickNotesText
  }, [quickNotesText])

  useEffect(() => {
    if (activeAction !== 'quick_notes') return
    if (!quickNotesLoaded) return

    const intervalId = window.setInterval(() => {
      void persistQuickNotes()
    }, 5_000)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [activeAction, quickNotesLoaded, isQuickNotesSaving])

  function formatLastSavedLabel(value: string | null) {
    if (!value) return null
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return null
    return new Intl.DateTimeFormat('cs-CZ', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(date)
  }

  function formatJobDateTime(value: string) {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return '—'
    const day = date.getDate()
    const month = date.getMonth() + 1
    const time = new Intl.DateTimeFormat('cs-CZ', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)

    return `${day}.${month}. ${time}`
  }

  function formatJobCity(value: string | null) {
    const raw = String(value ?? '').trim()
    if (!raw) return '—'

    const [cityPart] = raw.split(',')
    const city = String(cityPart ?? '').trim()
    return city || raw
  }

  async function clearQuickNotes() {
    setIsQuickNotesClearConfirmOpen(false)
    setIsQuickNotesSaving(true)
    setQuickNotesSaveError(null)
    const result = await clearMyDashboardQuickNoteAction()
    setIsQuickNotesSaving(false)

    if (!result.success) {
      setQuickNotesSaveError(result.error ?? 'Poznámku se nepodařilo smazat.')
      return
    }

    setQuickNotesText('')
    latestQuickNotesTextRef.current = ''
    quickNotesLastSavedTextRef.current = ''
    setQuickNotesLastSavedAt(new Date().toISOString())
  }

  useEffect(() => {
    if (!isSheetMounted) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeSheet()
      }
    }

    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isSheetMounted])

  function handleActionSelect(action: QuickActionKey) {
    closeTodayJobsImmediately()
    setActiveAction(action)
    closeSheet()
    void trackUserPresenceAction({
      route: '/dashboard',
      section: 'Dashboard',
      action: `Spustil rychlou akci: ${action}`,
      addActivityLog: true,
    })
  }

  function handleActionSuccess(toastValue: ActionFeedbackToastValue) {
    triggerHaptic([12, 20, 12])
    showToast(toastValue)
    startTransition(() => {
      router.refresh()
    })
  }

  function handleClientSuccess(state: CreateClientActionState) {
    handleActionSuccess(buildClientCreatedToast(state))
  }

  function handleTaskSuccess(state: CreateTaskActionState) {
    handleActionSuccess(buildTaskCreatedToast(state))
  }

  function handleMeetingSuccess(state: CreateMeetingActionState) {
    handleActionSuccess(buildMeetingCreatedToast(state))
  }

  function handleJobSuccess(state: CreateJobActionState) {
    handleActionSuccess(buildJobCreatedToast(state))
  }

  function handleModalError(message: string) {
    triggerHaptic(24)
    showToast(buildErrorToast(message))
  }

  function handleManualNotificationSent(sentCount: number) {
    triggerHaptic([12, 20, 12])
    showToast({
      title: 'NOTIFIKACE ODESLÁNA',
      message:
        sentCount <= 1
          ? 'Notifikace byla odeslána.'
          : 'Notifikace byla odeslána vybraným uživatelům.',
      tone: 'success',
    })
    startTransition(() => {
      router.refresh()
    })
  }

  const actions = [
    {
      key: 'client' as const,
      label: 'KLIENT',
      visible: true,
    },
    {
      key: 'meeting' as const,
      label: 'SCHŮZKA',
      visible: true,
    },
    {
      key: 'task' as const,
      label: 'ÚKOL',
      visible: true,
    },
    {
      key: 'offer' as const,
      label: 'NABÍDKA',
      visible: canViewOffers,
    },
    {
      key: 'job' as const,
      label: 'ZAKÁZKA',
      visible: canCreateJobs,
    },
  ].filter((action) => action.visible)

  const selectedPresenceUser = presenceUsers.find((item) => item.id === selectedPresenceUserId) ?? null

  async function refreshManualHistory() {
    if (!isAdmin || !isDesktopViewport) return
    setIsManualHistoryLoading(true)
    const result = await getManualNotificationHistoryForAdminAction(20)
    if (!result.success) {
      console.error(result.error)
      setManualHistory([])
      setIsManualHistoryLoading(false)
      return
    }

    setManualHistory((result.items ?? []) as ManualNotificationHistoryItem[])
    setIsManualHistoryLoading(false)
  }

  useEffect(() => {
    if (activeAction !== 'manual_notifications') return
    void refreshManualHistory()
    // intentionally bound to modal open/close only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAction])

  async function openPresenceModal() {
    if (!isAdmin || !isDesktopViewport) return
    closeTodayJobsImmediately()
    triggerHaptic(10)
    setIsPresenceModalOpen(true)
    const result = await trackUserPresenceAction({
      route: '/dashboard',
      section: 'Dashboard',
      action: 'Otevřel sledovač online stavu',
      addActivityLog: true,
    })

    if (!result.success) {
      console.error(result.error)
    }
  }

  const isTodayJobsButtonVisible = canViewJobs && isTodayJobsVisible

  const mobileBaseRight = 16
  const mobileStep = 68
  const mobileQuickCreateRight = mobileBaseRight
  const mobileTodayJobsRight =
    mobileQuickCreateRight + (isQuickCreateVisible ? mobileStep : 0)
  const mobileQuickNotesRight =
    mobileTodayJobsRight + (isTodayJobsButtonVisible ? mobileStep : 0)
  const mobileInvoicesRight =
    mobileQuickNotesRight + (isQuickNotesVisible ? mobileStep : 0)

  const desktopBaseRight = 28
  const desktopStep = 76
  const desktopQuickCreateRight = desktopBaseRight
  const desktopTodayJobsRight =
    desktopQuickCreateRight + (isQuickCreateVisible ? desktopStep : 0)
  const desktopQuickNotesRight =
    desktopTodayJobsRight + (isTodayJobsButtonVisible ? desktopStep : 0)
  const desktopInvoicesRight =
    desktopQuickNotesRight + (isQuickNotesVisible ? desktopStep : 0)
  const desktopManualNotificationsRight =
    desktopInvoicesRight + (isAdmin ? desktopStep : 0)
  const desktopOnlinePanelRight =
    desktopManualNotificationsRight + (isAdmin ? desktopStep : 0)
  const shouldHideFloatingControls = Boolean(
    activeAction && activeAction !== 'quick_notes' && activeAction !== 'today_jobs'
  )
  const FLOATING_INACTIVE_CLASS = 'blur-[6px] lg:blur-[5px]'
  const FLOATING_BLUE_BUTTON_CLASS =
    'dashboard-floating-action border-[#2f2f2f]/95 bg-[linear-gradient(160deg,rgba(38,38,38,0.95)_0%,rgba(20,20,20,0.96)_45%,rgba(8,8,8,0.98)_100%)] text-white hover:border-[#3a3a3a] hover:bg-[linear-gradient(160deg,rgba(48,48,48,0.96)_0%,rgba(28,28,28,0.97)_45%,rgba(12,12,12,0.99)_100%)]'
  const FLOATING_BLUE_BUTTON_ACTIVE_CLASS =
    'dashboard-floating-action--active scale-[0.97] bg-[linear-gradient(160deg,rgba(52,52,52,0.97)_0%,rgba(32,32,32,0.98)_45%,rgba(14,14,14,0.99)_100%)] shadow-[inset_0_3px_8px_rgba(0,0,0,0.48),inset_0_1px_0_rgba(255,255,255,0.16),0_10px_22px_rgba(0,0,0,0.46)]'
  const activeFloatingModal: 'quick_create' | 'quick_notes' | 'today_jobs' | null =
    isQuickNotesOpen
      ? 'quick_notes'
      : isTodayJobsOpen
      ? 'today_jobs'
      : isSheetOpen
      ? 'quick_create'
      : null
  const isQuickCreateActive = activeFloatingModal === 'quick_create'

  const getFloatingBlurClass = (
    activeFloatingButton: 'quick_create' | 'quick_notes' | 'today_jobs' | 'other'
  ) => {
    if (!activeFloatingModal) return ''
    if (activeFloatingButton === activeFloatingModal) return ''
    if (activeFloatingButton === 'other') return FLOATING_INACTIVE_CLASS
    if (activeFloatingButton !== activeFloatingModal) return FLOATING_INACTIVE_CLASS
    return ''
  }

  const floatingLayer = (
    <>
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isToastVisible} /> : null}

      {isAdmin ? (
        <button
          type="button"
          aria-label="Otevřít sledovač online stavu"
          onClick={() => {
            void openPresenceModal()
          }}
          className={`dashboard-online-panel fixed z-[70] hidden overflow-hidden border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] text-zinc-900 backdrop-blur-xl transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] lg:block ${
            shouldHideFloatingControls
              ? 'pointer-events-none opacity-0 scale-[0.94]'
              : isSheetOpen && !isQuickCreateActive
              ? 'translate-y-[-2px] scale-[0.99] shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_20px_42px_rgba(15,23,42,0.26)]'
              : 'translate-y-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_12px_28px_rgba(15,23,42,0.2)] hover:-translate-y-0.5'
          } ${getFloatingBlurClass('other')}`}
          style={{
            right: `${desktopOnlinePanelRight}px`,
            bottom: '28px',
            width: '286px',
            height: '68px',
            minWidth: '286px',
            minHeight: '68px',
            borderRadius: '20px',
          }}
        >
          <div
            aria-hidden="true"
            className="dashboard-online-panel__top-line pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-95"
          />

          <div className="flex h-full flex-col justify-center px-[18px]">
            <div className="flex items-center gap-2">
              <div className="dashboard-online-panel__label inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                <span>ONLINE</span>
                <span className="relative inline-flex h-2.5 w-2.5">
                  <span className="dashboard-online-panel__dot-glow absolute inline-flex h-full w-full rounded-full bg-emerald-400/60 blur-[2px]" />
                  <span className="dashboard-online-panel__dot relative inline-flex h-2.5 w-2.5 rounded-full border border-emerald-200/90 bg-emerald-500 shadow-[0_0_10px_rgba(34,197,94,0.95)]" />
                </span>
              </div>
            </div>

            <div className="dashboard-online-panel__text mt-1 w-full truncate text-left text-[12px] font-medium leading-4 text-zinc-800">
              {onlineCount === 0
                ? 'Nikdo další není online'
                : (() => {
                    const visibleNames = onlineNames.slice(0, 4)
                    const remaining = onlineCount - visibleNames.length
                    const base = visibleNames.join(', ')

                    if (remaining > 0) {
                      return `${base} +${remaining}`
                    }

                    return base
                  })()}
            </div>
          </div>
        </button>
      ) : null}

      {isAdmin ? (
        <button
          type="button"
          aria-label="Přijaté faktury"
          title="Přijaté faktury"
          onClick={() => {
            if (activeAction === 'received_invoices') {
              triggerIconSpin('invoices', 'reverse')
              setActiveAction(null)
              return
            }
            closeTodayJobsImmediately()
            triggerHaptic(10)
            triggerIconSpin('invoices')
            setActiveAction('received_invoices')
          }}
          className={`fixed z-[70] flex items-center justify-center border ${FLOATING_BLUE_BUTTON_CLASS} backdrop-blur-xl transition duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.95] lg:hidden ${
            shouldHideFloatingControls
              ? 'pointer-events-none opacity-0 scale-[0.92]'
              : isSheetOpen && !isQuickCreateActive
              ? 'translate-y-[-3px] scale-[0.985] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_24px_52px_rgba(0,0,0,0.48)]'
              : 'translate-y-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_14px_34px_rgba(0,0,0,0.42)]'
          } ${getFloatingBlurClass('other')}`}
          style={{
            right: `${mobileInvoicesRight}px`,
            bottom: `calc(env(safe-area-inset-bottom, 0px) + 16px + ${viewportBottomOffset}px)`,
            width: '60px',
            height: '60px',
            minWidth: '60px',
            minHeight: '60px',
            borderRadius: '999px',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-6 w-6 ${getIconSpinClass('invoices')}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="0.8" y="3.5" width="22.4" height="16.6" rx="3.3" />
            <rect x="2.9" y="5.3" width="18.2" height="13" rx="2.3" />
            <circle cx="12" cy="11.8" r="3.1" />
            <path d="M13.9 9.9c-1.5 0-2.55.76-3.05 1.9" />
            <path d="M10.35 11.35h3.85" />
            <path d="M10.15 12.35h3.65" />
            <path d="M10.95 12.95c.5 1.08 1.55 1.75 3 1.75" />
          </svg>
          {receivedInvoicesDueCount > 0 ? (
            <span className="absolute -right-2 -top-2 z-20 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full border-2 border-red-600 bg-red-600 px-1.5 text-[11px] font-semibold leading-none text-white">
              {receivedInvoicesDueCount > 99 ? '99+' : receivedInvoicesDueCount}
            </span>
          ) : null}
        </button>
      ) : null}

      {isAdmin ? (
        <button
          type="button"
          aria-label="Ruční notifikace"
          title="Ruční notifikace"
          onClick={() => {
            if (activeAction === 'manual_notifications') {
              triggerIconSpin('manual_notifications', 'reverse')
              setActiveAction(null)
              return
            }
            closeTodayJobsImmediately()
            triggerHaptic(10)
            triggerIconSpin('manual_notifications')
            setActiveAction('manual_notifications')
          }}
          className={`fixed z-[70] hidden items-center justify-center border ${FLOATING_BLUE_BUTTON_CLASS} backdrop-blur-xl transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[#2a2a2a] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_20px_38px_rgba(0,0,0,0.52)] lg:flex ${
            shouldHideFloatingControls
              ? 'pointer-events-none opacity-0 scale-[0.94]'
              : isSheetOpen && !isQuickCreateActive
              ? 'translate-y-[-2px] scale-[0.99] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_18px_42px_rgba(0,0,0,0.46)]'
              : 'translate-y-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_12px_28px_rgba(0,0,0,0.42)]'
          } ${getFloatingBlurClass('other')}`}
          style={{
            right: `${desktopManualNotificationsRight}px`,
            bottom: '28px',
            width: '68px',
            height: '68px',
            minWidth: '68px',
            minHeight: '68px',
            borderRadius: '999px',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-7 w-7 ${getIconSpinClass('manual_notifications')}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M15 17h5" />
            <path d="M17.5 14.5v5" />
            <path d="M18 8a6 6 0 1 0-12 0c0 3-1 4.5-2 6h10" />
            <path d="M10.2 20a2 2 0 0 0 3.6 0" />
          </svg>
        </button>
      ) : null}

      {isTodayJobsButtonVisible ? (
        <button
          type="button"
          aria-label="Dnešní zakázky"
          title="Dnešní zakázky"
          onClick={() => {
            if (isTodayJobsOpen) {
              triggerIconSpin('today_jobs', 'reverse')
              closeTodayJobs()
              return
            }
            triggerIconSpin('today_jobs')
            openTodayJobs()
          }}
          className={`fixed z-[70] flex items-center justify-center border ${FLOATING_BLUE_BUTTON_CLASS} backdrop-blur-xl transition duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.95] lg:hidden ${
            shouldHideFloatingControls
              ? 'pointer-events-none opacity-0 scale-[0.92]'
              : isSheetOpen && !isQuickCreateActive
              ? 'translate-y-[-3px] scale-[0.985] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_24px_52px_rgba(0,0,0,0.48)]'
              : 'translate-y-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_14px_34px_rgba(0,0,0,0.42)]'
          } ${isTodayJobsOpen ? `z-[80] ${FLOATING_BLUE_BUTTON_ACTIVE_CLASS}` : ''} ${getFloatingBlurClass('today_jobs')}`}
          style={{
            right: `${mobileTodayJobsRight}px`,
            bottom: `calc(env(safe-area-inset-bottom, 0px) + 16px + ${viewportBottomOffset}px)`,
            width: '60px',
            height: '60px',
            minWidth: '60px',
            minHeight: '60px',
            borderRadius: '999px',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-8 w-8 translate-x-[2.5px] ${getIconSpinClass('today_jobs')}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2.4 15.2h14.8" />
            <rect x="3" y="7.1" width="12.9" height="7.1" rx="1.7" />
            <path d="M15.9 11h2.6" />
            <path d="M18.5 11h1.8v1.9" />
            <circle cx="6.1" cy="17.7" r="1.5" />
            <circle cx="12.5" cy="17.7" r="1.5" />
          </svg>
        </button>
      ) : null}

      {isQuickNotesVisible ? (
        <button
          type="button"
          aria-label="Poznámky"
          title="Poznámky"
          onClick={() => {
            if (isQuickNotesOpen) {
              triggerIconSpin('quick_notes', 'reverse')
              void persistQuickNotesAndClose()
              return
            }
            triggerIconSpin('quick_notes')
            openQuickNotes()
          }}
          className={`fixed z-[70] flex items-center justify-center border ${FLOATING_BLUE_BUTTON_CLASS} backdrop-blur-xl transition duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.95] lg:hidden ${
            shouldHideFloatingControls
              ? 'pointer-events-none opacity-0 scale-[0.92]'
              : isSheetOpen && !isQuickCreateActive
              ? 'translate-y-[-3px] scale-[0.985] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_24px_52px_rgba(0,0,0,0.48)]'
              : 'translate-y-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_14px_34px_rgba(0,0,0,0.42)]'
          } ${isQuickNotesOpen ? `z-[80] ${FLOATING_BLUE_BUTTON_ACTIVE_CLASS}` : ''} ${getFloatingBlurClass('quick_notes')}`}
          style={{
            right: `${mobileQuickNotesRight}px`,
            bottom: `calc(env(safe-area-inset-bottom, 0px) + 16px + ${viewportBottomOffset}px)`,
            width: '60px',
            height: '60px',
            minWidth: '60px',
            minHeight: '60px',
            borderRadius: '999px',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-6 w-6 ${getIconSpinClass('quick_notes')}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="5" y="3" width="14" height="18" rx="2.5" />
            <path d="M9 3v3" />
            <path d="M15 3v3" />
            <path d="M8.5 10h7" />
            <path d="M8.5 14h7" />
          </svg>
        </button>
      ) : null}

      {isQuickCreateVisible ? (
        <button
          type="button"
          aria-label="Rychlé vytvoření"
          onClick={() => {
            if (isSheetMounted) {
              triggerIconSpin('quick_create', 'reverse')
              closeSheet()
              return
            }

            triggerIconSpin('quick_create')
            openSheet()
          }}
          className={`fixed z-[70] flex items-center justify-center border ${FLOATING_BLUE_BUTTON_CLASS} backdrop-blur-xl transition duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.95] lg:hidden ${
            shouldHideFloatingControls
              ? 'pointer-events-none opacity-0 scale-[0.92]'
              : 'translate-y-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_14px_34px_rgba(0,0,0,0.42)]'
          } ${isSheetOpen ? `z-[80] ${FLOATING_BLUE_BUTTON_ACTIVE_CLASS}` : ''} ${getFloatingBlurClass('quick_create')}`}
          style={{
            right: `${mobileQuickCreateRight}px`,
            bottom: `calc(env(safe-area-inset-bottom, 0px) + 16px + ${viewportBottomOffset}px)`,
            width: '60px',
            height: '60px',
            minWidth: '60px',
            minHeight: '60px',
            borderRadius: '999px',
          }}
          >
          <span
            className={`text-[30px] font-semibold leading-none transition duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
              isSheetOpen ? 'rotate-45' : 'rotate-0'
            } ${getIconSpinClass('quick_create')}`}
          >
            +
          </span>
        </button>
      ) : null}

      {isAdmin ? (
        <button
          type="button"
          aria-label="Přijaté faktury"
          title="Přijaté faktury"
          onClick={() => {
            if (activeAction === 'received_invoices') {
              triggerIconSpin('invoices', 'reverse')
              setActiveAction(null)
              return
            }
            closeTodayJobsImmediately()
            triggerHaptic(10)
            triggerIconSpin('invoices')
            setActiveAction('received_invoices')
          }}
          className={`fixed z-[70] hidden items-center justify-center border ${FLOATING_BLUE_BUTTON_CLASS} backdrop-blur-xl transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[#2a2a2a] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_20px_38px_rgba(0,0,0,0.52)] lg:flex ${
            shouldHideFloatingControls
              ? 'pointer-events-none opacity-0 scale-[0.94]'
              : isSheetOpen && !isQuickCreateActive
              ? 'translate-y-[-2px] scale-[0.99] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_18px_42px_rgba(0,0,0,0.46)]'
              : 'translate-y-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_12px_28px_rgba(0,0,0,0.42)]'
          } ${getFloatingBlurClass('other')}`}
          style={{
            right: `${desktopInvoicesRight}px`,
            bottom: '28px',
            width: '68px',
            height: '68px',
            minWidth: '68px',
            minHeight: '68px',
            borderRadius: '999px',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-7 w-7 ${getIconSpinClass('invoices')}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="0.8" y="3.5" width="22.4" height="16.6" rx="3.3" />
            <rect x="2.9" y="5.3" width="18.2" height="13" rx="2.3" />
            <circle cx="12" cy="11.8" r="3.1" />
            <path d="M13.9 9.9c-1.5 0-2.55.76-3.05 1.9" />
            <path d="M10.35 11.35h3.85" />
            <path d="M10.15 12.35h3.65" />
            <path d="M10.95 12.95c.5 1.08 1.55 1.75 3 1.75" />
          </svg>
          {receivedInvoicesDueCount > 0 ? (
            <span className="absolute -right-2 -top-2 z-20 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full border-2 border-red-600 bg-red-600 px-1.5 text-[11px] font-semibold leading-none text-white">
              {receivedInvoicesDueCount > 99 ? '99+' : receivedInvoicesDueCount}
            </span>
          ) : null}
        </button>
      ) : null}

      {isTodayJobsButtonVisible ? (
        <button
          type="button"
          aria-label="Dnešní zakázky"
          title="Dnešní zakázky"
          onClick={() => {
            if (isTodayJobsOpen) {
              triggerIconSpin('today_jobs', 'reverse')
              closeTodayJobs()
              return
            }
            triggerIconSpin('today_jobs')
            openTodayJobs()
          }}
          className={`fixed z-[70] hidden items-center justify-center border ${FLOATING_BLUE_BUTTON_CLASS} backdrop-blur-xl transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[#2a2a2a] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_20px_38px_rgba(0,0,0,0.52)] lg:flex ${
            shouldHideFloatingControls
              ? 'pointer-events-none opacity-0 scale-[0.94]'
              : isSheetOpen && !isQuickCreateActive
              ? 'translate-y-[-2px] scale-[0.99] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_18px_42px_rgba(0,0,0,0.46)]'
              : 'translate-y-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_12px_28px_rgba(0,0,0,0.42)]'
          } ${isTodayJobsOpen ? `z-[80] ${FLOATING_BLUE_BUTTON_ACTIVE_CLASS}` : ''} ${getFloatingBlurClass('today_jobs')}`}
          style={{
            right: `${desktopTodayJobsRight}px`,
            bottom: '28px',
            width: '68px',
            height: '68px',
            minWidth: '68px',
            minHeight: '68px',
            borderRadius: '999px',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-9 w-9 translate-x-[2.5px] ${getIconSpinClass('today_jobs')}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2.4 15.2h14.8" />
            <rect x="3" y="7.1" width="12.9" height="7.1" rx="1.7" />
            <path d="M15.9 11h2.6" />
            <path d="M18.5 11h1.8v1.9" />
            <circle cx="6.1" cy="17.7" r="1.5" />
            <circle cx="12.5" cy="17.7" r="1.5" />
          </svg>
        </button>
      ) : null}

      {isQuickNotesVisible ? (
        <button
          type="button"
          aria-label="Poznámky"
          title="Poznámky"
          onClick={() => {
            if (isQuickNotesOpen) {
              triggerIconSpin('quick_notes', 'reverse')
              void persistQuickNotesAndClose()
              return
            }
            triggerIconSpin('quick_notes')
            openQuickNotes()
          }}
          className={`fixed z-[70] hidden items-center justify-center border ${FLOATING_BLUE_BUTTON_CLASS} backdrop-blur-xl transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[#2a2a2a] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_20px_38px_rgba(0,0,0,0.52)] lg:flex ${
            shouldHideFloatingControls
              ? 'pointer-events-none opacity-0 scale-[0.94]'
              : isSheetOpen && !isQuickCreateActive
              ? 'translate-y-[-2px] scale-[0.99] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_18px_42px_rgba(0,0,0,0.46)]'
              : 'translate-y-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_12px_28px_rgba(0,0,0,0.42)]'
          } ${isQuickNotesOpen ? `z-[80] ${FLOATING_BLUE_BUTTON_ACTIVE_CLASS}` : ''} ${getFloatingBlurClass('quick_notes')}`}
          style={{
            right: `${desktopQuickNotesRight}px`,
            bottom: '28px',
            width: '68px',
            height: '68px',
            minWidth: '68px',
            minHeight: '68px',
            borderRadius: '999px',
          }}
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-7 w-7 ${getIconSpinClass('quick_notes')}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="5" y="3" width="14" height="18" rx="2.5" />
            <path d="M9 3v3" />
            <path d="M15 3v3" />
            <path d="M8.5 10h7" />
            <path d="M8.5 14h7" />
          </svg>
        </button>
      ) : null}

      {isQuickCreateVisible ? (
        <button
          type="button"
          aria-label="Rychlé vytvoření"
          onClick={() => {
            if (isSheetMounted) {
              triggerIconSpin('quick_create', 'reverse')
              closeSheet()
              return
            }

            triggerIconSpin('quick_create')
            openSheet()
          }}
          className={`fixed z-[70] hidden items-center justify-center border ${FLOATING_BLUE_BUTTON_CLASS} backdrop-blur-xl transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[#2a2a2a] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_20px_38px_rgba(0,0,0,0.52)] lg:flex ${
            shouldHideFloatingControls
              ? 'pointer-events-none opacity-0 scale-[0.94]'
              : isSheetMounted
              ? 'translate-y-[-2px] scale-[0.99] shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_18px_42px_rgba(0,0,0,0.46)]'
              : 'translate-y-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_12px_28px_rgba(0,0,0,0.42)]'
        } ${isSheetOpen ? `z-[80] ${FLOATING_BLUE_BUTTON_ACTIVE_CLASS}` : ''} ${getFloatingBlurClass('quick_create')}`}
          style={{
            right: `${desktopQuickCreateRight}px`,
            bottom: '28px',
            width: '68px',
            height: '68px',
            minWidth: '68px',
            minHeight: '68px',
            borderRadius: '999px',
          }}
        >
          <span
            className={`text-[34px] font-semibold leading-none transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
              isSheetOpen ? 'rotate-45' : 'rotate-0'
            } ${getIconSpinClass('quick_create')}`}
          >
            +
          </span>
        </button>
      ) : null}

      {isQuickCreateVisible && isSheetMounted ? (
        <div className="fixed inset-0 z-[65]" aria-hidden="true">
          <button
            type="button"
            aria-label="Zavřít rychlé vytvoření"
            onClick={closeSheet}
            className={`absolute inset-0 transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
              isSheetOpen ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              backgroundColor: isDesktopViewport
                ? 'rgba(15, 23, 42, 0.08)'
                : 'rgba(24, 24, 27, 0.30)',
              backdropFilter: isSheetOpen
                ? isDesktopViewport
                  ? DASHBOARD_MODAL_BACKDROP_BLUR_DESKTOP
                  : DASHBOARD_MODAL_BACKDROP_BLUR_MOBILE
                : 'blur(0px)',
            }}
          />

          <div
            className={`dashboard-floating-actions-sheet absolute overflow-hidden rounded-[28px] border border-white/75 bg-[linear-gradient(168deg,rgba(255,255,255,0.96)_0%,rgba(247,250,253,0.9)_42%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-[280ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
              isSheetOpen
                ? 'translate-x-0 translate-y-0 scale-100 opacity-100 shadow-[0_46px_112px_rgba(15,23,42,0.24)]'
                : 'translate-x-4 translate-y-5 scale-[0.72] opacity-0 shadow-[0_12px_28px_rgba(15,23,42,0.08)]'
            }`}
            style={{
              right: isDesktopViewport ? '28px' : '16px',
              bottom: isDesktopViewport
                ? '104px'
                : 'calc(env(safe-area-inset-bottom, 0px) + 86px)',
              width: isDesktopViewport ? '340px' : 'min(290px, calc(100vw - 2rem))',
              transformOrigin: 'bottom right',
              transitionDelay: isSheetOpen ? '34ms' : '0ms',
              background:
                'linear-gradient(168deg, rgba(255,255,255,0.96) 0%, rgba(247,250,253,0.9) 42%, rgba(241,245,249,0.84) 100%)',
            }}
          >
            <div
              aria-hidden="true"
              className="dashboard-floating-actions-sheet__top-line pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-90"
            />

            <div
              className={`px-2 pb-2 pt-1 transition duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isSheetOpen ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
              }`}
              style={{ transitionDelay: isSheetOpen ? '86ms' : '0ms' }}
            >
              <div className="dashboard-floating-actions-sheet__eyebrow text-[13px] font-semibold uppercase tracking-[0.2em] text-[#2980B9]">
                RYCHLÁ AKCE
              </div>
            </div>

            <div className={`mt-1 grid ${isDesktopViewport ? 'gap-2.5' : 'gap-2'}`}>
              {actions.map((action, index) => (
                <div
                  key={action.key}
                  className={`transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                    isSheetOpen ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-[0.96] opacity-0'
                  }`}
                  style={{ transitionDelay: isSheetOpen ? `${110 + index * 24}ms` : '0ms' }}
                >
                  <button
                    type="button"
                    onClick={() => handleActionSelect(action.key)}
                    className={`dashboard-floating-actions-sheet__button flex w-full items-center justify-between rounded-[22px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-left font-semibold uppercase tracking-[0.03em] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] transition duration-[180ms] ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)] ${
                      isDesktopViewport ? 'min-h-[56px] py-3.5 text-[15px]' : 'min-h-[52px] py-3 text-[15px]'
                    }`}
                  >
                    <span>{action.label}</span>
                    <span className="dashboard-floating-actions-sheet__plus text-[24px] font-bold leading-none text-[#2980B9]">+</span>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {isTodayJobsMounted ? (
        <div className="fixed inset-0 z-[65]" aria-hidden="true">
          <button
            type="button"
            aria-label="Zavřít dnešní zakázky"
            onClick={closeTodayJobs}
            className={`absolute inset-0 transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
              isTodayJobsOpen ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              backgroundColor: isDesktopViewport
                ? 'rgba(15, 23, 42, 0.08)'
                : 'rgba(24, 24, 27, 0.30)',
              backdropFilter: isTodayJobsOpen
                ? isDesktopViewport
                  ? DASHBOARD_MODAL_BACKDROP_BLUR_DESKTOP
                  : DASHBOARD_MODAL_BACKDROP_BLUR_MOBILE
                : 'blur(0px)',
            }}
          />

          <div
            className={`dashboard-today-jobs-modal absolute overflow-hidden rounded-[28px] border border-white/75 bg-[linear-gradient(168deg,rgba(255,255,255,0.96)_0%,rgba(247,250,253,0.9)_42%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-[280ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
              isTodayJobsOpen
                ? 'translate-x-0 translate-y-0 scale-100 opacity-100 shadow-[0_46px_112px_rgba(15,23,42,0.24)]'
                : 'translate-x-4 translate-y-5 scale-[0.72] opacity-0 shadow-[0_12px_28px_rgba(15,23,42,0.08)]'
            }`}
            style={{
              right: isDesktopViewport ? '28px' : '16px',
              bottom: isDesktopViewport
                ? '104px'
                : `calc(env(safe-area-inset-bottom, 0px) + 86px + ${viewportBottomOffset}px)`,
              width: isDesktopViewport ? '340px' : 'min(290px, calc(100vw - 2rem))',
              transformOrigin: 'bottom right',
              transitionDelay: isTodayJobsOpen ? '34ms' : '0ms',
              background:
                'linear-gradient(168deg, rgba(255,255,255,0.96) 0%, rgba(247,250,253,0.9) 42%, rgba(241,245,249,0.84) 100%)',
            }}
          >
            <div
              aria-hidden="true"
              className="dashboard-today-jobs-modal__top-line pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-90"
            />

            <div
              className={`px-2 pb-2 pt-1 transition duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isTodayJobsOpen ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
              }`}
              style={{ transitionDelay: isTodayJobsOpen ? '86ms' : '0ms' }}
            >
              <div className="dashboard-today-jobs-modal__eyebrow text-[13px] font-semibold uppercase tracking-[0.2em] text-[#2980B9]">
                DNEŠNÍ ZAKÁZKY
              </div>
            </div>

            <div
              className={`mt-1 overflow-y-auto transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isTodayJobsOpen ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-[0.96] opacity-0'
              }`}
              style={{
                transitionDelay: isTodayJobsOpen ? '110ms' : '0ms',
                maxHeight: isDesktopViewport ? 'min(62vh, 520px)' : 'min(56vh, 420px)',
              }}
            >
              {todayJobsLoading ? (
                <div className="dashboard-today-jobs-modal__loading rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] px-4 py-3 text-sm text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  Načítám dnešní zakázky…
                </div>
              ) : todayJobsError ? (
                <div className="dashboard-today-jobs-modal__error rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {todayJobsError}
                </div>
              ) : todayJobs.length === 0 ? (
                <div className="dashboard-today-jobs-modal__empty rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] px-4 py-3 text-sm text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  Dnes žádné zakázky.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {todayJobs.map((item) => (
                    <div
                      key={item.id}
                      className="dashboard-today-jobs-modal__item rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 py-2 text-[11px] text-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]"
                      title={`${item.jobNumber} | ${item.companyName} | ${formatJobDateTime(item.startAt)} - ${formatJobDateTime(item.endAt)} | Technik: ${item.technicianName ?? '—'} | Agregát: ${item.generatorName ?? '—'}`}
                    >
                      <div className="flex items-center gap-2 whitespace-nowrap">
                        <span className="dashboard-today-jobs-modal__job-pill inline-flex h-5 shrink-0 items-center rounded-full border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2 text-[10px] font-semibold tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_14px_rgba(24,78,129,0.24)]">
                          {item.jobNumber}
                        </span>
                        <span className="min-w-0 flex-1 truncate font-medium">{item.companyName}</span>
                      </div>

                      <div className="mt-1 text-zinc-600">
                        <span>Adresa:</span>{' '}
                        <span className="break-words text-zinc-900">{formatJobCity(item.siteAddress)}</span>
                      </div>

                      <div className="mt-1 grid grid-cols-2 gap-2 whitespace-nowrap text-zinc-600">
                        <span className="min-w-0 truncate font-semibold text-zinc-900">Začátek: {formatJobDateTime(item.startAt)}</span>
                        <span className="min-w-0 truncate font-semibold text-zinc-900">Konec: {formatJobDateTime(item.endAt)}</span>
                      </div>

                      <div className="mt-1 grid grid-cols-2 gap-2 whitespace-nowrap text-zinc-600">
                        <span className="min-w-0 truncate">
                          Technik:{' '}
                          <span className={item.technicianName ? 'font-semibold text-zinc-900' : ''}>
                            {item.technicianName ?? '—'}
                          </span>
                        </span>
                        <span className="min-w-0 truncate">
                          Agregát:{' '}
                          <span className={item.generatorName ? 'font-semibold text-zinc-900' : ''}>
                            {item.generatorName ?? '—'}
                          </span>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {activeAction === 'client' ? (
        <CreateClientModal
          onClose={() => setActiveAction(null)}
          onToast={(nextToast) => {
            if (nextToast.type === 'error') {
              handleModalError(nextToast.message)
            }
          }}
          onSuccess={handleClientSuccess}
          suppressSuccessToast
        />
      ) : null}

      {activeAction === 'task' ? (
        <CreateTaskModal
          users={users}
          clients={clients}
          contacts={contacts}
          onClose={() => setActiveAction(null)}
          onToast={(nextToast) => {
            if (nextToast.type === 'error') {
              handleModalError(nextToast.message)
            }
          }}
          onSuccess={handleTaskSuccess}
          suppressSuccessToast
        />
      ) : null}

      {activeAction === 'meeting' ? (
        <CreateMeetingModal
          clients={clients}
          contacts={contacts}
          onClose={() => setActiveAction(null)}
          onToast={(nextToast) => {
            if (nextToast.type === 'error') {
              handleModalError(nextToast.message)
            }
          }}
          onSuccess={handleMeetingSuccess}
          suppressSuccessToast
        />
      ) : null}

      {activeAction === 'job' ? (
        <CreateJobModal
          clientSuggestions={clients}
          clientContacts={contacts}
          offerSuggestions={offers}
          technicianSuggestions={technicianSuggestions}
          onClose={() => setActiveAction(null)}
          onSuccess={handleJobSuccess}
        />
      ) : null}

      {activeAction === 'offer' ? (
        <NewOfferModal
          clients={clients}
          contacts={contacts}
          onClose={() => setActiveAction(null)}
        />
      ) : null}

      {isQuickNotesMounted && isQuickNotesVisible ? (
        <>
          <QuickNotesModal
            isDesktopViewport={isDesktopViewport}
            viewportBottomOffset={viewportBottomOffset}
            isOpen={isQuickNotesOpen}
            text={quickNotesText}
            isSaving={isQuickNotesSaving}
            lastSavedAtLabel={formatLastSavedLabel(quickNotesLastSavedAt)}
            onChangeText={(value) => {
              setQuickNotesText(value)
              setQuickNotesSaveError(null)
            }}
            onRequestClose={() => {
              void persistQuickNotesAndClose()
            }}
            onClearRequest={() => {
              setIsQuickNotesClearConfirmOpen(true)
            }}
          />

          {quickNotesSaveError ? (
            <div className="dashboard-quick-notes-save-error fixed bottom-[calc(env(safe-area-inset-bottom,0px)+18px)] left-1/2 z-[90] w-[min(92vw,420px)] -translate-x-1/2 rounded-2xl border border-red-300/85 bg-[linear-gradient(135deg,rgba(127,29,29,0.96)_0%,rgba(153,27,27,0.94)_100%)] px-3 py-2 text-sm font-medium text-white shadow-[0_14px_28px_rgba(127,29,29,0.34)]">
              {quickNotesSaveError}
            </div>
          ) : null}

          {isQuickNotesClearConfirmOpen ? (
            <div className="fixed inset-0 z-[95]">
              <button
                type="button"
                aria-label="Zavřít potvrzení mazání poznámky"
                onClick={() => setIsQuickNotesClearConfirmOpen(false)}
                className="dashboard-quick-notes-clear-confirm__overlay absolute inset-0 bg-zinc-950/38 backdrop-blur-[3.5px]"
              />

              <div className="absolute inset-0 flex items-center justify-center p-4">
                <div className="dashboard-quick-notes-clear-confirm__panel relative w-full max-w-sm overflow-hidden rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(244,248,252,0.82)_45%,rgba(236,243,249,0.74)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_30px_72px_rgba(24,24,27,0.28)] lg:shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_36px_84px_rgba(24,24,27,0.32)]">
                  <div aria-hidden className="dashboard-quick-notes-clear-confirm__frame pointer-events-none absolute inset-0 rounded-[28px] border border-white/65" />
                  <div aria-hidden className="dashboard-quick-notes-clear-confirm__top-line pointer-events-none absolute inset-x-7 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-100" />
                  <div aria-hidden className="dashboard-quick-notes-clear-confirm__glow pointer-events-none absolute inset-x-10 top-1 h-10 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.70),transparent_70%)]" />

                  <p className="dashboard-quick-notes-clear-confirm__text relative text-sm font-medium leading-6 text-gray-900">
                    Opravdu chceš nevratně smazat veškerý text?
                  </p>

                  <div className="relative mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void clearQuickNotes()
                      }}
                      className="dashboard-quick-notes-clear-confirm__accept inline-flex h-9 items-center justify-center rounded-xl border border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] px-3 text-xs font-semibold uppercase tracking-[0.05em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(16,185,129,0.24)] transition duration-200 hover:-translate-y-[1px]"
                    >
                      Ano
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsQuickNotesClearConfirmOpen(false)}
                      className="dashboard-quick-notes-clear-confirm__cancel inline-flex h-9 items-center justify-center rounded-xl border border-red-500/85 bg-[linear-gradient(155deg,#ef4444_0%,#dc2626_100%)] px-3 text-xs font-semibold uppercase tracking-[0.05em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22),0_10px_20px_rgba(220,38,38,0.24)] transition duration-200 hover:-translate-y-[1px]"
                    >
                      Zrušit
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}

      {isAdmin && isDesktopViewport && isPresenceModalOpen ? (
        <div className="online-log-modal fixed inset-0 z-[100] hidden lg:block">
          <button
            type="button"
            aria-label="Zavřít sledovač online stavu"
            className="online-log-modal__overlay absolute inset-0 bg-zinc-950/38 backdrop-blur-[3.5px]"
            onClick={() => setIsPresenceModalOpen(false)}
          />

          <div className="absolute inset-0 overflow-y-auto p-4">
            <div className="online-log-modal__shell mx-auto mt-12 w-full max-w-6xl rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_30px_72px_rgba(24,24,27,0.28)] lg:p-6">
              <div className="online-log-modal__header mb-4 flex items-start justify-between gap-4 border-b border-white/70 pb-4">
                <div>
                  <h2 className="online-log-modal__title text-xl font-semibold tracking-tight text-gray-900">
                    ONLINE LOG
                  </h2>
                  <p className="online-log-modal__subtitle mt-1 text-sm text-gray-500">
                    Online teď: {onlineCount} • Aktivní v období: {presenceUsers.length}
                  </p>
                  <div className="online-log-modal__periods mt-2 inline-flex items-center gap-1 rounded-xl border border-white/75 bg-white/65 p-1">
                    <button
                      type="button"
                      onClick={() => setPresencePeriod('today')}
                      data-active={presencePeriod === 'today'}
                      className={`online-log-modal__period-btn rounded-lg px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.06em] transition ${
                        presencePeriod === 'today'
                          ? 'bg-[#2f77af] text-white'
                          : 'text-zinc-600 hover:bg-white/70'
                      }`}
                    >
                      Dnes
                    </button>
                    <button
                      type="button"
                      onClick={() => setPresencePeriod('7d')}
                      data-active={presencePeriod === '7d'}
                      className={`online-log-modal__period-btn rounded-lg px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.06em] transition ${
                        presencePeriod === '7d'
                          ? 'bg-[#2f77af] text-white'
                          : 'text-zinc-600 hover:bg-white/70'
                      }`}
                    >
                      7 dní
                    </button>
                    <button
                      type="button"
                      onClick={() => setPresencePeriod('30d')}
                      data-active={presencePeriod === '30d'}
                      className={`online-log-modal__period-btn rounded-lg px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.06em] transition ${
                        presencePeriod === '30d'
                          ? 'bg-[#2f77af] text-white'
                          : 'text-zinc-600 hover:bg-white/70'
                      }`}
                    >
                      30 dní
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsPresenceModalOpen(false)}
                  className="online-log-modal__close inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px]"
                  aria-label="Zavřít"
                >
                  ✕
                </button>
              </div>

              <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                <section className="online-log-modal__list-panel rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  <div className="online-log-modal__section-label mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Uživatelé v období
                  </div>

                  <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
                    {presenceUsers.length === 0 ? (
                        <div className="online-log-modal__empty rounded-xl border border-white/75 bg-white/60 px-3 py-4 text-sm text-zinc-500">
                        V tomto období nebyl nikdo další aktivní.
                      </div>
                    ) : (
                      presenceUsers.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelectedPresenceUserId(item.id)}
                          data-selected={selectedPresenceUserId === item.id}
                          className={`online-log-modal__person-row w-full rounded-xl border px-3 py-2.5 text-left transition ${
                            selectedPresenceUserId === item.id
                              ? 'border-[#7cb3d8] bg-[linear-gradient(155deg,rgba(229,244,252,0.95)_0%,rgba(210,234,247,0.88)_100%)]'
                              : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] hover:-translate-y-[1px]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="online-log-modal__person-name truncate text-sm font-semibold text-zinc-900">
                              {item.name}
                            </div>
                            <span
                              className={`online-log-modal__status inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold uppercase ${
                                item.isOnline ? 'bg-emerald-500 text-white' : 'bg-zinc-200 text-zinc-700'
                              }`}
                            >
                              {item.isOnline ? 'ONLINE' : 'OFFLINE'}
                            </span>
                          </div>
                          <div className="online-log-modal__person-meta mt-1 text-[12px] text-zinc-600">
                            Naposledy online: {formatActivityTime(item.lastSeenAt)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </section>

                <section className="online-log-modal__detail-panel rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  {selectedPresenceUser ? (
                    <>
                      <div className="online-log-modal__detail-card rounded-xl border border-white/75 bg-white/70 p-3">
                        <div className="online-log-modal__detail-name text-sm font-semibold text-zinc-900">
                          {selectedPresenceUser.name}
                        </div>
                        <div className="online-log-modal__detail-meta mt-1 text-[12px] text-zinc-600">
                          Sekce: {selectedPresenceUser.lastSection ?? '—'} • Route: {formatOnlineRoute(selectedPresenceUser.lastRoute)}
                        </div>
                        <div className="online-log-modal__detail-meta mt-1 text-[12px] text-zinc-600">
                          Poslední akce: {formatOnlineActionText(selectedPresenceUser.lastAction)} ({formatActivityTime(selectedPresenceUser.lastActionAt)})
                        </div>
                      </div>

                      <div className="online-log-modal__activity-label mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        Historie aktivit
                      </div>

                      <div className="mt-2 max-h-[48vh] space-y-2 overflow-y-auto pr-1">
                        {isActivityLoading ? (
                          <div className="online-log-modal__empty rounded-xl border border-white/75 bg-white/60 px-3 py-4 text-sm text-zinc-500">
                            Načítám historii…
                          </div>
                        ) : activityItems.length === 0 ? (
                          <div className="online-log-modal__empty rounded-xl border border-white/75 bg-white/60 px-3 py-4 text-sm text-zinc-500">
                            Zatím bez záznamu aktivit.
                          </div>
                        ) : (
                          activityItems.map((item) => (
                            <div
                              key={item.id}
                              className="online-log-modal__activity-item rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-3 py-2.5"
                            >
                              <div className="online-log-modal__activity-title text-sm font-medium text-zinc-900">
                                {formatOnlineActionText(item.action) || 'Bez popisu akce'}
                              </div>
                              <div className="online-log-modal__activity-meta mt-1 text-[12px] text-zinc-600">
                                {formatActivityTime(item.created_at)} • {item.section ?? '—'} • {formatOnlineRoute(item.route)}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="online-log-modal__empty rounded-xl border border-white/75 bg-white/60 px-3 py-4 text-sm text-zinc-500">
                      Vyber uživatele vlevo pro detail.
                    </div>
                  )}
                </section>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {isAdmin && activeAction === 'received_invoices' ? (
        <ReceivedInvoicesModal
          isOpen
          onClose={() => setActiveAction(null)}
        />
      ) : null}

      {isAdmin && isDesktopViewport && activeAction === 'manual_notifications' ? (
        <ManualNotificationModal
          users={users}
          historyItems={manualHistory}
          historyLoading={isManualHistoryLoading}
          onClose={() => setActiveAction(null)}
          onSent={async (sentCount) => {
            handleManualNotificationSent(sentCount)
            await refreshManualHistory()
          }}
          onResent={async (sentCount) => {
            handleManualNotificationSent(sentCount)
            await refreshManualHistory()
          }}
        />
      ) : null}
    </>
  )

  if (!isHydrated || typeof document === 'undefined') return null
  return createPortal(floatingLayer, document.body)
}
