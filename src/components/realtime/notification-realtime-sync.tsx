'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { subscribeToAppDataChanges } from '@/lib/realtime/app-sync'
import { setAppBadgeCount } from '@/lib/pwa/appBadge'

const NOTIFICATION_SYNC_DEBOUNCE_MS = 800

export function NotificationRealtimeSync() {
  const [supabase] = useState(createClient)

  useEffect(() => {
    let disposed = false
    let syncTimerId: number | null = null

    async function syncUnreadBadge() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session || disposed) return

      const { count, error } = await supabase
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .eq('recipient_user_id', session.user.id)
        .is('read_at', null)
        .is('archived_at', null)

      if (disposed) return
      if (error) {
        console.warn('Nepodařilo se aktualizovat počet notifikací.', error)
        return
      }

      await setAppBadgeCount(count ?? 0).catch(() => {})
    }

    function runSync() {
      syncTimerId = null
      void syncUnreadBadge()
    }

    function scheduleSync() {
      if (syncTimerId !== null) window.clearTimeout(syncTimerId)
      syncTimerId = window.setTimeout(runSync, NOTIFICATION_SYNC_DEBOUNCE_MS)
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return

      void syncUnreadBadge()
    }

    const unsubscribe = subscribeToAppDataChanges((detail) => {
      if (detail.scope === 'notifications') scheduleSync()
    })
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      disposed = true
      if (syncTimerId !== null) window.clearTimeout(syncTimerId)
      unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [supabase])

  return null
}
