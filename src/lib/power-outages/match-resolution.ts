import 'server-only'

import { getServiceRoleClient } from '@/lib/supabase/service'

export async function resolvePowerOutageStoreMatch(input: {
  matchId: string
  status: 'confirmed' | 'needs_review' | 'dismissed'
  actorUserId: string
  note?: string | null
}) {
  const client = getServiceRoleClient()
  if (!client) throw new Error('Chybí serverové připojení pro úpravu shody odstávky.')

  const { data: current, error: currentError } = await client
    .from('power_outage_store_matches')
    .select('id,match_status')
    .eq('id', input.matchId)
    .maybeSingle<{ id: string; match_status: 'confirmed' | 'needs_review' | 'dismissed' }>()
  if (currentError) throw currentError
  if (!current) throw new Error('Požadovaná shoda odstávky neexistuje.')
  if (current.match_status === input.status) return { changed: false as const, status: input.status }

  const resolved = input.status === 'needs_review'
    ? { resolved_at: null, resolved_by: null }
    : { resolved_at: new Date().toISOString(), resolved_by: input.actorUserId }
  const { error: updateError } = await client
    .from('power_outage_store_matches')
    .update({ match_status: input.status, match_method: 'manual', ...resolved })
    .eq('id', input.matchId)
  if (updateError) throw updateError

  const { error: auditError } = await client
    .from('power_outage_match_audit')
    .insert({
      match_id: input.matchId,
      previous_status: current.match_status,
      next_status: input.status,
      actor_user_id: input.actorUserId,
      note: input.note?.trim().slice(0, 1_000) || null,
    })
  if (auditError) throw auditError

  return { changed: true as const, status: input.status }
}
