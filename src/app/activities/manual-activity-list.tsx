'use client'

import { useCallback, useEffect, useState, type UIEvent } from 'react'
import { LoaderCircle } from 'lucide-react'
import type { ActivityClientOption, ActivityListItem } from '@/lib/activities/types'
import { loadManualActivityPageAction } from './actions'
import { ManualActivityCard } from './manual-activity-card'

const LOAD_BATCH_SIZE = 20

export function ManualActivityList({
  kind,
  userId,
  initialItems,
  initialLoadedCount,
  initialTotal,
  clients,
  canManage,
  focusedActivityId,
}: {
  kind: 'planned' | 'logged'
  userId: string
  initialItems: ActivityListItem[]
  initialLoadedCount: number
  initialTotal: number
  clients: ActivityClientOption[]
  canManage: boolean
  focusedActivityId: string
}) {
  const [items, setItems] = useState(initialItems)
  const [offset, setOffset] = useState(initialLoadedCount)
  const [total, setTotal] = useState(initialTotal)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setItems(initialItems)
    setOffset(initialLoadedCount)
    setTotal(initialTotal)
    setError(null)
    setLoading(false)
  }, [initialItems, initialLoadedCount, initialTotal, userId])

  const loadMore = useCallback(async () => {
    if (loading || offset >= total) return
    setLoading(true)
    setError(null)

    const result = await loadManualActivityPageAction({
      userId,
      kind,
      offset,
      limit: LOAD_BATCH_SIZE,
    })

    if (!result.success) {
      setError(result.error ?? 'Další aktivity se nepodařilo načíst.')
      setLoading(false)
      return
    }

    setItems((current) => {
      const knownIds = new Set(current.map((item) => item.id))
      return [...current, ...result.items.filter((item) => !knownIds.has(item.id))]
    })
    setOffset(result.nextOffset)
    setTotal(result.total)
    setLoading(false)
  }, [kind, loading, offset, total, userId])

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const element = event.currentTarget
    if (element.scrollHeight - element.scrollTop - element.clientHeight <= 80) void loadMore()
  }

  return (
    <div
      className="activities-workspace__manual-list min-w-0 max-h-[292px] space-y-2 overflow-y-auto overscroll-contain pr-1 sm:max-h-[412px]"
      onScroll={handleScroll}
      role="region"
      aria-label={kind === 'planned' ? 'Naplánované aktivity' : 'Poslední zápisy aktivit'}
      tabIndex={total > (kind === 'planned' ? 5 : 5) ? 0 : undefined}
    >
      {items.map((item) => (
        <ManualActivityCard
          key={item.id}
          item={item}
          clients={clients}
          canManage={canManage}
          focused={item.id === focusedActivityId}
        />
      ))}
      {loading ? <div className="flex h-10 items-center justify-center text-[var(--accent)]" aria-label="Načítám další aktivity"><LoaderCircle aria-hidden size={16} className="animate-spin" /></div> : null}
      {error ? <button type="button" onClick={() => void loadMore()} className="flex min-h-10 w-full items-center justify-center rounded-xl border border-rose-200/70 bg-rose-50/70 px-3 text-[10px] font-semibold text-rose-700 [html[data-theme='dark']_&]:border-rose-400/20 [html[data-theme='dark']_&]:bg-rose-500/10 [html[data-theme='dark']_&]:text-rose-300">NAČÍST ZNOVU</button> : null}
    </div>
  )
}
