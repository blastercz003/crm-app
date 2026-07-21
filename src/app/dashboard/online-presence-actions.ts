'use server'

import {
  getPresenceOverviewForAdmin,
  getUserActivityForAdmin,
  trackUserPresence,
  type PresencePeriod,
  type TrackPresenceInput,
} from '@/lib/dashboard/online-presence-service'

export async function trackUserPresenceAction(input?: TrackPresenceInput) {
  return trackUserPresence(input)
}

export async function getPresenceOverviewForAdminAction(period: PresencePeriod = 'today') {
  return getPresenceOverviewForAdmin(period)
}

export async function getUserActivityForAdminAction(
  userId: string,
  limit = 30,
  period: PresencePeriod = 'today'
) {
  return getUserActivityForAdmin(userId, limit, period)
}
