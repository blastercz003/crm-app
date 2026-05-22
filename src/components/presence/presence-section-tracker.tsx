'use client'

import { useEffect } from 'react'
import { trackUserPresenceAction } from '@/app/dashboard/online-presence-actions'

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
        await trackUserPresenceAction({
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
