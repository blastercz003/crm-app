'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { THEME_PREFERENCES_CHANGED_EVENT } from '@/lib/theme/theme-preference'

export type ActionFeedbackToastValue = {
  title: string
  message: string
  tone: 'success' | 'error'
}

type ThemeAppearanceMode = 'light' | 'dark'

function getCurrentThemeAppearanceMode(): ThemeAppearanceMode {
  if (typeof document === 'undefined') return 'light'

  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
}

const TOAST_HIDE_DELAY_MS = 4100
const TOAST_UNMOUNT_DELAY_MS = 460

function ActionFeedbackToastCard({
  toast,
  isVisible,
  themeAppearanceMode,
}: {
  toast: ActionFeedbackToastValue
  isVisible: boolean
  themeAppearanceMode: ThemeAppearanceMode
}) {
  const isSuccess = toast.tone === 'success'
  const isDarkTheme = themeAppearanceMode === 'dark'

  const successCardClassName = isDarkTheme
    ? 'border-[rgba(121,176,218,0.16)] bg-[#4f92cb] text-[#f8fbff]'
    : 'border-transparent bg-[linear-gradient(155deg,rgba(77,144,197,0.94)_0%,rgba(47,119,175,0.9)_58%,rgba(35,102,155,0.86)_100%)] text-white'

  const successVisibleShadowClassName = isDarkTheme
    ? 'scale-100 shadow-[inset_0_1px_0_rgba(197,226,247,0.22),0_22px_46px_rgba(8,20,37,0.56),0_0_36px_rgba(79,146,203,0.18)]'
    : 'scale-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_22px_46px_rgba(24,78,129,0.34)]'

  const successHiddenShadowClassName = isDarkTheme
    ? 'scale-[0.96] shadow-[inset_0_1px_0_rgba(197,226,247,0.14),0_10px_24px_rgba(8,20,37,0.28),0_0_22px_rgba(79,146,203,0.12)]'
    : 'scale-[0.96] shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_24px_rgba(24,78,129,0.18)]'

  const successTopLineClassName = isDarkTheme ? 'via-[#c6e4fb]/72' : 'via-white/70'
  const successDotClassName = isDarkTheme ? 'bg-[#edf8ff]' : 'bg-white'
  const successTitleClassName = isDarkTheme ? 'font-extrabold text-[#f8fbff]' : 'font-extrabold text-white'
  const successMessageClassName = isDarkTheme ? 'font-semibold text-[#f8fbff]' : 'font-semibold text-white'

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border px-4 py-3.5 backdrop-blur-[12px] transition duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
        isSuccess ? successCardClassName : 'border-transparent bg-[linear-gradient(155deg,rgba(230,57,70,0.95)_0%,rgba(220,38,38,0.91)_58%,rgba(185,28,28,0.88)_100%)] text-white'
      } ${
        isVisible
          ? isSuccess
            ? successVisibleShadowClassName
            : 'scale-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_22px_46px_rgba(153,27,27,0.34)]'
          : isSuccess
            ? successHiddenShadowClassName
            : 'scale-[0.96] shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_10px_24px_rgba(153,27,27,0.18)]'
      }`}
    >
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-3 top-0 h-px bg-gradient-to-r from-transparent ${
          isSuccess ? successTopLineClassName : 'via-white/72'
        } to-transparent`}
      />
      <div
        className={`flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] transition duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isSuccess ? successTitleClassName : 'font-extrabold text-white'
        } ${
          isVisible ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
        }`}
        style={{ transitionDelay: isVisible ? '120ms' : '0ms' }}
      >
        <span
          className={`h-2 w-2 rounded-full ${
            isSuccess ? successDotClassName : 'bg-white'
          }`}
        />
        {toast.title}
      </div>

      <p
        className={`mt-1.5 text-[14px] leading-5 transition duration-[460ms] ease-[cubic-bezier(0.16,1,0.3,1)] ${
          isSuccess ? successMessageClassName : 'font-semibold text-white'
        } ${
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
  const [isMounted, setIsMounted] = useState(false)
  const [themeAppearanceMode, setThemeAppearanceMode] = useState<ThemeAppearanceMode>(() =>
    getCurrentThemeAppearanceMode()
  )

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      setIsMounted(true)
    })

    return () => {
      window.cancelAnimationFrame(frameId)
      setIsMounted(false)
    }
  }, [])

  useEffect(() => {
    if (!isMounted) return

    const syncThemeAppearanceMode = () => {
      setThemeAppearanceMode(getCurrentThemeAppearanceMode())
    }

    syncThemeAppearanceMode()

    const observer = new MutationObserver(syncThemeAppearanceMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    window.addEventListener(THEME_PREFERENCES_CHANGED_EVENT, syncThemeAppearanceMode)

    return () => {
      observer.disconnect()
      window.removeEventListener(THEME_PREFERENCES_CHANGED_EVENT, syncThemeAppearanceMode)
    }
  }, [isMounted])

  if (!isMounted) return null

  return createPortal(
    <>
      <div
        className={`fixed left-1/2 z-[220] -translate-x-1/2 transition duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] lg:hidden ${
          isVisible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
        }`}
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 10px)' }}
        role="status"
        aria-live="polite"
      >
        <div className="w-[min(420px,calc(100vw-1rem))]">
          <ActionFeedbackToastCard
            toast={toast}
            isVisible={isVisible}
            themeAppearanceMode={themeAppearanceMode}
          />
        </div>
      </div>

      <div
        className={`fixed right-6 top-5 z-[220] hidden transition duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] lg:block ${
          isVisible ? 'translate-y-0 opacity-100' : '-translate-y-2 opacity-0'
        }`}
        role="status"
        aria-live="polite"
      >
        <div className="w-[390px]">
          <ActionFeedbackToastCard
            toast={toast}
            isVisible={isVisible}
            themeAppearanceMode={themeAppearanceMode}
          />
        </div>
      </div>
    </>,
    document.body
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
