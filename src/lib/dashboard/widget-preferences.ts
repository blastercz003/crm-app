export const DASHBOARD_QUICK_CREATE_ENABLED_KEY = 'dashboard.quick_create.enabled'
export const DASHBOARD_QUICK_NOTES_ENABLED_KEY = 'dashboard.quick_notes.enabled'

export function readDashboardQuickCreateEnabled(): boolean {
  if (typeof window === 'undefined') return true

  const rawValue = window.localStorage.getItem(DASHBOARD_QUICK_CREATE_ENABLED_KEY)

  if (rawValue === '0') return false
  if (rawValue === '1') return true
  return true
}

export function writeDashboardQuickCreateEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(
    DASHBOARD_QUICK_CREATE_ENABLED_KEY,
    enabled ? '1' : '0'
  )
  window.dispatchEvent(new Event('dashboard-widget-settings-changed'))
}

export function readDashboardQuickNotesEnabled(): boolean {
  if (typeof window === 'undefined') return true

  const rawValue = window.localStorage.getItem(DASHBOARD_QUICK_NOTES_ENABLED_KEY)

  if (rawValue === '0') return false
  if (rawValue === '1') return true
  return true
}

export function writeDashboardQuickNotesEnabled(enabled: boolean) {
  if (typeof window === 'undefined') return

  window.localStorage.setItem(
    DASHBOARD_QUICK_NOTES_ENABLED_KEY,
    enabled ? '1' : '0'
  )
  window.dispatchEvent(new Event('dashboard-widget-settings-changed'))
}
