'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'

const LAUNCH_SESSION_KEY = 'benergy_launch_seen'

function isStandaloneMode() {
  if (typeof window === 'undefined') return false

  const iosStandalone =
    'standalone' in navigator &&
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  const mediaStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches === true

  return iosStandalone || mediaStandalone
}

export function LaunchGate() {
  const router = useRouter()
  const pathname = usePathname()
  const hasCheckedRef = useRef(false)

  useEffect(() => {
    if (hasCheckedRef.current) return
    hasCheckedRef.current = true

    if (!isStandaloneMode()) return
    if (pathname === '/launch') return

    const seenInSession = sessionStorage.getItem(LAUNCH_SESSION_KEY) === '1'
    if (seenInSession) return

    sessionStorage.setItem(LAUNCH_SESSION_KEY, '1')

    const query = typeof window === 'undefined' ? '' : window.location.search.slice(1)
    const nextPath = query ? `${pathname}?${query}` : pathname
    router.replace(`/launch?next=${encodeURIComponent(nextPath)}`)
  }, [pathname, router])

  return null
}
