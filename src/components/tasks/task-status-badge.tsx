type Props = {
  status: 'todo' | 'done'
}

export function TaskStatusBadge({ status }: Props) {
  if (status === 'done') {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-500/90 bg-[linear-gradient(155deg,#11a36b_0%,#089861_55%,#067f51_100%)] px-2.5 py-1 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(167,243,208,0.42),0_8px_16px_rgba(5,150,105,0.2)]">
        Hotovo
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded-full border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-2.5 py-1 text-xs font-medium text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(24,78,129,0.2)]">
      Aktivní
    </span>
  )
}

export function TaskSourceBadge({ source }: { source: 'manual' | 'meeting' }) {
  if (source === 'meeting') {
    return (
      <span className="inline-flex items-center rounded-full border border-amber-300/85 bg-[linear-gradient(155deg,#fff8e7_0%,#ffefc9_100%)] px-2.5 py-1 text-xs font-medium text-amber-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_6px_14px_rgba(180,83,9,0.1)]">
        Ze schůzky
      </span>
    )
  }

  return (
    <span className="inline-flex items-center rounded-full border border-slate-300/80 bg-[linear-gradient(155deg,#f3f7fb_0%,#e8eef6_100%)] px-2.5 py-1 text-xs font-medium text-slate-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(51,65,85,0.08)]">
      Vlastní
    </span>
  )
}
