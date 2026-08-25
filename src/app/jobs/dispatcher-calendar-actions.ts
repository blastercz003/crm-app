'use server'

import { revalidatePath } from 'next/cache'
import { requireDispatcherCalendarAccess } from '@/lib/jobs/dispatcher-calendar-access'
import {
  backfillDispatcherJobCalendarItemsForUser,
  ensureDispatcherJobCalendarFeed,
} from '@/lib/jobs/dispatcher-calendar-feed'
import { disconnectDispatcherGoogleCalendar } from '@/lib/jobs/dispatcher-google-calendar'
import type { DispatcherCalendarScope } from '@/lib/jobs/dispatcher-calendar-scope'

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

async function activateCalendar(
  calendarScope: DispatcherCalendarScope
): Promise<DispatcherCalendarActivationState> {
  try {
    const { user, error, salesOwner } = await requireDispatcherCalendarAccess(calendarScope)
    if (!user) return { success: false, error }

    const feed = await ensureDispatcherJobCalendarFeed(user.id, calendarScope)
    const backfill = await backfillDispatcherJobCalendarItemsForUser(
      user.id,
      calendarScope,
      salesOwner
    )
    revalidatePath(calendarScope === 'sales_owner' ? '/jobs-portal' : '/jobs')

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

export async function activateDispatcherCalendarAction(
  _previousState: DispatcherCalendarActivationState,
  _formData: FormData
): Promise<DispatcherCalendarActivationState> {
  void _previousState
  void _formData
  return activateCalendar('all_jobs')
}

export async function activatePortalJobCalendarAction(
  _previousState: DispatcherCalendarActivationState,
  _formData: FormData
): Promise<DispatcherCalendarActivationState> {
  void _previousState
  void _formData
  return activateCalendar('sales_owner')
}

async function disconnectGoogleCalendar(
  calendarScope: DispatcherCalendarScope
): Promise<DispatcherGoogleDisconnectState> {
  try {
    const { user, error } = await requireDispatcherCalendarAccess(calendarScope)
    if (!user) return { success: false, error }

    const result = await disconnectDispatcherGoogleCalendar(user.id)
    revalidatePath(calendarScope === 'sales_owner' ? '/jobs-portal' : '/jobs')
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

export async function disconnectDispatcherGoogleCalendarAction(
  _previousState: DispatcherGoogleDisconnectState,
  _formData: FormData
): Promise<DispatcherGoogleDisconnectState> {
  void _previousState
  void _formData
  return disconnectGoogleCalendar('all_jobs')
}

export async function disconnectPortalJobGoogleCalendarAction(
  _previousState: DispatcherGoogleDisconnectState,
  _formData: FormData
): Promise<DispatcherGoogleDisconnectState> {
  void _previousState
  void _formData
  return disconnectGoogleCalendar('sales_owner')
}
