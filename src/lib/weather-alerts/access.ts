import 'server-only'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

type WeatherAccessProfile = {
  id: string
  name: string | null
  role: string | null
  can_view_weather_alerts: boolean | null
}

export async function getWeatherAlertsRuntimeContext(options?: {
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
    .select('id,name,role,can_view_weather_alerts')
    .eq('id', user.id)
    .single<WeatherAccessProfile>()

  if (error || !profile) {
    throw new Error('Nepodařilo se ověřit přístup k výstrahám počasí.')
  }
  if (!profile.can_view_weather_alerts) {
    if (options?.redirectOnDenied) redirect('/dashboard')
    throw new Error('Pro tuto sekci nemáte oprávnění.')
  }

  return { supabase, user, profile }
}
