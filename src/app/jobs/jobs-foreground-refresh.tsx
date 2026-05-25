'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

const MIN_REFRESH_INTERVAL_MS = 12_000

export function JobsForegroundRefresh() {
  const router = useRouter()
  const lastRefreshAtRef = useRef(0)

  useEffect(() => {
    const triggerRefresh = () => {
      const now = Date.now()
      if (now - lastRefreshAtRef.current < MIN_REFRESH_INTERVAL_MS) return
      lastRefreshAtRef.current = now
      router.refresh()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerRefresh()
      }
    }

    const handlePageShow = () => {
      triggerRefresh()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [router])

  return null
}
