'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

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

  const [visible, setVisible] = useState(false)
  const hideTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    function showOverlay() {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = null
      }

      setVisible(true)
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

    return () => {
      document.removeEventListener('click', handleDocumentClick, true)
    }
  }, [])

  useEffect(() => {
    if (!visible) return

    hideTimeoutRef.current = window.setTimeout(() => {
      setVisible(false)
      hideTimeoutRef.current = null
    }, 250)

    return () => {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = null
      }
    }
  }, [pathname, searchParams, visible])

  return (
    <div
      aria-hidden="true"
      className={[
        'fixed inset-0 z-[999] transition-all duration-200',
        visible
          ? 'pointer-events-auto opacity-100'
          : 'pointer-events-none opacity-0',
      ].join(' ')}
    >
      <div className="absolute inset-0 bg-white/12 backdrop-blur-[3px]" />

      <div className="relative flex min-h-full items-center justify-center">
        <div className="flex items-center gap-3 rounded-full px-5 py-4">
          <LoadingDot delay="0ms" />
          <LoadingDot delay="160ms" />
          <LoadingDot delay="320ms" />
        </div>
      </div>
    </div>
  )
}

function LoadingDot({ delay }: { delay: string }) {
  return (
    <span
      className="h-4 w-4 rounded-full bg-[#2980B9]"
      style={{
        animationName: 'navigation-overlay-pulse',
        animationDuration: '1s',
        animationTimingFunction: 'ease-in-out',
        animationIterationCount: 'infinite',
        animationDelay: delay,
      }}
    />
  )
}
