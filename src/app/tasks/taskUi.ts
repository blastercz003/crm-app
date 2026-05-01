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
      return 'text-white'
    case 'done':
      return 'bg-green-100 text-green-800'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

export function getPriorityBadgeClass(priority: string | null | undefined) {
  switch (priority) {
    case 'low':
      return 'border border-zinc-200 bg-zinc-100 text-zinc-700'
    case 'medium':
      return 'border border-sky-200 bg-sky-100 text-sky-800'
    case 'high':
      return 'border border-red-200 bg-red-100 text-red-800'
    default:
      return 'border border-gray-200 bg-gray-100 text-gray-700'
  }
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
