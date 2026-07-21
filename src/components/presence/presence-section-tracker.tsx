'use client'

import { useEffect } from 'react'
import { trackUserPresence } from '@/lib/dashboard/dashboard-background-client'

type PresenceSectionTrackerProps = {
  section: string
  route: string
}

export function PresenceSectionTracker({ section, route }: PresenceSectionTrackerProps) {
  useEffect(() => {
    let isStopped = false

    const ping = async () => {
      if (isStopped) return

      try {
        await trackUserPresence({
          section,
          route,
        })
      } catch {
        // best effort only
      }
    }

    void ping()
    const intervalId = window.setInterval(() => {
      void ping()
    }, 30_000)

    return () => {
      isStopped = true
      window.clearInterval(intervalId)
    }
  }, [route, section])

  return null
}
