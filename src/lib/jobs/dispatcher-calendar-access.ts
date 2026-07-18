import { createClient } from '@/lib/supabase/server'

export async function requireDispatcherCalendarAccess() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, user: null, error: 'Nejsi přihlášený.' }
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, can_view_jobs')
    .eq('id', user.id)
    .single<{ role: string | null; can_view_jobs: boolean | null }>()

  if (error) {
    return {
      supabase,
      user: null,
      error: 'Nepodařilo se ověřit oprávnění uživatele.',
    }
  }

  if (profile?.role !== 'admin' && !profile?.can_view_jobs) {
    return {
      supabase,
      user: null,
      error: 'Nemáš oprávnění pro dispečerský kalendář.',
    }
  }

  return { supabase, user, error: null }
}
