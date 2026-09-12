import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { isPowerOutageAutomationAuthorized } from './automation-auth'

export async function isPowerOutageRequestAuthorized(
  request: Request,
  options: { adminOnly?: boolean; marketsOnly?: boolean; allowAutomation?: boolean } = {},
) {
  if (options.allowAutomation !== false && isPowerOutageAutomationAuthorized(request)) return true

  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()
  if (userError || !user) return false

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role,can_view_power_outages,can_view_markets')
    .eq('id', user.id)
    .maybeSingle<{ role: string | null; can_view_power_outages: boolean | null; can_view_markets: boolean | null }>()

  if (profileError || !profile) return false
  if (profile.role === 'admin') return true
  if (options.adminOnly || profile.can_view_power_outages !== true) return false
  return !options.marketsOnly || profile.can_view_markets === true
}
