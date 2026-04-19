type MeetingStatus = 'planned' | 'overdue' | 'completed'

type Props = {
  status: MeetingStatus
}

export function MeetingStatusBadge({ status }: Props) {
  if (status === 'completed') {
    return (
      <span className="inline-flex items-center rounded-full border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">
        Proběhlo
      </span>
    )
  }

  if (status === 'overdue') {
    return (
      <span className="inline-flex items-center rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
        Po termínu
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
      Plánováno
    </span>
  )
}

export function MeetingTaskBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
      Úkol
    </span>
  )
}
