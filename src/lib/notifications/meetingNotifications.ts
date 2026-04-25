import { createClient } from '@/lib/supabase/server'
import { createNotification } from './createNotification'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type MeetingNeedingResult = {
  id: string
  company_name: string | null
  title: string | null
  meeting_datetime: string | null
  assigned_user_id: string | null
}

export async function ensureMeetingResultNotifications(params: {
  supabase: SupabaseClient
  userId?: string
}) {
  const { supabase, userId } = params
  const nowIso = new Date().toISOString()

  let query = supabase
    .from('meetings')
    .select('id, company_name, title, meeting_datetime, assigned_user_id')
    .eq('status', 'planned')
    .lt('meeting_datetime', nowIso)
    .is('result_note', null)
    .not('assigned_user_id', 'is', null)
    .order('meeting_datetime', { ascending: false })
    .limit(50)

  if (userId) {
    query = query.eq('assigned_user_id', userId)
  }

  const { data, error } = await query

  if (error) {
    throw new Error(
      `Nepodařilo se připravit notifikace ke schůzkám: ${error.message}`
    )
  }

  const meetings = (data ?? []) as MeetingNeedingResult[]

  await Promise.all(
    meetings.map((meeting) =>
      createNotification({
        supabase,
        recipientUserId: meeting.assigned_user_id,
        actorUserId: null,
        category: 'meetings',
        type: 'meeting_needs_result',
        title: 'Doplň výsledek schůzky',
        message: `Schůzka ${meeting.company_name ?? meeting.title ?? 'bez názvu'} už proběhla. Doplň prosím výsledek schůzky.`,
        entityType: 'meeting',
        entityId: meeting.id,
        href: `/meetings/${meeting.id}`,
        priority: 'high',
        dedupeKey: `meeting_needs_result:${meeting.id}`,
        skipSelfNotification: false,
      })
    )
  )
}
