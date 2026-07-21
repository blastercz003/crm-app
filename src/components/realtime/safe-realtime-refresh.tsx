'use client'

import { startTransition, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeToAppDataChanges } from '@/lib/realtime/app-sync'

const DEFAULT_REFRESH_DEBOUNCE_MS = 900
const GLOBAL_REFRESH_COOLDOWN_MS = 5_000

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
  const [hasPendingRefresh, setHasPendingRefresh] = useState(false)
  const pendingRefreshRef = useRef(false)
  const refreshTimerRef = useRef<number | null>(null)
  const scopeKey = scopes.slice().sort().join(',')

  function updatePendingRefresh(value: boolean) {
    pendingRefreshRef.current = value
    setHasPendingRefresh(value)
  }

  useEffect(() => {
    const acceptedScopes = new Set(scopeKey.split(',').filter(Boolean))

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
    }

    function performRefresh() {
      refreshTimerRef.current = null

      if (
        document.visibilityState !== 'visible' ||
        hasUnsafeRefreshInteraction()
      ) {
        updatePendingRefresh(true)
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

      updatePendingRefresh(false)
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
      if (
        document.visibilityState === 'visible' &&
        pendingRefreshRef.current &&
        !hasUnsafeRefreshInteraction()
      ) {
        performRefresh()
      }
    }

    const unsubscribe = subscribeToAppDataChanges((detail) => {
      if (acceptedScopes.has(detail.scope)) scheduleRefresh()
    })
    document.addEventListener('input', markFormDirty, true)
    document.addEventListener('change', markFormDirty, true)
    document.addEventListener('submit', markFormClean, true)
    document.addEventListener('reset', markFormClean, true)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current)
      }
      document
        .querySelectorAll<HTMLFormElement>('[data-realtime-refresh-dirty="true"]')
        .forEach((form) => delete form.dataset.realtimeRefreshDirty)
      unsubscribe()
      document.removeEventListener('input', markFormDirty, true)
      document.removeEventListener('change', markFormDirty, true)
      document.removeEventListener('submit', markFormClean, true)
      document.removeEventListener('reset', markFormClean, true)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [debounceMs, router, scopeKey])

  function handleManualRefresh() {
    if (hasUnsafeRefreshInteraction()) {
      window.alert('Nejprve dokončete nebo uložte rozpracované změny a zavřete otevřená okna.')
      return
    }

    if (refreshTimerRef.current !== null) {
      window.clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }

    updatePendingRefresh(false)
    lastGlobalRefreshAt = Date.now()
    startTransition(() => router.refresh())
  }

  if (!hasPendingRefresh) return null

  return (
    <div
      className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-[190] flex justify-center print:hidden"
      role="status"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={handleManualRefresh}
        className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-[#5d9dcb] bg-[#246b9e] px-5 text-sm font-semibold uppercase tracking-[0.04em] text-white shadow-[0_16px_36px_rgba(15,23,42,0.32)] transition hover:-translate-y-[1px] hover:bg-[#1f5f8f]"
      >
        NOVÁ DATA – NAČÍST
      </button>
    </div>
  )
}
