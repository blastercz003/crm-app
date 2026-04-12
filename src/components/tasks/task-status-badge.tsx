type Props = {
  status: 'todo' | 'done'
}

export function TaskStatusBadge({ status }: Props) {
  if (status === 'done') {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
        Hotovo
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
      Aktivní
    </span>
  )
}

export function TaskSourceBadge({ source }: { source: 'manual' | 'meeting' }) {
  if (source === 'meeting') {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
        Ze schůzky
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded-full border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">
      Vlastní
    </span>
  )
}