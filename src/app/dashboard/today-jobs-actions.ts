'use server'

import { getTodayJobsForDashboard } from '@/lib/dashboard/today-jobs-service'

export async function getTodayJobsForDashboardAction() {
  return getTodayJobsForDashboard()
}
