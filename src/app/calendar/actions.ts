'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

type UpdateCalendarMeetingDateInput = {
  meetingId: string
  start: string
}

export async function updateCalendarMeetingDate({
  meetingId,
  start,
}: UpdateCalendarMeetingDateInput) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return {
      error: 'Pro úpravu schůzky musíte být přihlášený.',
    }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    return {
      error: 'Nepodařilo se ověřit uživatele.',
    }
  }

  const { data: meeting, error: meetingError } = await supabase
    .from('meetings')
    .select('id, assigned_user_id, created_by, status')
    .eq('id', meetingId)
    .single()

  if (meetingError || !meeting) {
    return {
      error: 'Schůzku se nepodařilo najít.',
    }
  }

  const isAdmin = profile.role === 'admin'
  const canEdit =
    isAdmin ||
    meeting.assigned_user_id === user.id ||
    meeting.created_by === user.id

  if (!canEdit) {
    return {
      error: 'Tuto schůzku nemůžete upravit.',
    }
  }

  if (meeting.status === 'completed') {
    return {
      error: 'Proběhlou schůzku nelze v kalendáři přesouvat.',
    }
  }

  const { error: updateError } = await supabase
    .from('meetings')
    .update({
      meeting_datetime: start,
    })
    .eq('id', meetingId)

  if (updateError) {
    return {
      error: 'Nepodařilo se uložit nový termín schůzky.',
    }
  }

  revalidatePath('/calendar')
  revalidatePath('/dashboard')
  revalidatePath('/meetings')
  revalidatePath(`/meetings/${meetingId}`)

  return {
    success: true,
  }
}