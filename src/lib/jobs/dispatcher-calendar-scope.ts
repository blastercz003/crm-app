export type DispatcherCalendarScope = 'all_jobs' | 'sales_owner'

export type DispatcherCalendarSalesOwner = 'MICHAL' | 'LÍDA'

export const DISPATCHER_CALENDAR_NAMES: Record<DispatcherCalendarScope, string> = {
  all_jobs: 'B-ENERGY VŠECHNY ZAKÁZKY',
  sales_owner: 'B-ENERGY MOJE ZAKÁZKY',
}

export function isDispatcherCalendarSalesOwner(
  value: string | null | undefined
): value is DispatcherCalendarSalesOwner {
  return value === 'MICHAL' || value === 'LÍDA'
}
