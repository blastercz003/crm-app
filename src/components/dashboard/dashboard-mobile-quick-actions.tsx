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
  getManualNotificationHistoryForAdminAction,
  sendManualNotificationForAdminAction,
} from '@/app/dashboard/manual-notifications-actions'
import {
  getPresenceOverviewForAdminAction,
  getUserActivityForAdminAction,
  trackUserPresenceAction,
} from '@/app/dashboard/online-presence-actions'
import { useBodyScrollLock } from '@/components/ui/use-body-scroll-lock'
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

type QuickActionKey =
  | 'meeting'
  | 'task'
  | 'offer'
  | 'job'
  | 'client'
  | 'manual_notifications'
  | 'received_invoices'

type DashboardMobileQuickActionsProps = {
  users: UserOption[]
  clients: ClientOption[]
  contacts: ClientContactOption[]
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
    <div className="fixed inset-0 z-[110] hidden lg:block">
      <button
        type="button"
        aria-label="Zavřít ruční notifikace"
        className="absolute inset-0 bg-zinc-950/38 backdrop-blur-[3.5px]"
        onClick={onClose}
      />

      <div className="absolute inset-0 overflow-y-auto p-4">
        <div className="mx-auto mt-12 w-full max-w-6xl rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_30px_72px_rgba(24,24,27,0.28)] lg:p-6">
          <div className="mb-4 flex items-start justify-between gap-4 border-b border-white/70 pb-4">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-gray-900">Ruční notifikace</h2>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px]"
              aria-label="Zavřít"
            >
              ✕
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <section className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
                    Příjemci
                  </label>
                  <div className="max-h-[230px] space-y-1.5 overflow-y-auto rounded-xl border border-white/75 bg-white/70 p-2">
                    {sortedUsers.map((user) => {
                      const isChecked = selectedUserIds.includes(user.id)
                      return (
                        <label
                          key={user.id}
                          className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-zinc-800 transition hover:bg-white/80"
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-zinc-300 text-[#2f77af] focus:ring-[#2f77af]"
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
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500"
                  >
                    Nadpis (max 120)
                  </label>
                  <input
                    id="manual-notification-title"
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value.slice(0, 120))}
                    maxLength={120}
                    className="h-11 w-full rounded-xl border border-white/75 bg-white/80 px-3 text-sm text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] outline-none ring-[#2f77af]/40 transition focus:ring-2"
                    placeholder="Např. Důležité oznámení"
                  />
                </div>

                <div>
                  <label
                    htmlFor="manual-notification-message"
                    className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500"
                  >
                    Text (volitelné, max 500)
                  </label>
                  <textarea
                    id="manual-notification-message"
                    value={message}
                    onChange={(event) => setMessage(event.target.value.slice(0, 500))}
                    maxLength={500}
                    rows={4}
                    className="w-full resize-none rounded-xl border border-white/75 bg-white/80 px-3 py-2 text-sm text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] outline-none ring-[#2f77af]/40 transition focus:ring-2"
                    placeholder="Volitelný text notifikace…"
                  />
                </div>

                {errorMessage ? (
                  <div className="rounded-xl border border-red-200/85 bg-red-50/80 px-3 py-2 text-sm text-red-700">
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
                    className="inline-flex min-h-11 items-center rounded-xl border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] px-4 text-sm font-semibold text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_24px_rgba(9,48,82,0.38)] transition hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? 'ODESÍLÁM…' : 'ODESLAT NOTIFIKACI'}
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                Historie odeslaných
              </div>

              <div className="max-h-[62vh] space-y-2 overflow-y-auto pr-1">
                {historyLoading ? (
                  <div className="rounded-xl border border-white/75 bg-white/60 px-3 py-4 text-sm text-zinc-500">
                    Načítám historii…
                  </div>
                ) : historyItems.length === 0 ? (
                  <div className="rounded-xl border border-white/75 bg-white/60 px-3 py-4 text-sm text-zinc-500">
                    Zatím bez odeslaných ručních notifikací.
                  </div>
                ) : (
                  historyItems.map((item) => (
                    <div
                      key={item.batchId}
                      className="rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-zinc-900">{item.title}</div>
                          <div className="mt-1 text-[12px] text-zinc-600">
                            {formatManualHistoryTime(item.createdAt)} • Příjemců: {item.recipientCount}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            void resendFromHistory(item)
                          }}
                          disabled={submittingBatchId === item.batchId}
                          className="inline-flex min-h-9 shrink-0 items-center rounded-xl border border-[#2b6f9f]/85 bg-[#2f77af]/10 px-3 text-xs font-semibold uppercase tracking-[0.04em] text-[#1f5f8f] transition hover:bg-[#2f77af]/18 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {submittingBatchId === item.batchId ? 'ODESÍLÁM…' : 'ODESLAT ZNOVU'}
                        </button>
                      </div>

                      {item.message ? (
                        <div className="mt-1.5 text-sm text-zinc-700">{item.message}</div>
                      ) : null}

                      <div className="mt-2 text-[12px] text-zinc-600">
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
  canViewOffers,
  canCreateJobs,
  isAdmin,
  receivedInvoicesDueCount = 0,
}: DashboardMobileQuickActionsProps) {
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
  const [isDesktopViewport, setIsDesktopViewport] = useState(false)
  const [viewportBottomOffset, setViewportBottomOffset] = useState(0)
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
  const [, startTransition] = useTransition()
  const closeTimerRef = useRef<number | null>(null)
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
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  function openSheet() {
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
          className={`fixed z-[70] hidden overflow-hidden border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] text-zinc-900 backdrop-blur-xl transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] lg:block ${
            activeAction
              ? 'pointer-events-none opacity-0 scale-[0.94]'
              : isSheetMounted
              ? 'translate-y-[-2px] scale-[0.99] shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_20px_42px_rgba(15,23,42,0.26)]'
              : 'translate-y-0 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_12px_28px_rgba(15,23,42,0.2)] hover:-translate-y-0.5'
          }`}
          style={{
            right: '256px',
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
            className="pointer-events-none absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-95"
          />

          <div className="flex h-full flex-col justify-center px-[18px]">
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                <span>ONLINE</span>
                <span className="relative inline-flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60 blur-[2px]" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full border border-emerald-200/90 bg-emerald-500 shadow-[0_0_10px_rgba(34,197,94,0.95)]" />
                </span>
              </div>
            </div>

            <div className="mt-1 w-full truncate text-left text-[12px] font-medium leading-4 text-zinc-800">
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
            triggerHaptic(10)
            setActiveAction('received_invoices')
          }}
          className={`fixed z-[70] flex items-center justify-center border border-[#334155]/95 bg-[linear-gradient(160deg,rgba(81,94,112,0.96)_0%,rgba(71,85,105,0.97)_45%,rgba(51,65,85,0.99)_100%)] text-white backdrop-blur-xl transition duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.95] lg:hidden ${
            activeAction
              ? 'pointer-events-none opacity-0 scale-[0.92]'
              : isSheetMounted
              ? 'translate-y-[-3px] scale-[0.985] shadow-[inset_0_1px_0_rgba(214,219,227,0.30),0_24px_50px_rgba(30,41,59,0.46)]'
              : 'translate-y-0 shadow-[inset_0_1px_0_rgba(214,219,227,0.28),0_14px_34px_rgba(30,41,59,0.36)]'
          }`}
          style={{
            right: '84px',
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
            className="h-6 w-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
            <path d="M14 3v5h5" />
            <path d="M8 14h8" />
            <path d="M8 18h6" />
          </svg>
          {receivedInvoicesDueCount > 0 ? (
            <span className="absolute -right-2 -top-2 z-20 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-red-600 px-1.5 text-[11px] font-semibold leading-none text-white">
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
            triggerHaptic(10)
            setActiveAction('manual_notifications')
          }}
          className={`fixed z-[70] hidden items-center justify-center border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] text-white backdrop-blur-xl transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[#1f5f8e] hover:shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_20px_38px_rgba(9,48,82,0.6)] lg:flex ${
            activeAction
              ? 'pointer-events-none opacity-0 scale-[0.94]'
              : isSheetMounted
              ? 'translate-y-[-2px] scale-[0.99] shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_18px_42px_rgba(9,48,82,0.52)]'
              : 'translate-y-0 shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_28px_rgba(9,48,82,0.44)]'
          }`}
          style={{
            right: '180px',
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
            className="h-7 w-7"
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

      <button
        type="button"
        aria-label="Rychlé vytvoření"
        onClick={() => {
          if (isSheetMounted) {
            closeSheet()
            return
          }

          openSheet()
        }}
        className={`fixed z-[70] flex items-center justify-center border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] text-white backdrop-blur-xl transition duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.95] lg:hidden ${
          activeAction
            ? 'pointer-events-none opacity-0 scale-[0.92]'
            : isSheetMounted
            ? 'translate-y-[-3px] scale-[0.985] shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_24px_52px_rgba(9,48,82,0.55)]'
            : 'translate-y-0 shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_14px_34px_rgba(9,48,82,0.44)]'
        }`}
        style={{
          right: '16px',
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
            isSheetMounted ? 'rotate-45' : 'rotate-0'
          }`}
        >
          +
        </span>
      </button>

      {isAdmin ? (
        <button
          type="button"
          aria-label="Přijaté faktury"
          title="Přijaté faktury"
          onClick={() => {
            triggerHaptic(10)
            setActiveAction('received_invoices')
          }}
          className={`fixed z-[70] hidden items-center justify-center border border-[#334155]/95 bg-[linear-gradient(160deg,rgba(81,94,112,0.96)_0%,rgba(71,85,105,0.97)_45%,rgba(51,65,85,0.99)_100%)] text-white backdrop-blur-xl transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[#1e293b] hover:shadow-[inset_0_1px_0_rgba(214,219,227,0.34),0_20px_38px_rgba(30,41,59,0.6)] lg:flex ${
            activeAction
              ? 'pointer-events-none opacity-0 scale-[0.94]'
              : isSheetMounted
              ? 'translate-y-[-2px] scale-[0.99] shadow-[inset_0_1px_0_rgba(214,219,227,0.34),0_20px_42px_rgba(30,41,59,0.5)]'
              : 'translate-y-0 shadow-[inset_0_1px_0_rgba(214,219,227,0.28),0_12px_28px_rgba(30,41,59,0.38)]'
          }`}
          style={{
            right: '104px',
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
            className="h-7 w-7"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
            <path d="M14 3v5h5" />
            <path d="M8 14h8" />
            <path d="M8 18h6" />
          </svg>
          {receivedInvoicesDueCount > 0 ? (
            <span className="absolute -right-2 -top-2 z-20 inline-flex min-h-6 min-w-6 items-center justify-center rounded-full border-2 border-white bg-red-600 px-1.5 text-[11px] font-semibold leading-none text-white">
              {receivedInvoicesDueCount > 99 ? '99+' : receivedInvoicesDueCount}
            </span>
          ) : null}
        </button>
      ) : null}

      <button
        type="button"
        aria-label="Rychlé vytvoření"
        onClick={() => {
          if (isSheetMounted) {
            closeSheet()
            return
          }

          openSheet()
        }}
        className={`fixed z-[70] hidden items-center justify-center border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] text-white backdrop-blur-xl transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[#1f5f8e] hover:shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_20px_38px_rgba(9,48,82,0.6)] lg:flex ${
          activeAction
            ? 'pointer-events-none opacity-0 scale-[0.94]'
            : isSheetMounted
            ? 'translate-y-[-2px] scale-[0.99] shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_18px_42px_rgba(9,48,82,0.52)]'
            : 'translate-y-0 shadow-[inset_0_1px_0_rgba(170,217,247,0.42),0_12px_28px_rgba(9,48,82,0.44)]'
        }`}
        style={{
          right: '28px',
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
            isSheetMounted ? 'rotate-45' : 'rotate-0'
          }`}
        >
          +
        </span>
      </button>

      {isSheetMounted ? (
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
                  ? 'blur(2px)'
                  : 'blur(3px)'
                : 'blur(0px)',
            }}
          />

          <div
            className={`absolute overflow-hidden rounded-[28px] border border-white/75 bg-[linear-gradient(168deg,rgba(255,255,255,0.96)_0%,rgba(247,250,253,0.9)_42%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] transition duration-[280ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
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
              className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-white to-transparent opacity-90"
            />

            <div
              className={`px-2 pb-2 pt-1 transition duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
                isSheetOpen ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0'
              }`}
              style={{ transitionDelay: isSheetOpen ? '86ms' : '0ms' }}
            >
              <div className="text-[13px] font-semibold uppercase tracking-[0.2em] text-[#2980B9]">
                RYCHLÁ AKCE
              </div>
            </div>

            <div className={`mt-1 grid ${isDesktopViewport ? 'gap-2.5' : 'gap-2'}`}>
              {actions.map((action, index) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => handleActionSelect(action.key)}
                  className={`flex items-center justify-between rounded-[22px] border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 text-left font-semibold uppercase tracking-[0.03em] text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.08)] transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)] ${
                    isDesktopViewport ? 'min-h-[56px] py-3.5 text-[15px]' : 'min-h-[52px] py-3 text-[15px]'
                  } ${
                    isSheetOpen ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-3 scale-[0.96] opacity-0'
                  }`}
                  style={{ transitionDelay: isSheetOpen ? `${110 + index * 24}ms` : '0ms' }}
                >
                  <span>{action.label}</span>
                  <span className="text-[24px] font-bold leading-none text-[#2980B9]">+</span>
                </button>
              ))}
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

      {isAdmin && isDesktopViewport && isPresenceModalOpen ? (
        <div className="fixed inset-0 z-[100] hidden lg:block">
          <button
            type="button"
            aria-label="Zavřít sledovač online stavu"
            className="absolute inset-0 bg-zinc-950/38 backdrop-blur-[3.5px]"
            onClick={() => setIsPresenceModalOpen(false)}
          />

          <div className="absolute inset-0 overflow-y-auto p-4">
            <div className="mx-auto mt-12 w-full max-w-6xl rounded-[28px] border border-zinc-200/86 bg-[linear-gradient(168deg,rgba(255,255,255,0.9)_0%,rgba(249,250,251,0.82)_42%,rgba(244,244,245,0.74)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_30px_72px_rgba(24,24,27,0.28)] lg:p-6">
              <div className="mb-4 flex items-start justify-between gap-4 border-b border-white/70 pb-4">
                <div>
                  <h2 className="text-xl font-semibold tracking-tight text-gray-900">ONLINE LOG</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Online teď: {onlineCount} • Aktivní v období: {presenceUsers.length}
                  </p>
                  <div className="mt-2 inline-flex items-center gap-1 rounded-xl border border-white/75 bg-white/65 p-1">
                    <button
                      type="button"
                      onClick={() => setPresencePeriod('today')}
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.06em] transition ${
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
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.06em] transition ${
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
                      className={`rounded-lg px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.06em] transition ${
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
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.86)_100%)] text-sm font-medium text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.94),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px]"
                  aria-label="Zavřít"
                >
                  ✕
                </button>
              </div>

              <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
                <section className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                    Uživatelé v období
                  </div>

                  <div className="max-h-[58vh] space-y-2 overflow-y-auto pr-1">
                    {presenceUsers.length === 0 ? (
                        <div className="rounded-xl border border-white/75 bg-white/60 px-3 py-4 text-sm text-zinc-500">
                        V tomto období nebyl nikdo další aktivní.
                      </div>
                    ) : (
                      presenceUsers.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setSelectedPresenceUserId(item.id)}
                          className={`w-full rounded-xl border px-3 py-2.5 text-left transition ${
                            selectedPresenceUserId === item.id
                              ? 'border-[#7cb3d8] bg-[linear-gradient(155deg,rgba(229,244,252,0.95)_0%,rgba(210,234,247,0.88)_100%)]'
                              : 'border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] hover:-translate-y-[1px]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="truncate text-sm font-semibold text-zinc-900">{item.name}</div>
                            <span
                              className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold uppercase ${
                                item.isOnline ? 'bg-emerald-500 text-white' : 'bg-zinc-200 text-zinc-700'
                              }`}
                            >
                              {item.isOnline ? 'ONLINE' : 'OFFLINE'}
                            </span>
                          </div>
                          <div className="mt-1 text-[12px] text-zinc-600">
                            Naposledy online: {formatActivityTime(item.lastSeenAt)}
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </section>

                <section className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                  {selectedPresenceUser ? (
                    <>
                      <div className="rounded-xl border border-white/75 bg-white/70 p-3">
                        <div className="text-sm font-semibold text-zinc-900">{selectedPresenceUser.name}</div>
                        <div className="mt-1 text-[12px] text-zinc-600">
                          Sekce: {selectedPresenceUser.lastSection ?? '—'} • Route: {selectedPresenceUser.lastRoute ?? '—'}
                        </div>
                        <div className="mt-1 text-[12px] text-zinc-600">
                          Poslední akce: {selectedPresenceUser.lastAction ?? '—'} ({formatActivityTime(selectedPresenceUser.lastActionAt)})
                        </div>
                      </div>

                      <div className="mt-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        Historie aktivit
                      </div>

                      <div className="mt-2 max-h-[48vh] space-y-2 overflow-y-auto pr-1">
                        {isActivityLoading ? (
                          <div className="rounded-xl border border-white/75 bg-white/60 px-3 py-4 text-sm text-zinc-500">
                            Načítám historii…
                          </div>
                        ) : activityItems.length === 0 ? (
                          <div className="rounded-xl border border-white/75 bg-white/60 px-3 py-4 text-sm text-zinc-500">
                            Zatím bez záznamu aktivit.
                          </div>
                        ) : (
                          activityItems.map((item) => (
                            <div
                              key={item.id}
                              className="rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,250,0.84)_100%)] px-3 py-2.5"
                            >
                              <div className="text-sm font-medium text-zinc-900">{item.action ?? 'Bez popisu akce'}</div>
                              <div className="mt-1 text-[12px] text-zinc-600">
                                {formatActivityTime(item.created_at)} • {item.section ?? '—'} • {item.route ?? '—'}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-white/75 bg-white/60 px-3 py-4 text-sm text-zinc-500">
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
