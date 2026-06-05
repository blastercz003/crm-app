'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

export const NAVIGATION_OVERLAY_START_EVENT = 'navigation-overlay:start'

function isModifiedEvent(event: MouseEvent) {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
}

function shouldHandleAnchor(anchor: HTMLAnchorElement, currentUrl: URL) {
  if (anchor.target && anchor.target !== '_self') return false
  if (anchor.hasAttribute('download')) return false

  const rawHref = anchor.getAttribute('href')
  if (!rawHref || rawHref.startsWith('#')) return false

  let targetUrl: URL

  try {
    targetUrl = new URL(anchor.href, window.location.href)
  } catch {
    return false
  }

  if (targetUrl.origin !== currentUrl.origin) return false

  const isSameRoute =
    targetUrl.pathname === currentUrl.pathname &&
    targetUrl.search === currentUrl.search

  if (isSameRoute) return false

  return true
}

export function NavigationOverlay() {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const routeKey = `${pathname}?${searchParams.toString()}`

  const [visible, setVisible] = useState(false)
  const [isNavigating, setIsNavigating] = useState(false)

  const previousRouteKeyRef = useRef(routeKey)
  const hideTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    function showOverlay() {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = null
      }

      setVisible(true)
      setIsNavigating(true)
    }

    function handleDocumentClick(event: MouseEvent) {
      if (event.defaultPrevented) return
      if (isModifiedEvent(event)) return
      if (event.button !== 0) return

      const target = event.target
      if (!(target instanceof Element)) return

      const anchor = target.closest('a')
      if (!(anchor instanceof HTMLAnchorElement)) return

      const currentUrl = new URL(window.location.href)

      if (!shouldHandleAnchor(anchor, currentUrl)) return

      showOverlay()
    }

    document.addEventListener('click', handleDocumentClick, true)
    window.addEventListener(NAVIGATION_OVERLAY_START_EVENT, showOverlay)

    return () => {
      document.removeEventListener('click', handleDocumentClick, true)
      window.removeEventListener(NAVIGATION_OVERLAY_START_EVENT, showOverlay)
    }
  }, [])

  useEffect(() => {
    const previousRouteKey = previousRouteKeyRef.current
    const routeChanged = routeKey !== previousRouteKey

    if (routeChanged && isNavigating) {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
      }

      hideTimeoutRef.current = window.setTimeout(() => {
        setVisible(false)
        setIsNavigating(false)
        hideTimeoutRef.current = null
      }, 180)
    }

    previousRouteKeyRef.current = routeKey

    return () => {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = null
      }
    }
  }, [routeKey, isNavigating])

  return (
      <div
        aria-hidden="true"
        className={[
          'navigation-overlay__backdrop',
          'fixed inset-0 z-[999] transition-opacity duration-200',
          visible
            ? 'pointer-events-auto opacity-100'
            : 'pointer-events-none opacity-0',
        ].join(' ')}
      >
        <div className="absolute inset-0 bg-white/18 backdrop-blur-[6px]" />

        <div className="relative flex min-h-full items-center justify-center">
          <div
            className={[
              'navigation-overlay__dots',
              'flex items-center gap-3 rounded-full px-6 py-5 transition-all duration-200',
              visible ? 'scale-100 opacity-100' : 'scale-95 opacity-0',
            ].join(' ')}
          >
          <LoadingDot delay="0ms" />
          <LoadingDot delay="140ms" />
          <LoadingDot delay="280ms" />
        </div>
      </div>
    </div>
  )
}

function LoadingDot({ delay }: { delay: string }) {
  return (
    <span
      className="navigation-overlay__dot h-4 w-4 rounded-full bg-[#2980B9] shadow-[0_0_18px_rgba(41,128,185,0.35)] opacity-25"
      style={{
        animation: 'navigation-loading-dot-pulse 1.1s ease-in-out infinite',
        animationDelay: delay,
      }}
    />
  )
}
