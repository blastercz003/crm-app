import 'server-only'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

type PowerOutageAccessProfile = {
  id: string
  name: string | null
  role: string | null
  can_view_power_outages: boolean | null
}

export async function getPowerOutageRuntimeContext(options?: {
  redirectOnDenied?: boolean
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    if (options?.redirectOnDenied) redirect('/login')
    throw new Error('Pro tuto akci se musíte přihlásit.')
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id,name,role,can_view_power_outages')
    .eq('id', user.id)
    .single<PowerOutageAccessProfile>()

  if (error || !profile) {
    throw new Error('Nepodařilo se ověřit přístup k plánovaným odstávkám.')
  }
  if (profile.role !== 'admin' && !profile.can_view_power_outages) {
    if (options?.redirectOnDenied) redirect('/dashboard')
    throw new Error('Pro tuto sekci nemáte oprávnění.')
  }

  return { supabase, user, profile }
}
