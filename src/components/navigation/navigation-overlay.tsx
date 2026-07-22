'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import styles from './navigation-overlay.module.css'

export const NAVIGATION_OVERLAY_START_EVENT = 'navigation-overlay:start'

const MINIMUM_VISIBLE_MS = 350
const POST_ROUTE_HOLD_MS = 180
const EXIT_TRANSITION_MS = 280
const NAVIGATION_SAFETY_TIMEOUT_MS = 15_000

type OverlayPhase = 'hidden' | 'active' | 'exiting'

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

  const [phase, setPhase] = useState<OverlayPhase>('hidden')

  const previousRouteKeyRef = useRef(routeKey)
  const isNavigatingRef = useRef(false)
  const navigationStartedAtRef = useRef<number | null>(null)
  const hideTimeoutRef = useRef<number | null>(null)
  const exitTimeoutRef = useRef<number | null>(null)
  const safetyTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    function showOverlay() {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = null
      }
      if (exitTimeoutRef.current) {
        window.clearTimeout(exitTimeoutRef.current)
        exitTimeoutRef.current = null
      }
      if (safetyTimeoutRef.current) {
        window.clearTimeout(safetyTimeoutRef.current)
      }

      navigationStartedAtRef.current = Date.now()
      isNavigatingRef.current = true
      setPhase('active')

      safetyTimeoutRef.current = window.setTimeout(() => {
        isNavigatingRef.current = false
        setPhase('hidden')
        navigationStartedAtRef.current = null
        safetyTimeoutRef.current = null
      }, NAVIGATION_SAFETY_TIMEOUT_MS)
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
    window.addEventListener('popstate', showOverlay)

    return () => {
      document.removeEventListener('click', handleDocumentClick, true)
      window.removeEventListener(NAVIGATION_OVERLAY_START_EVENT, showOverlay)
      window.removeEventListener('popstate', showOverlay)
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
      }
      if (exitTimeoutRef.current) {
        window.clearTimeout(exitTimeoutRef.current)
      }
      if (safetyTimeoutRef.current) {
        window.clearTimeout(safetyTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const previousRouteKey = previousRouteKeyRef.current
    const routeChanged = routeKey !== previousRouteKey

    if (routeChanged && isNavigatingRef.current) {
      if (safetyTimeoutRef.current) {
        window.clearTimeout(safetyTimeoutRef.current)
        safetyTimeoutRef.current = null
      }
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
      }

      const elapsed = navigationStartedAtRef.current
        ? Date.now() - navigationStartedAtRef.current
        : MINIMUM_VISIBLE_MS
      const remainingVisibleTime = Math.max(0, MINIMUM_VISIBLE_MS - elapsed)
      const hideDelay = remainingVisibleTime + POST_ROUTE_HOLD_MS

      hideTimeoutRef.current = window.setTimeout(() => {
        isNavigatingRef.current = false
        setPhase('exiting')
        navigationStartedAtRef.current = null
        hideTimeoutRef.current = null

        exitTimeoutRef.current = window.setTimeout(() => {
          setPhase('hidden')
          exitTimeoutRef.current = null
        }, EXIT_TRANSITION_MS)
      }, hideDelay)
    }

    previousRouteKeyRef.current = routeKey

    return () => {
      if (hideTimeoutRef.current) {
        window.clearTimeout(hideTimeoutRef.current)
        hideTimeoutRef.current = null
      }
    }
  }, [routeKey])

  const isRendered = phase !== 'hidden'
  const isActive = phase === 'active'

  return (
    <div
      aria-hidden="true"
      className={[
        'navigation-overlay__backdrop',
        'fixed inset-0 z-[999]',
        styles.backdrop,
        isRendered
          ? `pointer-events-auto ${styles.backdropRendered}`
          : 'pointer-events-none',
        isActive ? styles.backdropActive : '',
      ].join(' ')}
    >
      <div
        className={`absolute inset-0 bg-white/18 ${styles.blurLayer}`}
      />

      <div className="relative flex min-h-full items-center justify-center">
        <div
          className={[
            'navigation-overlay__loader',
            styles.loader,
            isActive ? 'scale-100 opacity-100' : 'scale-90 opacity-0',
          ].join(' ')}
        >
          <GooeyBlobLoader isAnimating={isRendered} />
        </div>
      </div>
    </div>
  )
}

function GooeyBlobLoader({ isAnimating }: { isAnimating: boolean }) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const instanceId = useId().replaceAll(':', '')
  const filterId = `navigation-goo-${instanceId}`
  const gradientId = `navigation-gradient-${instanceId}`
  const coreGradientId = `navigation-core-gradient-${instanceId}`
  const sheenGradientId = `navigation-sheen-gradient-${instanceId}`
  const shapeId = `navigation-shape-${instanceId}`
  const maskId = `navigation-mask-${instanceId}`

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    if (isAnimating) {
      svg.unpauseAnimations()
    } else {
      svg.pauseAnimations()
    }
  }, [isAnimating])

  return (
    <svg
      ref={svgRef}
      className={[
        'navigation-overlay__blob',
        styles.blob,
        isAnimating ? styles.blobAnimating : '',
      ].join(' ')}
      viewBox="0 0 120 120"
      role="presentation"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="20"
          y1="15"
          x2="102"
          y2="108"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="var(--blob-base)" />
          <stop offset="0.48" stopColor="var(--blob-balance)" />
          <stop offset="0.72" stopColor="var(--blob-mid)" />
          <stop offset="0.88" stopColor="var(--blob-deep)" />
          <stop offset="1" stopColor="var(--blob-primary)" />
        </linearGradient>
        <radialGradient id={coreGradientId} cx="48%" cy="45%" r="55%">
          <stop offset="0" stopColor="var(--blob-highlight)" stopOpacity="0.72" />
          <stop offset="0.42" stopColor="var(--blob-base)" stopOpacity="0.34" />
          <stop offset="1" stopColor="var(--blob-base)" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={sheenGradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--blob-highlight)" stopOpacity="0" />
          <stop offset="0.42" stopColor="var(--blob-highlight)" stopOpacity="0.16" />
          <stop offset="0.58" stopColor="var(--blob-highlight)" stopOpacity="0.82" />
          <stop offset="1" stopColor="var(--blob-highlight)" stopOpacity="0" />
        </linearGradient>
        <filter
          id={filterId}
          x="-30"
          y="-30"
          width="180"
          height="180"
          filterUnits="userSpaceOnUse"
          colorInterpolationFilters="sRGB"
        >
          <feGaussianBlur in="SourceGraphic" stdDeviation="5.5" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"
            result="goo"
          />
          <feBlend in="SourceGraphic" in2="goo" mode="normal" />
        </filter>
        <g id={shapeId}>
          <BlobCircles />
        </g>
        <mask
          id={maskId}
          x="-30"
          y="-30"
          width="180"
          height="180"
          maskUnits="userSpaceOnUse"
        >
          <g fill="white" filter={`url(#${filterId})`}>
            <use href={`#${shapeId}`} />
          </g>
        </mask>
      </defs>

      <g>
        <g
          className="navigation-overlay__blob-goo"
          fill={`url(#${gradientId})`}
          filter={`url(#${filterId})`}
        >
          <use href={`#${shapeId}`} />
        </g>

        <circle
          className={styles.energyCore}
          cx="60"
          cy="60"
          r="29"
          fill={`url(#${coreGradientId})`}
          mask={`url(#${maskId})`}
        />

        <g mask={`url(#${maskId})`} transform="rotate(-28 60 60)">
          <rect
            className={styles.sheen}
            x="-72"
            y="-28"
            width="28"
            height="176"
            fill={`url(#${sheenGradientId})`}
          />
        </g>
      </g>
    </svg>
  )
}

function BlobCircles() {
  return (
    <>
      <g className={styles.mainCore}>
        <circle cx="60" cy="60" r="25" />
      </g>

      <g transform="rotate(-30 60 60)">
        <g className={styles.satellite}>
          <circle cx="0" cy="0" r="17" />
          <animateMotion
            dur="2.6s"
            path="M 84 60 A 24 21 0 1 1 36 60 A 24 21 0 1 1 84 60"
            repeatCount="indefinite"
          />
        </g>
      </g>

      <g transform="rotate(110 60 60)">
        <g className={styles.satellite}>
          <circle cx="0" cy="0" r="15" />
          <animateMotion
            dur="3.7s"
            path="M 87 60 A 27 24 0 1 0 33 60 A 27 24 0 1 0 87 60"
            repeatCount="indefinite"
          />
        </g>
      </g>

      <g transform="rotate(225 60 60)">
        <g className={styles.satellite}>
          <circle cx="0" cy="0" r="14" />
          <animateMotion
            dur="5.1s"
            path="M 85 60 A 25 28 0 1 1 35 60 A 25 28 0 1 1 85 60"
            repeatCount="indefinite"
          />
        </g>
      </g>
    </>
  )
}
