'use client'

import { startTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeToAppDataChanges } from '@/lib/realtime/app-sync'

const DEFAULT_REFRESH_DEBOUNCE_MS = 900
const GLOBAL_REFRESH_COOLDOWN_MS = 5_000
const DEFERRED_REFRESH_RETRY_MS = 750

let lastGlobalRefreshAt = 0

function hasUnsafeRefreshInteraction() {
  if (document.querySelector('[data-realtime-refresh-block="true"]')) return true
  if (document.querySelector('[data-realtime-refresh-dirty="true"]')) return true
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true

  const activeElement = document.activeElement
  if (!activeElement) return false

  return (
    activeElement instanceof HTMLInputElement ||
    activeElement instanceof HTMLTextAreaElement ||
    activeElement instanceof HTMLSelectElement ||
    activeElement.getAttribute('contenteditable') === 'true'
  )
}

export function SafeRealtimeRefresh({
  scopes,
  debounceMs = DEFAULT_REFRESH_DEBOUNCE_MS,
}: {
  scopes: readonly string[]
  debounceMs?: number
}) {
  const router = useRouter()
  const pendingRefreshRef = useRef(false)
  const refreshTimerRef = useRef<number | null>(null)
  const deferredRetryTimerRef = useRef<number | null>(null)
  const scopeKey = scopes.slice().sort().join(',')

  useEffect(() => {
    const acceptedScopes = new Set(scopeKey.split(',').filter(Boolean))

    function scheduleDeferredRefresh() {
      if (
        document.visibilityState !== 'visible' ||
        deferredRetryTimerRef.current !== null
      ) {
        return
      }

      deferredRetryTimerRef.current = window.setTimeout(() => {
        deferredRetryTimerRef.current = null
        if (pendingRefreshRef.current) performRefresh()
      }, DEFERRED_REFRESH_RETRY_MS)
    }

    function getChangedForm(target: EventTarget | null) {
      if (!(target instanceof Element)) return null

      const form = target.closest('form')
      if (!form || form.dataset.realtimeRefreshIgnore === 'true') return null
      return form
    }

    function markFormDirty(event: Event) {
      const form = getChangedForm(event.target)
      if (form) form.dataset.realtimeRefreshDirty = 'true'
    }

    function markFormClean(event: Event) {
      const form = getChangedForm(event.target)
      if (form) delete form.dataset.realtimeRefreshDirty
      if (pendingRefreshRef.current) scheduleDeferredRefresh()
    }

    function performRefresh() {
      refreshTimerRef.current = null

      if (
        document.visibilityState !== 'visible' ||
        hasUnsafeRefreshInteraction()
      ) {
        pendingRefreshRef.current = true
        scheduleDeferredRefresh()
        return
      }

      const cooldownRemaining =
        GLOBAL_REFRESH_COOLDOWN_MS - (Date.now() - lastGlobalRefreshAt)
      if (cooldownRemaining > 0) {
        refreshTimerRef.current = window.setTimeout(
          performRefresh,
          cooldownRemaining
        )
        return
      }

      pendingRefreshRef.current = false
      lastGlobalRefreshAt = Date.now()
      startTransition(() => router.refresh())
    }

    function scheduleRefresh() {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
      }

      refreshTimerRef.current = window.setTimeout(performRefresh, debounceMs)
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && pendingRefreshRef.current) {
        performRefresh()
      }
    }

    function handleInteractionFinished() {
      if (pendingRefreshRef.current) scheduleDeferredRefresh()
    }

    const unsubscribe = subscribeToAppDataChanges((detail) => {
      if (acceptedScopes.has(detail.scope)) scheduleRefresh()
    })
    document.addEventListener('input', markFormDirty, true)
    document.addEventListener('change', markFormDirty, true)
    document.addEventListener('submit', markFormClean, true)
    document.addEventListener('reset', markFormClean, true)
    document.addEventListener('focusout', handleInteractionFinished, true)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
      }
      if (deferredRetryTimerRef.current !== null) {
        window.clearTimeout(deferredRetryTimerRef.current)
      }
      pendingRefreshRef.current = false
      document
        .querySelectorAll<HTMLFormElement>('[data-realtime-refresh-dirty="true"]')
        .forEach((form) => delete form.dataset.realtimeRefreshDirty)
      unsubscribe()
      document.removeEventListener('input', markFormDirty, true)
      document.removeEventListener('change', markFormDirty, true)
      document.removeEventListener('submit', markFormClean, true)
      document.removeEventListener('reset', markFormClean, true)
      document.removeEventListener('focusout', handleInteractionFinished, true)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [debounceMs, router, scopeKey])

  return null
}
