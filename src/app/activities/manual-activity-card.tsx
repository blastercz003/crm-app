'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell, Repeat2 } from 'lucide-react'
import type { ActivityClientOption, ActivityListItem } from '@/lib/activities/types'
import {
  formatManualActivityDateTime,
  manualActivityRecurrenceLabel,
  manualActivityTypeLabel,
} from '@/lib/activities/manual-activity-presentation'
import {
  ManualActivityControls,
  type ManualActivityPreviewAnchor,
} from './manual-activity-controls'

export function ManualActivityCard({
  item,
  clients,
  canManage,
  focused = false,
}: {
  item: ActivityListItem
  clients: ActivityClientOption[]
  canManage: boolean
  focused?: boolean
}) {
  const [triggerElement, setTriggerElement] = useState<HTMLButtonElement | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewAnchor, setPreviewAnchor] = useState<ManualActivityPreviewAnchor | null>(null)
  const activityType = manualActivityTypeLabel(item.activity_type)
  const activityDate = formatManualActivityDateTime(item.status === 'planned' ? item.scheduled_for : item.occurred_at)
  const recurrenceLabel = manualActivityRecurrenceLabel(item.recurrence_unit, item.recurrence_interval)
  const hasPlanningSettings = item.status === 'planned' && Boolean(item.reminder_enabled || item.recurrence_unit)

  const syncPreviewAnchor = useCallback(() => {
    const rect = triggerElement?.closest<HTMLElement>('[data-activity-id]')?.getBoundingClientRect()
    if (!rect) return
    setPreviewAnchor({
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      width: rect.width,
    })
  }, [triggerElement])

  function togglePreview() {
    if (previewOpen) {
      setPreviewOpen(false)
      return
    }
    syncPreviewAnchor()
    setPreviewOpen(true)
  }

  function closePreview() {
    setPreviewOpen(false)
    window.requestAnimationFrame(() => triggerElement?.focus())
  }

  useEffect(() => {
    if (!previewOpen) return

    let frame = 0
    function scheduleAnchorSync() {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(syncPreviewAnchor)
    }

    window.addEventListener('resize', scheduleAnchorSync)
    window.addEventListener('scroll', scheduleAnchorSync, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', scheduleAnchorSync)
      window.removeEventListener('scroll', scheduleAnchorSync, true)
    }
  }, [previewOpen, syncPreviewAnchor])

  return (
    <div
      className={`activities-workspace__row activities-workspace__manual-card relative flex min-h-[52px] w-full min-w-0 max-w-full items-center gap-2 rounded-2xl border border-[var(--surface-border)] bg-[var(--surface-muted)] px-3 py-2.5 transition hover:-translate-y-px ${focused ? 'activities-workspace__notification-focus' : ''}`}
      data-activity-id={item.id}
    >
      <button
        ref={setTriggerElement}
        type="button"
        onClick={togglePreview}
        aria-haspopup="dialog"
        aria-expanded={previewOpen}
        className="activities-workspace__manual-trigger flex min-w-0 flex-1 items-start gap-2.5 rounded-xl text-left focus-visible:outline-none"
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.status === 'planned' ? 'bg-amber-400' : 'bg-emerald-500'}`} />
        <span className="min-w-0 flex-1">
          <span className={`activities-workspace__manual-title-row flex min-w-0 items-center gap-2 ${hasPlanningSettings ? 'pr-11 sm:pr-0' : ''}`}>
            <strong className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--text-primary)]">{item.title}</strong>
            {hasPlanningSettings ? (
              <span className="activities-workspace__manual-settings absolute right-2.5 top-2.5 z-[1] flex shrink-0 items-center gap-1.5 sm:static sm:z-auto" aria-label="Nastavení plánované aktivity">
                {item.reminder_enabled ? <span title="Notifikace 15 minut předem"><Bell aria-hidden size={13} className="text-sky-600 [html[data-theme='dark']_&]:text-sky-400" /></span> : null}
                {item.recurrence_unit ? <span title={recurrenceLabel ?? 'Opakovaná aktivita'}><Repeat2 aria-hidden size={13} className="text-violet-500 [html[data-theme='dark']_&]:text-violet-400" /></span> : null}
              </span>
            ) : null}
          </span>
          <span
            className="activities-workspace__manual-meta mt-0.5 grid min-w-0 items-center gap-1.5 text-[10px] text-[var(--text-secondary)]"
          >
            <span className="inline-flex h-[15px] min-w-0 items-center justify-center rounded-full border border-[var(--surface-border)] bg-white/45 px-1.5 text-center text-[9px] font-semibold uppercase leading-none tracking-0 [html[data-theme='dark']_&]:bg-white/[0.04]" title={activityType}>
              <span className="truncate text-center">{activityType}</span>
            </span>
            <span className="truncate" title={item.client_name ?? 'Bez klienta'}>{item.client_name ?? 'Bez klienta'}</span>
            <time className="whitespace-nowrap text-right tabular-nums" title={activityDate}>{activityDate}</time>
          </span>
        </span>
      </button>

      <ManualActivityControls
        activity={item}
        clients={clients}
        canManage={canManage}
        initiallyEditing={canManage && focused}
        previewOpen={previewOpen}
        previewAnchor={previewAnchor}
        previewTrigger={triggerElement}
        onPreviewClose={closePreview}
      />
    </div>
  )
}
