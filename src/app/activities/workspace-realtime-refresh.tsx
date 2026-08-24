'use client'

import { useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { subscribeToAppDataChanges } from '@/lib/realtime/app-sync'

const SCOPE_CARDS: Record<string, readonly string[]> = {
  activities: ['kpis', 'manual', 'system'],
  sticky_notes: ['sticky'],
  tasks: ['kpis', 'tasks', 'system'],
  meetings: ['kpis', 'meetings', 'system'],
  offers: ['kpis', 'offers', 'system'],
  jobs: ['jobs', 'system'],
}

function interactionBlocksRefresh() {
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true
  if (document.querySelector('[data-realtime-refresh-dirty="true"]')) return true
  const active = document.activeElement
  return active instanceof HTMLInputElement
    || active instanceof HTMLTextAreaElement
    || active instanceof HTMLSelectElement
    || active?.getAttribute('contenteditable') === 'true'
}

function setCardsRefreshing(cards: Iterable<string>, refreshing: boolean) {
  for (const card of cards) {
    document.querySelectorAll<HTMLElement>(`[data-workspace-card="${card}"]`).forEach((element) => {
      if (card === 'system') {
        if (refreshing) {
          element.dataset.liveEvent = 'true'
          element.setAttribute('aria-busy', 'true')
        } else {
          delete element.dataset.liveEvent
          element.removeAttribute('aria-busy')
        }
        return
      }
      if (refreshing) {
        element.dataset.refreshing = 'true'
        element.setAttribute('aria-busy', 'true')
      } else {
        delete element.dataset.refreshing
        element.removeAttribute('aria-busy')
      }
    })
  }
}

export function WorkspaceRealtimeRefresh() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const queuedCards = useRef(new Set<string>())
  const activeCards = useRef(new Set<string>())
  const timer = useRef<number | null>(null)
  const clearTimer = useRef<number | null>(null)
  const safetyTimer = useRef<number | null>(null)
  const refreshStartedAt = useRef(0)

  useEffect(() => {
    if (isPending || !activeCards.current.size) return

    const minimumVisibleTime = 520
    const elapsed = Date.now() - refreshStartedAt.current
    const delay = Math.max(0, minimumVisibleTime - elapsed)

    if (clearTimer.current !== null) window.clearTimeout(clearTimer.current)
    clearTimer.current = window.setTimeout(() => {
      setCardsRefreshing(activeCards.current, false)
      activeCards.current.clear()
      clearTimer.current = null
      if (safetyTimer.current !== null) {
        window.clearTimeout(safetyTimer.current)
        safetyTimer.current = null
      }
    }, delay)

    return () => {
      if (clearTimer.current !== null) {
        window.clearTimeout(clearTimer.current)
        clearTimer.current = null
      }
    }
  }, [isPending])

  useEffect(() => {
    const activeCardsForCleanup = activeCards.current

    function schedule(delay = 650) {
      if (timer.current !== null) window.clearTimeout(timer.current)
      timer.current = window.setTimeout(refresh, delay)
    }

    function refresh() {
      timer.current = null
      if (document.visibilityState !== 'visible' || interactionBlocksRefresh()) {
        schedule(700)
        return
      }

      const cards = new Set(queuedCards.current)
      queuedCards.current.clear()
      if (!cards.size) return

      for (const card of cards) activeCards.current.add(card)
      setCardsRefreshing(cards, true)
      refreshStartedAt.current = Date.now()
      startTransition(() => router.refresh())

      if (safetyTimer.current !== null) window.clearTimeout(safetyTimer.current)
      safetyTimer.current = window.setTimeout(() => {
        setCardsRefreshing(activeCards.current, false)
        activeCards.current.clear()
        safetyTimer.current = null
      }, 6000)
    }

    function markDirty(event: Event) {
      if (!(event.target instanceof Element)) return
      const form = event.target.closest('form')
      if (form) form.dataset.realtimeRefreshDirty = 'true'
    }

    function markClean(event: Event) {
      if (!(event.target instanceof Element)) return
      const form = event.target.closest('form')
      if (form) delete form.dataset.realtimeRefreshDirty
      if (queuedCards.current.size) schedule(100)
    }

    function retryQueuedRefresh() {
      if (queuedCards.current.size) schedule(100)
    }

    function refreshOnVisibility() {
      if (document.visibilityState === 'visible') retryQueuedRefresh()
    }

    const unsubscribe = subscribeToAppDataChanges((detail) => {
      for (const card of SCOPE_CARDS[detail.scope] ?? []) queuedCards.current.add(card)
      if (queuedCards.current.size) schedule()
    })

    document.addEventListener('input', markDirty, true)
    document.addEventListener('change', markDirty, true)
    document.addEventListener('submit', markClean, true)
    document.addEventListener('reset', markClean, true)
    document.addEventListener('focusout', retryQueuedRefresh, true)
    document.addEventListener('visibilitychange', refreshOnVisibility)

    return () => {
      unsubscribe()
      if (timer.current !== null) window.clearTimeout(timer.current)
      if (clearTimer.current !== null) window.clearTimeout(clearTimer.current)
      if (safetyTimer.current !== null) window.clearTimeout(safetyTimer.current)
      setCardsRefreshing(activeCardsForCleanup, false)
      document.removeEventListener('input', markDirty, true)
      document.removeEventListener('change', markDirty, true)
      document.removeEventListener('submit', markClean, true)
      document.removeEventListener('reset', markClean, true)
      document.removeEventListener('focusout', retryQueuedRefresh, true)
      document.removeEventListener('visibilitychange', refreshOnVisibility)
    }
  }, [router, startTransition])

  return null
}

export function WorkspaceNotificationFocus({ activityId, stickyNoteId }: {
  activityId?: string
  stickyNoteId?: string
}) {
  useEffect(() => {
    const targetId = activityId || stickyNoteId
    if (!targetId) return
    const selector = activityId
      ? `[data-activity-id="${CSS.escape(targetId)}"]`
      : `[data-sticky-note-id="${CSS.escape(targetId)}"]`
    const frame = window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(selector)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [activityId, stickyNoteId])

  return null
}
