export function getStatusLabel(status: string | null | undefined) {
  switch (status) {
    case 'todo':
      return 'K vyřízení'
    case 'in_progress':
      return 'Rozpracováno'
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
      return 'bg-gray-100 text-gray-800'
    case 'in_progress':
      return 'bg-blue-100 text-blue-800'
    case 'done':
      return 'bg-green-100 text-green-800'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

export function getPriorityBadgeClass(priority: string | null | undefined) {
  switch (priority) {
    case 'low':
      return 'bg-gray-100 text-gray-800'
    case 'medium':
      return 'bg-yellow-100 text-yellow-800'
    case 'high':
      return 'bg-red-100 text-red-800'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}