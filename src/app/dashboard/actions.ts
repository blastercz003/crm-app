'use server'

import { createClient } from '@/lib/supabase/server'

export async function markDashboardOverlaySeen() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Uživatel není přihlášen.')
  }

  const nowIso = new Date().toISOString()

  const { error } = await supabase
    .from('profiles')
    .update({
      last_seen_dashboard_at: nowIso,
      last_seen_updates_at: nowIso,
    })
    .eq('id', user.id)

  if (error) {
    throw new Error(`Nepodařilo se uložit stav dashboardu: ${error.message}`)
  }

  return { success: true }
}