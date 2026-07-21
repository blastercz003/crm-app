'use client'

import { SafeRealtimeRefresh } from '@/components/realtime/safe-realtime-refresh'

export function JobsForegroundRefresh() {
  return <SafeRealtimeRefresh scopes={['jobs']} />
}
