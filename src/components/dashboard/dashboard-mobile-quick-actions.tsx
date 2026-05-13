'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CreateClientModal } from '@/app/clients/new-client-button'
import { CreateMeetingModal } from '@/app/meetings/new-meeting-button'
import { CreateJobModal } from '@/app/jobs/new-job-button'
import { NewOfferModal } from '@/app/offers/new-offer-button'
import { CreateTaskModal } from '@/app/tasks/new-task-button'
import { ReceivedInvoicesModal } from '@/components/dashboard/received-invoices-modal'
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
  | 'received_invoices'

type DashboardMobileQuickActionsProps = {
  users: UserOption[]
  clients: ClientOption[]
  contacts: ClientContactOption[]
  canViewOffers: boolean
  canCreateJobs: boolean
  receivedInvoicesDueCount?: number
}

function triggerHaptic(pattern: number | number[]) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return
  }

  navigator.vibrate(pattern)
}

export function DashboardMobileQuickActions({
  users,
  clients,
  contacts,
  canViewOffers,
  canCreateJobs,
  receivedInvoicesDueCount = 0,
}: DashboardMobileQuickActionsProps) {
  const router = useRouter()
  const [activeAction, setActiveAction] = useState<QuickActionKey | null>(null)
  const [isSheetMounted, setIsSheetMounted] = useState(false)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [isDesktopViewport, setIsDesktopViewport] = useState(false)
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

  return (
    <>
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isToastVisible} /> : null}

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
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
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
          bottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
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

      {activeAction === 'received_invoices' ? (
        <ReceivedInvoicesModal
          isOpen
          onClose={() => setActiveAction(null)}
        />
      ) : null}
    </>
  )
}
