'use server'

import { createClient } from '@/lib/supabase/server'
import { ensureMeetingResultNotifications } from '@/lib/notifications/meetingNotifications'

export async function ensureDashboardMeetingResultNotificationsAction() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return

  await ensureMeetingResultNotifications({ supabase, userId: user.id })
}
