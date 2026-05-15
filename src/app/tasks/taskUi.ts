export function getStatusLabel(status: string | null | undefined) {
  switch (status) {
    case 'todo':
      return 'K vyřízení'
    case 'done':
      return 'Hotovo'
    default:
      return 'Neuvedeno'
  }
}

export function getPriorityLabel(priority: string | null | undefined) {
  switch (priority) {
    case 'low':
      return 'Nízká'
    case 'medium':
      return 'Střední'
    case 'high':
      return 'Vysoká'
    default:
      return 'Neuvedeno'
  }
}

export function getStatusBadgeClass(status: string | null | undefined) {
  switch (status) {
    case 'todo':
      return 'border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(24,78,129,0.2)]'
    case 'done':
      return 'border border-emerald-500/90 bg-[linear-gradient(155deg,#11a36b_0%,#089861_55%,#067f51_100%)] text-white shadow-[inset_0_1px_0_rgba(167,243,208,0.42),0_8px_16px_rgba(5,150,105,0.2)]'
    default:
      return 'border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)]'
  }
}

export function getPriorityBadgeClass(priority: string | null | undefined) {
  switch (priority) {
    case 'low':
      return 'border border-[#9ebfdb]/85 bg-[linear-gradient(155deg,#6ea4cf_0%,#4f8fbe_55%,#3a79a8_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(42,95,136,0.22)]'
    case 'medium':
      return 'border border-[#f3c58a]/85 bg-[linear-gradient(155deg,#f2a344_0%,#e68a20_55%,#cd7212_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(180,83,9,0.24)]'
    case 'high':
      return 'border border-[#e69ab2]/85 bg-[linear-gradient(155deg,#d65b82_0%,#c8426c_55%,#b4335d_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(190,24,93,0.24)]'
    default:
      return 'border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] text-gray-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_6px_14px_rgba(15,23,42,0.08)]'
  }
}

function parseDateOnly(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null

  const [, year, month, day] = match
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
  }
}

export function formatTaskDueDateShort(value: string | null | undefined) {
  if (!value) return 'BEZ TERMÍNU'

  const parsed = parseDateOnly(value)
  if (!parsed) return 'BEZ TERMÍNU'

  const day = String(parsed.day).padStart(2, '0')
  const month = String(parsed.month).padStart(2, '0')

  return `${day}.${month}.`
}

export function getTaskDueBadgeClass({
  hasDueDate,
  isToday,
  isOverdue,
}: {
  hasDueDate: boolean
  isToday: boolean
  isOverdue: boolean
}) {
  if (!hasDueDate) {
    return 'border border-[#b8c8d8]/90 bg-[linear-gradient(155deg,#DCE6F1_0%,#C7D6E6_100%)] text-[#3F5368] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_8px_16px_rgba(63,83,104,0.12)]'
  }

  if (isOverdue) {
    return 'border border-[#ef4444]/90 bg-[#dc2626] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_16px_rgba(220,38,38,0.25)]'
  }

  if (isToday) {
    return 'border border-[#f3c58a]/85 bg-[linear-gradient(155deg,#F2A344_0%,#CD7212_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_8px_16px_rgba(180,83,9,0.24)]'
  }

  return getStatusBadgeClass('todo')
}

export type TaskRepeatInterval = 'daily' | 'weekly' | 'monthly'

export function getRepeatIntervalShortLabel(
  repeatInterval: string | null | undefined
) {
  switch (repeatInterval) {
    case 'daily':
      return 'DEN'
    case 'weekly':
      return 'TÝDEN'
    case 'monthly':
      return 'MĚSÍC'
    default:
      return null
  }
}

export function getRepeatIntervalLabel(
  repeatInterval: string | null | undefined
) {
  switch (repeatInterval) {
    case 'daily':
      return 'Každý den'
    case 'weekly':
      return 'Každý týden'
    case 'monthly':
      return 'Každý měsíc'
    default:
      return 'Bez opakování'
  }
}
