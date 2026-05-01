'use client'

import { useEffect } from 'react'
import { setAppBadgeCount } from '@/lib/pwa/appBadge'

type AppBadgeSyncProps = {
  count: number
}

export function AppBadgeSync({ count }: AppBadgeSyncProps) {
  useEffect(() => {
    setAppBadgeCount(count).catch(() => {})
  }, [count])

  return null
}
