import { createClient } from '@/lib/supabase/server'
import {
  isDispatcherCalendarSalesOwner,
  type DispatcherCalendarScope,
} from './dispatcher-calendar-scope'

type CalendarAccessProfile = {
  role: string | null
  can_view_jobs: boolean | null
  can_view_jobs_portal: boolean | null
  jobs_sales_scope: string | null
}

export async function requireDispatcherCalendarAccess(
  calendarScope: DispatcherCalendarScope = 'all_jobs'
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, user: null, error: 'Nejsi přihlášený.' }
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, can_view_jobs, can_view_jobs_portal, jobs_sales_scope')
    .eq('id', user.id)
    .single<CalendarAccessProfile>()

  if (error) {
    return {
      supabase,
      user: null,
      error: 'Nepodařilo se ověřit oprávnění uživatele.',
    }
  }

  const hasAccess =
    calendarScope === 'all_jobs'
      ? profile?.role === 'admin' || profile?.can_view_jobs === true
      : profile?.role !== 'admin' &&
        profile?.can_view_jobs_portal === true &&
        isDispatcherCalendarSalesOwner(profile.jobs_sales_scope)

  if (!hasAccess) {
    return {
      supabase,
      user: null,
      error: 'Nemáš oprávnění pro dispečerský kalendář.',
    }
  }

  return {
    supabase,
    user,
    profile,
    calendarScope,
    salesOwner:
      calendarScope === 'sales_owner' &&
      isDispatcherCalendarSalesOwner(profile.jobs_sales_scope)
        ? profile.jobs_sales_scope
        : null,
    error: null,
  }
}
