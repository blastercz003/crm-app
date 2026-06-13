'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { reportActionError } from '@/lib/errors/reportActionError'

type UpdateCalendarMeetingDateInput = {
  meetingId: string
  start: string
}

function getPragueOffsetMinutes(dateUtc: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Prague',
    timeZoneName: 'shortOffset',
  })

  const parts = formatter.formatToParts(dateUtc)
  const timeZoneName = parts.find((part) => part.type === 'timeZoneName')?.value

  if (!timeZoneName) {
    throw new Error('Nepodařilo se určit časové pásmo Europe/Prague.')
  }

  if (timeZoneName === 'GMT' || timeZoneName === 'UTC') {
    return 0
  }

  const match = timeZoneName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)

  if (!match) {
    throw new Error('Nepodařilo se zpracovat offset časového pásma Europe/Prague.')
  }

  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? '0')

  return sign * (hours * 60 + minutes)
}

function convertPragueLocalDateTimeToUtcIsoString(localDateTime: string) {
  const match = localDateTime.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
  )

  if (!match) {
    throw new Error('Datum a čas schůzky má neplatný formát.')
  }

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr] = match

  const year = Number(yearStr)
  const month = Number(monthStr)
  const day = Number(dayStr)
  const hour = Number(hourStr)
  const minute = Number(minuteStr)

  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0))

  if (Number.isNaN(utcGuess.getTime())) {
    throw new Error('Datum a čas schůzky má neplatný formát.')
  }

  const offsetMinutes = getPragueOffsetMinutes(utcGuess)

  const correctedUtcDate = new Date(
    Date.UTC(year, month - 1, day, hour, minute, 0) - offsetMinutes * 60_000
  )

  if (Number.isNaN(correctedUtcDate.getTime())) {
    throw new Error('Datum a čas schůzky má neplatný formát.')
  }

  return correctedUtcDate.toISOString()
}

function normalizeCalendarMeetingDateTime(value: string) {
  const text = value.trim()

  if (!text) {
    throw new Error('Chybí nový termín schůzky.')
  }

  return convertPragueLocalDateTimeToUtcIsoString(text)
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

  let normalizedStart: string

  try {
    normalizedStart = normalizeCalendarMeetingDateTime(start)
  } catch (error) {
    await reportActionError({
      error,
      action: 'updateCalendarMeetingDate',
      section: 'calendar',
      errorType: 'CalendarMeetingDateParseError',
      userId: user.id,
      context: {
        meetingId,
        start,
      },
    })
    return {
      error:
        error instanceof Error
          ? error.message
          : 'Nový termín schůzky má neplatný formát.',
    }
  }

  const { error: updateError } = await supabase
    .from('meetings')
    .update({
      meeting_datetime: normalizedStart,
    })
    .eq('id', meetingId)

  if (updateError) {
    await reportActionError({
      error: updateError,
      action: 'updateCalendarMeetingDate',
      section: 'calendar',
      errorType: 'CalendarMeetingUpdateError',
      userId: user.id,
      context: {
        meetingId,
        start: normalizedStart,
      },
    })
    return {
      error: 'Nepodařilo se uložit nový termín schůzky.',
    }
  }

  revalidatePath('/calendar')
  revalidatePath('/dashboard')
  revalidatePath('/meetings')
  revalidatePath(`/meetings/${meetingId}`)
  revalidatePath(`/meetings/${meetingId}/edit`)

  return {
    success: true,
  }
}
