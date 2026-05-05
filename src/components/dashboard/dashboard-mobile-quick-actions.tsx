'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CreateClientModal } from '@/app/clients/new-client-button'
import { CreateMeetingModal } from '@/app/meetings/new-meeting-button'
import { CreateJobModal } from '@/app/jobs/new-job-button'
import { NewOfferModal } from '@/app/offers/new-offer-button'
import { CreateTaskModal } from '@/app/tasks/new-task-button'
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

type QuickActionKey = 'meeting' | 'task' | 'offer' | 'job' | 'client'

type QuickToast = {
  title: string
  message: string
  tone: 'success' | 'error'
}

type DashboardMobileQuickActionsProps = {
  users: UserOption[]
  clients: ClientOption[]
  contacts: ClientContactOption[]
  canViewOffers: boolean
  canCreateJobs: boolean
}

function triggerHaptic(pattern: number | number[]) {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return
  }

  navigator.vibrate(pattern)
}

function formatMeetingDateTime(value: string | undefined) {
  if (!value) return 'bez uvedeného termínu'

  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: 'Europe/Prague',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function ActionToast({
  toast,
  isVisible,
}: {
  toast: QuickToast
  isVisible: boolean
}) {
  const isSuccess = toast.tone === 'success'

  return (
    <div
      className={`fixed right-4 z-[75] lg:hidden transition duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
        isVisible ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
      }`}
      style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}
    >
      <div
        className={`relative w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-[28px] border px-5 py-4 transition duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isSuccess
            ? 'border-white/18 bg-[#2980B9] text-white'
            : 'border-red-300/60 bg-[#C0392B] text-white'
        } ${
          isVisible
            ? 'scale-100 shadow-[0_34px_88px_rgba(20,49,72,0.34)]'
            : 'scale-[0.9] shadow-[0_14px_34px_rgba(20,49,72,0.16)]'
        }`}
        role="status"
        aria-live="polite"
      >
        <div
          className={`flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.18em] text-white transition duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isVisible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
          }`}
          style={{ transitionDelay: isVisible ? '120ms' : '0ms' }}
        >
          <span className="h-2.5 w-2.5 rounded-full bg-white" />
          {toast.title}
        </div>
        <p
          className={`mt-2 text-[15px] leading-6 text-white/92 transition duration-[460ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          }`}
          style={{ transitionDelay: isVisible ? '185ms' : '0ms' }}
        >
          {toast.message}
        </p>
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
}: DashboardMobileQuickActionsProps) {
  const router = useRouter()
  const [activeAction, setActiveAction] = useState<QuickActionKey | null>(null)
  const [isSheetMounted, setIsSheetMounted] = useState(false)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [toast, setToast] = useState<QuickToast | null>(null)
  const [isToastVisible, setIsToastVisible] = useState(false)
  const [, startTransition] = useTransition()
  const closeTimerRef = useRef<number | null>(null)
  const toastHideTimerRef = useRef<number | null>(null)
  const toastUnmountTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!toast) return

    if (toastHideTimerRef.current) {
      window.clearTimeout(toastHideTimerRef.current)
      toastHideTimerRef.current = null
    }

    if (toastUnmountTimerRef.current) {
      window.clearTimeout(toastUnmountTimerRef.current)
      toastUnmountTimerRef.current = null
    }

    requestAnimationFrame(() => {
      setIsToastVisible(true)
    })

    toastHideTimerRef.current = window.setTimeout(() => {
      setIsToastVisible(false)
      toastUnmountTimerRef.current = window.setTimeout(() => {
        setToast(null)
        toastUnmountTimerRef.current = null
      }, 460)
    }, 4100)

    return () => {
      if (toastHideTimerRef.current) {
        window.clearTimeout(toastHideTimerRef.current)
        toastHideTimerRef.current = null
      }

      if (toastUnmountTimerRef.current) {
        window.clearTimeout(toastUnmountTimerRef.current)
        toastUnmountTimerRef.current = null
      }
    }
  }, [toast])

  useEffect(() => {
    if (!isSheetMounted) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [isSheetMounted])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current)
      }

      if (toastHideTimerRef.current) {
        window.clearTimeout(toastHideTimerRef.current)
      }

      if (toastUnmountTimerRef.current) {
        window.clearTimeout(toastUnmountTimerRef.current)
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

  function handleActionSuccess(toastValue: QuickToast) {
    triggerHaptic([12, 20, 12])
    setIsToastVisible(false)
    setToast(toastValue)
    startTransition(() => {
      router.refresh()
    })
  }

  function handleClientSuccess(state: CreateClientActionState) {
    handleActionSuccess({
      title: 'KLIENT ULOŽEN',
      message: `Klient „${state.clientName ?? 'Nový klient'}“ byl úspěšně vytvořen.`,
      tone: 'success',
    })
  }

  function handleTaskSuccess(state: CreateTaskActionState) {
    handleActionSuccess({
      title: 'ÚKOL ULOŽEN',
      message: `Úkol „${state.taskTitle ?? 'Nový úkol'}“ byl úspěšně vytvořen.`,
      tone: 'success',
    })
  }

  function handleMeetingSuccess(state: CreateMeetingActionState) {
    handleActionSuccess({
      title: 'SCHŮZKA ULOŽENA',
      message: `Schůzka v „${state.companyName ?? 'Nová firma'}“ na ${formatMeetingDateTime(
        state.meetingDateTime
      )} byla vytvořena.`,
      tone: 'success',
    })
  }

  function handleJobSuccess(state: CreateJobActionState) {
    handleActionSuccess({
      title: 'ZAKÁZKA ULOŽENA',
      message: `Zakázka ${state.jobNumber ?? 'bez čísla'} pro „${
        state.companyName ?? 'Nová firma'
      }“ byla vytvořena.`,
      tone: 'success',
    })
  }

  function handleModalError(message: string) {
    triggerHaptic(24)
    setToast({
      title: 'CHYBA',
      message,
      tone: 'error',
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

  return (
    <>
      {toast ? <ActionToast toast={toast} isVisible={isToastVisible} /> : null}

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
        className={`primary-ambient-glow--blue fixed z-[70] flex items-center justify-center border border-white/20 bg-[#2980B9] text-white transition duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] active:scale-[0.95] lg:hidden ${
          activeAction
            ? 'pointer-events-none opacity-0 scale-[0.92]'
            : isSheetMounted
            ? 'translate-y-[-3px] scale-[0.985] shadow-[0_26px_60px_rgba(20,49,72,0.42)]'
            : 'translate-y-0 shadow-[0_14px_34px_rgba(20,49,72,0.28)]'
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
          className={`text-[30px] font-medium leading-none transition duration-[220ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
            isSheetMounted ? 'rotate-45' : 'rotate-0'
          }`}
        >
          +
        </span>
      </button>

      {isSheetMounted ? (
        <div
          className="fixed inset-0 z-[65] lg:hidden"
          aria-hidden="true"
        >
          <button
            type="button"
            aria-label="Zavřít rychlé vytvoření"
            onClick={closeSheet}
            className={`absolute inset-0 bg-zinc-950/30 transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
              isSheetOpen ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              backdropFilter: isSheetOpen ? 'blur(3px)' : 'blur(0px)',
            }}
          />

          <div
            className={`absolute right-4 w-[min(290px,calc(100vw-2rem))] overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white/97 p-3 transition duration-[280ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
              isSheetOpen
                ? 'translate-x-0 translate-y-0 scale-100 opacity-100 shadow-[0_46px_112px_rgba(15,23,42,0.24)]'
                : 'translate-x-4 translate-y-5 scale-[0.72] opacity-0 shadow-[0_12px_28px_rgba(15,23,42,0.08)]'
            }`}
            style={{
              bottom: 'calc(env(safe-area-inset-bottom, 0px) + 86px)',
              transformOrigin: 'bottom right',
              transitionDelay: isSheetOpen ? '34ms' : '0ms',
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.985) 0%, rgba(251,253,255,0.97) 100%)',
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

            <div className="mt-1 grid gap-2">
              {actions.map((action, index) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={() => handleActionSelect(action.key)}
                  className={`flex min-h-[52px] items-center justify-between rounded-[22px] border border-zinc-200 bg-[#F4F7FA] px-4 py-3 text-left text-[15px] font-semibold uppercase tracking-[0.03em] text-zinc-900 transition duration-[240ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:border-zinc-300 hover:bg-[#EEF3F7] ${
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
    </>
  )
}
