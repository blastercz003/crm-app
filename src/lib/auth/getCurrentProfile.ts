import { createClient } from '@/lib/supabase/server'

export type AppProfile = {
  id: string
  name: string | null
  role: string | null
}

export async function getCurrentProfile(): Promise<AppProfile> {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new Error('Uživatel není přihlášen.')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    throw new Error('Profil uživatele nebyl nalezen.')
  }

  return profile
}