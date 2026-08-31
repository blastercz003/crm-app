'use client'

import { SafeRealtimeRefresh } from '@/components/realtime/safe-realtime-refresh'

export function PowerOutagesRealtimeRefresh() {
  return <SafeRealtimeRefresh scopes={['power_outages']} debounceMs={1_200} />
}
