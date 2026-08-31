import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { isPowerOutageAutomationAuthorized } from './automation-auth'

export async function isPowerOutageRequestAuthorized(
  request: Request,
  options: { adminOnly?: boolean } = {},
) {
  if (isPowerOutageAutomationAuthorized(request)) return true

  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return false

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role,can_view_power_outages')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null; can_view_power_outages: boolean | null }>()

  if (profileError || !profile) return false
  if (profile.role === 'admin') return true
  return !options.adminOnly && profile.can_view_power_outages === true
}
