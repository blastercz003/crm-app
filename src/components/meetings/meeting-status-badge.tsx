type MeetingStatus = 'planned' | 'overdue' | 'completed'

type Props = {
  status: MeetingStatus
}

export function MeetingStatusBadge({ status }: Props) {
  if (status === 'completed') {
    return (
      <span className="meeting-status-badge meeting-status-badge--completed inline-flex items-center rounded-full border border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] px-2.5 py-1 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(16,185,129,0.22)]">
        Proběhlo
      </span>
    )
  }

  if (status === 'overdue') {
    return (
      <span className="meeting-status-badge meeting-status-badge--overdue inline-flex items-center rounded-full border border-[#e69ab2]/85 bg-[linear-gradient(155deg,#d65b82_0%,#c8426c_55%,#b4335d_100%)] px-2.5 py-1 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(190,24,93,0.24)]">
        Po termínu
      </span>
    )
  }

  return (
    <span className="meeting-status-badge meeting-status-badge--planned inline-flex items-center rounded-full border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2.5 py-1 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(24,78,129,0.2)]">
      Plánováno
    </span>
  )
}

export function MeetingTaskBadge() {
  return (
    <span className="meeting-task-badge inline-flex items-center rounded-full border border-[#f3c58a]/85 bg-[linear-gradient(155deg,#f2a344_0%,#e68a20_55%,#cd7212_100%)] px-2.5 py-1 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(180,83,9,0.24)]">
      Úkol
    </span>
  )
}
