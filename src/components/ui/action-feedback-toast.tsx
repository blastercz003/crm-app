'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type ActionFeedbackToastValue = {
  title: string
  message: string
  tone: 'success' | 'error'
}

const TOAST_HIDE_DELAY_MS = 4100
const TOAST_UNMOUNT_DELAY_MS = 460

function ActionFeedbackToastCard({
  toast,
  isVisible,
}: {
  toast: ActionFeedbackToastValue
  isVisible: boolean
}) {
  const isSuccess = toast.tone === 'success'

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border px-4 py-3.5 backdrop-blur-[12px] transition duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
        isSuccess
          ? 'border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(237,247,255,0.9)_56%,rgba(229,242,252,0.86)_100%)] text-zinc-900'
          : 'border-white/80 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(254,242,242,0.9)_56%,rgba(254,226,226,0.84)_100%)] text-zinc-900'
      } ${
        isVisible
          ? 'scale-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_20px_44px_rgba(15,23,42,0.18)]'
          : 'scale-[0.96] shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_24px_rgba(15,23,42,0.10)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute left-0 top-0 h-full w-1.5 ${
          isSuccess ? 'bg-[#2f80b9]' : 'bg-[#c0392b]'
        }`}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent via-white/90 to-transparent"
      />
      <div
        className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] transition duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isSuccess ? 'text-[#2a6f9f]' : 'text-[#a8352a]'
        } ${
          isVisible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
        }`}
        style={{ transitionDelay: isVisible ? '120ms' : '0ms' }}
      >
        <span
          className={`h-2 w-2 rounded-full ${
            isSuccess ? 'bg-[#2f80b9]' : 'bg-[#c0392b]'
          }`}
        />
        {toast.title}
      </div>

      <p
        className={`mt-1.5 text-[14px] leading-5 text-zinc-800 transition duration-[460ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
        }`}
        style={{ transitionDelay: isVisible ? '185ms' : '0ms' }}
      >
        {toast.message}
      </p>
    </div>
  )
}

export function ActionFeedbackToast({
  toast,
  isVisible,
}: {
  toast: ActionFeedbackToastValue
  isVisible: boolean
}) {
  return (
    <>
      <div
        className={`fixed left-1/2 z-[90] -translate-x-1/2 transition duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] lg:hidden ${
          isVisible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
        }`}
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
        role="status"
        aria-live="polite"
      >
        <div className="w-[min(420px,calc(100vw-1rem))]">
          <ActionFeedbackToastCard toast={toast} isVisible={isVisible} />
        </div>
      </div>

      <div
        className={`fixed right-6 top-5 z-[90] hidden transition duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] lg:block ${
          isVisible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
        }`}
        role="status"
        aria-live="polite"
      >
        <div className="w-[390px]">
          <ActionFeedbackToastCard toast={toast} isVisible={isVisible} />
        </div>
      </div>
    </>
  )
}

export function useAnimatedActionToast() {
  const [toast, setToast] = useState<ActionFeedbackToastValue | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const hideTimerRef = useRef<number | null>(null)
  const unmountTimerRef = useRef<number | null>(null)

  const showToast = useCallback((nextToast: ActionFeedbackToastValue) => {
    setIsVisible(false)
    setToast(nextToast)
  }, [])

  useEffect(() => {
    if (!toast) return

    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = null
    }

    if (unmountTimerRef.current) {
      window.clearTimeout(unmountTimerRef.current)
      unmountTimerRef.current = null
    }

    requestAnimationFrame(() => {
      setIsVisible(true)
    })

    hideTimerRef.current = window.setTimeout(() => {
      setIsVisible(false)
      unmountTimerRef.current = window.setTimeout(() => {
        setToast(null)
        unmountTimerRef.current = null
      }, TOAST_UNMOUNT_DELAY_MS)
    }, TOAST_HIDE_DELAY_MS)

    return () => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current)
        hideTimerRef.current = null
      }

      if (unmountTimerRef.current) {
        window.clearTimeout(unmountTimerRef.current)
        unmountTimerRef.current = null
      }
    }
  }, [toast])

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current)
      }

      if (unmountTimerRef.current) {
        window.clearTimeout(unmountTimerRef.current)
      }
    }
  }, [])

  return {
    toast,
    isVisible,
    showToast,
  }
}
