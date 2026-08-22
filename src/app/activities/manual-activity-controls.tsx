'use client'

import { useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { Check, Pencil, Trash2 } from 'lucide-react'
import { ActivityFormModal } from './new-activity-button'
import {
  completeManualActivityAction,
  deleteManualActivityAction,
  updateManualActivityAction,
} from './actions'
import { ActionFeedbackToast, useAnimatedActionToast } from '@/components/ui/action-feedback-toast'
import type { ActivityActionState, ActivityClientOption, ActivityListItem } from '@/lib/activities/types'

export function ManualActivityControls({ activity, clients }: {
  activity: ActivityListItem
  clients: ActivityClientOption[]
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [formKey, setFormKey] = useState(0)
  const [pending, startTransition] = useTransition()
  const [mounted] = useState(() => typeof window !== 'undefined')
  const { toast, isVisible, showToast } = useAnimatedActionToast()
  const updateAction = useMemo(
    () => updateManualActivityAction.bind(null, activity.id) as (
      state: ActivityActionState,
      formData: FormData,
    ) => Promise<ActivityActionState>,
    [activity.id],
  )

  function showError(message: string) {
    showToast({ title: 'CHYBA', message, tone: 'error' })
  }

  function openEdit() {
    setFormKey((current) => current + 1)
    setEditing(true)
  }

  function handleEdited() {
    setEditing(false)
    showToast({ title: 'AKTIVITA UPRAVENA', message: 'Změny byly uloženy do historie aktivit.', tone: 'success' })
    router.refresh()
  }

  function completeActivity() {
    startTransition(async () => {
      const result = await completeManualActivityAction(activity.id)
      if (!result.success) {
        showError(result.error ?? 'Aktivitu se nepodařilo dokončit.')
        return
      }
      showToast({ title: 'AKTIVITA DOKONČENA', message: 'Plánovaná aktivita byla označena jako dokončená.', tone: 'success' })
      router.refresh()
    })
  }

  function deleteActivity() {
    if (!window.confirm(`Opravdu chcete odstranit aktivitu „${activity.title}“?`)) return
    startTransition(async () => {
      const result = await deleteManualActivityAction(activity.id)
      if (!result.success) {
        showError(result.error ?? 'Aktivitu se nepodařilo odstranit.')
        return
      }
      showToast({ title: 'AKTIVITA ODSTRANĚNA', message: 'Ruční záznam byl odstraněn.', tone: 'success' })
      router.refresh()
    })
  }

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2" aria-label="Akce ruční aktivity">
        {activity.status === 'planned' ? <button type="button" disabled={pending} onClick={completeActivity} className="activities-page__activity-action activities-page__activity-action--complete"><Check aria-hidden size={14} /> Dokončit</button> : null}
        <button type="button" disabled={pending} onClick={openEdit} className="activities-page__activity-action"><Pencil aria-hidden size={13} /> Upravit</button>
        <button type="button" disabled={pending} onClick={deleteActivity} className="activities-page__activity-action activities-page__activity-action--delete"><Trash2 aria-hidden size={13} /> Odstranit</button>
      </div>
      {mounted && editing ? createPortal(
        <ActivityFormModal key={formKey} clients={clients} activity={activity} action={updateAction} onClose={() => setEditing(false)} onSaved={handleEdited} />,
        document.body,
      ) : null}
      {toast ? <ActionFeedbackToast toast={toast} isVisible={isVisible} /> : null}
    </>
  )
}
