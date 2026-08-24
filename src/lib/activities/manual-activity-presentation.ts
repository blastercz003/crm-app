import type { ActivityRecurrenceUnit, ActivityStatus } from './types'

const PRAGUE_TIME_ZONE = 'Europe/Prague'

export function manualActivityTypeLabel(activityType: string) {
  if (activityType === 'phone_call') return 'Telefon'
  if (activityType === 'email') return 'E-mail'
  if (activityType === 'in_person_meeting') return 'Kontakt'
  if (activityType === 'work_log') return 'Zápis'
  return 'Aktivita'
}

export function manualActivityStatusLabel(status: ActivityStatus) {
  if (status === 'planned') return 'Naplánováno'
  if (status === 'completed') return 'Dokončeno'
  if (status === 'cancelled') return 'Zrušeno'
  return 'Zapsáno'
}

export function manualActivityRecurrenceLabel(
  unit: ActivityRecurrenceUnit | null,
  interval: number | null,
) {
  if (!unit || !interval) return null
  if (interval === 1) {
    if (unit === 'day') return 'Každý den'
    if (unit === 'week') return 'Každý týden'
    return 'Každý měsíc'
  }

  if (unit === 'day') return `Každé ${interval} dny`
  if (unit === 'week') return `Každé ${interval} týdny`
  return `Každé ${interval} měsíce`
}

export function formatManualActivityDateTime(value: string | null, detailed = false) {
  if (!value) return 'Bez termínu'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Neznámý termín'

  return new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'short',
    year: detailed ? 'numeric' : undefined,
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PRAGUE_TIME_ZONE,
  }).format(date)
}
