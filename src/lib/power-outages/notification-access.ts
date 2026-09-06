import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

export type PowerOutageNotificationScope = 'all' | 'albert'

type AccessProfile = {
  id: string
  role: string | null
}

type ScopeRow = {
  scope_kind: PowerOutageNotificationScope
}

export async function getPowerOutageNotificationScope(
  supabase: SupabaseClient,
  profile: AccessProfile,
): Promise<PowerOutageNotificationScope | null> {
  if (profile.role === 'admin') return 'all'

  const { data, error } = await supabase
    .from('power_outage_notification_recipient_scopes')
    .select('scope_kind')
    .eq('user_id', profile.id)
    .eq('is_active', true)
    .maybeSingle<ScopeRow>()

  if (error) {
    throw new Error(`Oprávnění k upozorněním na odstávky se nepodařilo načíst: ${error.message}`)
  }

  return data?.scope_kind ?? null
}

