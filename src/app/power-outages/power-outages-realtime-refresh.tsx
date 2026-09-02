'use client'

import { startTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { SafeRealtimeRefresh } from '@/components/realtime/safe-realtime-refresh'

const HEALTH_REFRESH_INTERVAL_MS = 5 * 60 * 1_000

export function PowerOutagesRealtimeRefresh({ scope = 'power_outages' }: { scope?: 'power_outages' | 'complete_power_outages' }) {
  const router = useRouter()
  const lastHealthRefreshAtRef = useRef(0)

  useEffect(() => {
    lastHealthRefreshAtRef.current = Date.now()

    function refreshHealthIfSafe() {
      if (document.visibilityState !== 'visible') return
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return

      lastHealthRefreshAtRef.current = Date.now()
      startTransition(() => router.refresh())
    }

    function handleVisibilityChange() {
      if (
        document.visibilityState === 'visible'
        && Date.now() - lastHealthRefreshAtRef.current >= HEALTH_REFRESH_INTERVAL_MS
      ) {
        refreshHealthIfSafe()
      }
    }

    const intervalId = window.setInterval(
      refreshHealthIfSafe,
      HEALTH_REFRESH_INTERVAL_MS,
    )
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [router])

  return <SafeRealtimeRefresh scopes={[scope]} debounceMs={1_200} />
}
