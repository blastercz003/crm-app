'use server'

import { revalidatePath } from 'next/cache'
import { requireDispatcherCalendarAccess } from '@/lib/jobs/dispatcher-calendar-access'
import {
  backfillDispatcherJobCalendarItemsForUser,
  ensureDispatcherJobCalendarFeed,
} from '@/lib/jobs/dispatcher-calendar-feed'
import { disconnectDispatcherGoogleCalendar } from '@/lib/jobs/dispatcher-google-calendar'

export type DispatcherCalendarActivationState = {
  success: boolean
  error: string | null
  feedPath?: string
  insertedCount?: number
}

export type DispatcherGoogleDisconnectState = {
  success: boolean
  error: string | null
  deletedCalendar?: boolean
}

export async function activateDispatcherCalendarAction(
  _previousState: DispatcherCalendarActivationState,
  _formData: FormData
): Promise<DispatcherCalendarActivationState> {
  void _previousState
  void _formData

  try {
    const { user, error } = await requireDispatcherCalendarAccess()
    if (!user) return { success: false, error }

    const feed = await ensureDispatcherJobCalendarFeed(user.id)
    const backfill = await backfillDispatcherJobCalendarItemsForUser(user.id)
    revalidatePath('/jobs')

    return {
      success: true,
      error: null,
      feedPath: `/api/dispatcher-job-calendars/${feed.token}`,
      insertedCount: backfill.insertedCount,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Nepodařilo se aktivovat dispečerský kalendář.',
    }
  }
}

export async function disconnectDispatcherGoogleCalendarAction(
  _previousState: DispatcherGoogleDisconnectState,
  _formData: FormData
): Promise<DispatcherGoogleDisconnectState> {
  void _previousState
  void _formData

  try {
    const { user, error } = await requireDispatcherCalendarAccess()
    if (!user) return { success: false, error }

    const result = await disconnectDispatcherGoogleCalendar(user.id)
    revalidatePath('/jobs')
    return {
      success: true,
      error: null,
      deletedCalendar: result.deletedCalendar,
    }
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : 'Nepodařilo se odpojit Google kalendář.',
    }
  }
}
