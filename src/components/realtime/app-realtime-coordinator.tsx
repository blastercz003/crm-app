'use client'

import { useEffect, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import {
  dispatchAppDataChanged,
  parseAppDataChangedPayload,
} from '@/lib/realtime/app-sync'

type AppSyncVersionRow = {
  scope: string
  version: number
}

const VERSION_CHECK_INTERVAL_MS = 60_000
const VERSION_CHECK_THROTTLE_MS = 2_000

export function AppRealtimeCoordinator() {
  const [supabase] = useState(createClient)

  useEffect(() => {
    let disposed = false
    let channel: RealtimeChannel | null = null
    let activeUserId: string | null = null
    let connectionPromise: Promise<void> | null = null
    let versionCheckPromise: Promise<void> | null = null
    let lastVersionCheckAt = 0
    const knownVersions = new Map<string, number>()

    function acceptChange(
      change: { scope: string; version: number },
      source: 'broadcast' | 'version_check'
    ) {
      const knownVersion = knownVersions.get(change.scope) ?? 0
      if (change.version <= knownVersion) return

      knownVersions.set(change.scope, change.version)
      dispatchAppDataChanged({ ...change, source })
    }

    async function checkVersions(emitChanges: boolean) {
      if (!activeUserId || disposed) return
      if (versionCheckPromise) return versionCheckPromise

      const userId = activeUserId
      versionCheckPromise = (async () => {
        const { data, error } = await supabase
          .from('app_sync_versions')
          .select('scope, version')
          .eq('user_id', userId)

        if (disposed || userId !== activeUserId) return
        lastVersionCheckAt = Date.now()

        if (error) {
          console.warn('Nepodařilo se ověřit aktuálnost dat aplikace.', error)
          return
        }

        for (const row of (data ?? []) as AppSyncVersionRow[]) {
          const change = parseAppDataChangedPayload(row)
          if (!change) continue

          if (emitChanges) {
            acceptChange(change, 'version_check')
          } else {
            knownVersions.set(
              change.scope,
              Math.max(knownVersions.get(change.scope) ?? 0, change.version)
            )
          }
        }
      })().finally(() => {
        versionCheckPromise = null
      })

      return versionCheckPromise
    }

    function requestVersionCheck() {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastVersionCheckAt < VERSION_CHECK_THROTTLE_MS) return
      void checkVersions(true)
    }

    async function removeCurrentChannel() {
      const currentChannel = channel
      channel = null

      if (currentChannel) {
        await supabase.removeChannel(currentChannel)
      }
    }

    async function disconnect() {
      activeUserId = null
      knownVersions.clear()
      await removeCurrentChannel()
    }

    function subscribeToUserChannel(userId: string) {
      const nextChannel = supabase
        .channel(`app:user:${userId}`, { config: { private: true } })
        .on<{ scope: string; version: number }>(
          'broadcast',
          { event: 'data_changed' },
          ({ payload }) => {
            const change = parseAppDataChangedPayload(payload)
            if (change) acceptChange(change, 'broadcast')
          }
        )

      channel = nextChannel
      nextChannel.subscribe((status) => {
        if (channel !== nextChannel) return
        if (status === 'SUBSCRIBED') requestVersionCheck()
      })
    }

    async function connect(
      userId: string,
      accessToken: string,
      emitMissedChanges: boolean
    ) {
      if (disposed) return

      if (connectionPromise) {
        await connectionPromise
        if (disposed) return
      }

      if (activeUserId === userId && channel) {
        await supabase.realtime.setAuth(accessToken)
        if (emitMissedChanges) await checkVersions(true)
        return
      }

      connectionPromise = (async () => {
        await disconnect()
        activeUserId = userId
        await supabase.realtime.setAuth(accessToken)
        await checkVersions(emitMissedChanges)
        if (disposed || activeUserId !== userId) return

        subscribeToUserChannel(userId)
      })().finally(() => {
        connectionPromise = null
      })

      await connectionPromise
    }

    function handleForegroundResume() {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return

      // Supabase reconnects its existing socket itself. We only reconcile
      // revision numbers here so returning to a PWA never creates a channel loop.
      requestVersionCheck()
    }

    async function initialize() {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session) {
        await connect(session.user.id, session.access_token, false)
      }
    }

    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      queueMicrotask(() => {
        if (disposed) return

        if (event === 'SIGNED_OUT' || !session) {
          void disconnect()
          return
        }

        if (event === 'SIGNED_IN') {
          void connect(session.user.id, session.access_token, false)
          return
        }

        if (event === 'TOKEN_REFRESHED') {
          void supabase.realtime.setAuth(session.access_token)
        }
      })
    })

    const intervalId = window.setInterval(() => {
      requestVersionCheck()
    }, VERSION_CHECK_INTERVAL_MS)
    window.addEventListener('focus', handleForegroundResume)
    window.addEventListener('online', handleForegroundResume)
    window.addEventListener('pageshow', handleForegroundResume)
    document.addEventListener('visibilitychange', handleForegroundResume)
    void initialize()

    return () => {
      disposed = true
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleForegroundResume)
      window.removeEventListener('online', handleForegroundResume)
      window.removeEventListener('pageshow', handleForegroundResume)
      document.removeEventListener('visibilitychange', handleForegroundResume)
      authSubscription.unsubscribe()

      if (channel) void supabase.removeChannel(channel)
    }
  }, [supabase])

  return null
}
