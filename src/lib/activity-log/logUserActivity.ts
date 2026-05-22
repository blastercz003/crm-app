import { createClient } from '@/lib/supabase/server'

type LogUserActivityInput = {
  action: string
  section?: string | null
  route?: string | null
  userId?: string | null
}

function normalizeText(value: string | null | undefined) {
  const trimmed = String(value ?? '').trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function logUserActivity(input: LogUserActivityInput) {
  try {
    const supabase = await createClient()

    const action = normalizeText(input.action)
    if (!action) return

    let actorUserId = normalizeText(input.userId)

    if (!actorUserId) {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      actorUserId = user?.id ?? null
    }

    if (!actorUserId) return

    const route = normalizeText(input.route)
    const section = normalizeText(input.section)
    const nowIso = new Date().toISOString()

    await supabase.from('user_activity_log').insert({
      user_id: actorUserId,
      route,
      section,
      action,
      created_at: nowIso,
    })

    await supabase
      .from('user_presence')
      .update({
        last_route: route,
        last_section: section,
        last_action: action,
        last_action_at: nowIso,
      })
      .eq('user_id', actorUserId)
  } catch {
    // Best effort logging only: never break primary action flow.
  }
}
