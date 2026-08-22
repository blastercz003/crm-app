import 'server-only'

import { redirect } from 'next/navigation'
import type { AppRole } from '@/lib/auth/access'
import { createClient } from '@/lib/supabase/server'
import type { ActivityProfile } from '@/lib/activities/types'

export type ActivityAccessFlags = {
  can_view_activities: boolean | null
}

export function canViewActivitiesSection(
  role: AppRole,
  flags?: Partial<ActivityAccessFlags> | null,
) {
  return role === 'admin' || Boolean(flags?.can_view_activities)
}

export async function getActivityRuntimeContext() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, name, role, can_view_activities')
    .eq('id', user.id)
    .single<ActivityProfile>()

  if (error || !profile) {
    throw new Error('Nepodařilo se ověřit oprávnění k aktivitám.')
  }

  if (!canViewActivitiesSection(profile.role, profile)) {
    redirect('/dashboard')
  }

  return {
    supabase,
    user,
    profile,
    isAdmin: profile.role === 'admin',
  }
}
