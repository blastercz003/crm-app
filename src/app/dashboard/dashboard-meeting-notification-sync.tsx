'use client'

import { useEffect } from 'react'
import { ensureDashboardMeetingResultNotificationsAction } from './meeting-notifications-actions'

export function DashboardMeetingNotificationSync() {
  useEffect(() => {
    void ensureDashboardMeetingResultNotificationsAction().catch(() => {
      // Kontrola je doplňková; případně se bezpečně zopakuje při další návštěvě Dashboardu.
    })
  }, [])

  return null
}
