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
      className={`relative overflow-hidden rounded-[28px] border px-5 py-4 transition duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
        isSuccess
          ? 'border-white/18 bg-[#2980B9] text-white'
          : 'border-red-300/60 bg-[#C0392B] text-white'
      } ${
        isVisible
          ? 'scale-100 shadow-[0_34px_88px_rgba(20,49,72,0.34)]'
          : 'scale-[0.9] shadow-[0_14px_34px_rgba(20,49,72,0.16)]'
      }`}
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
        className={`fixed right-4 z-[75] transition duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] lg:hidden ${
          isVisible ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
        }`}
        style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 96px)' }}
        role="status"
        aria-live="polite"
      >
        <div className="w-[min(320px,calc(100vw-2rem))]">
          <ActionFeedbackToastCard toast={toast} isVisible={isVisible} />
        </div>
      </div>

      <div
        className={`fixed right-6 top-6 z-[75] hidden transition duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] lg:block ${
          isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
        }`}
        role="status"
        aria-live="polite"
      >
        <div className="w-[360px]">
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
