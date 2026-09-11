import 'server-only'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

type PowerOutageAccessProfile = {
  id: string
  name: string | null
  role: string | null
  can_view_power_outages: boolean | null
  can_view_markets: boolean | null
}

export async function getPowerOutageRuntimeContext(options?: {
  redirectOnDenied?: boolean
  requireMarkets?: boolean
  adminOnly?: boolean
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
    .select('id,name,role,can_view_power_outages,can_view_markets')
    .eq('id', user.id)
    .single<PowerOutageAccessProfile>()

  if (error || !profile) {
    throw new Error('Nepodařilo se ověřit přístup k plánovaným odstávkám.')
  }
  if (profile.role !== 'admin' && !profile.can_view_power_outages) {
    if (options?.redirectOnDenied) redirect('/dashboard')
    throw new Error('Pro tuto sekci nemáte oprávnění.')
  }
  if (options?.adminOnly && profile.role !== 'admin') {
    throw new Error('Tato provozní část je dostupná pouze administrátorům.')
  }
  if (options?.requireMarkets && profile.role !== 'admin' && !profile.can_view_markets) {
    if (options.redirectOnDenied) redirect('/power-outages?mode=complete')
    throw new Error('Pro režim MARKETY nemáte oprávnění.')
  }

  return { supabase, user, profile }
}
