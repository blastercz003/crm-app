'use server'

import { createClient } from '@/lib/supabase/server'

const ONLINE_WINDOW_MINUTES = 2
const PRAGUE_TIME_ZONE = 'Europe/Prague'
type PresencePeriod = 'today' | '7d' | '30d'

type PresenceRow = {
  user_id: string
  last_seen_at: string
  last_route: string | null
  last_section: string | null
  last_action: string | null
  last_action_at: string | null
}

type ProfileRow = {
  id: string
  name: string | null
}

type ActivityRow = {
  id: string
  user_id: string
  route: string | null
  section: string | null
  action: string | null
  created_at: string
}

function getPragueStartOfTodayIso() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(new Date())
  const year = Number(parts.find((part) => part.type === 'year')?.value ?? '')
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? '')
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? '')

  const noonUtcCarrier = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  return `${noonUtcCarrier.getUTCFullYear()}-${String(noonUtcCarrier.getUTCMonth() + 1).padStart(2, '0')}-${String(noonUtcCarrier.getUTCDate()).padStart(2, '0')}T00:00:00`
}

function getPeriodStartIso(period: PresencePeriod) {
  if (period === 'today') return getPragueStartOfTodayIso()
  const days = period === '7d' ? 7 : 30
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function isMissingTableError(error: { code?: string; message?: string } | null, table: string) {
  if (!error) return false
  if (error.code === '42P01') return true
  const message = String(error.message ?? '').toLowerCase()
  return message.includes(`relation "${table}" does not exist`)
}

async function requireAdmin() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { supabase, user: null, error: 'Uživatel není přihlášen.' }
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profileError || profile?.role !== 'admin') {
    return { supabase, user: null, error: 'Pouze admin může zobrazit online uživatele.' }
  }

  return { supabase, user, error: null }
}

export async function trackUserPresenceAction(input?: {
  route?: string | null
  section?: string | null
  action?: string | null
  addActivityLog?: boolean
}) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return { success: false, error: 'Uživatel není přihlášen.' }
    }

    const nowIso = new Date().toISOString()
    const route = String(input?.route ?? '').trim() || null
    const section = String(input?.section ?? '').trim() || null
    const action = String(input?.action ?? '').trim() || null

    const presencePatch: {
      user_id: string
      last_seen_at: string
      last_route: string | null
      last_section: string | null
      last_action?: string | null
      last_action_at?: string | null
    } = {
      user_id: user.id,
      last_seen_at: nowIso,
      last_route: route,
      last_section: section,
    }

    if (action) {
      presencePatch.last_action = action
      presencePatch.last_action_at = nowIso
    }

    const { error } = await supabase
      .from('user_presence')
      .upsert(presencePatch, { onConflict: 'user_id' })

    if (error) {
      if (isMissingTableError(error, 'user_presence')) {
        return { success: false, error: 'Chybí tabulka user_presence.' }
      }

      return { success: false, error: 'Nepodařilo se zapsat online stav.' }
    }

    if (input?.addActivityLog && action) {
      await supabase.from('user_activity_log').insert({
        user_id: user.id,
        route,
        section,
        action,
        created_at: nowIso,
      })
    }

    return { success: true, error: null }
  } catch {
    return { success: false, error: 'Nepodařilo se zapsat online stav.' }
  }
}

export async function getPresenceOverviewForAdminAction(period: PresencePeriod = 'today') {
  try {
    const { supabase, user, error: accessError } = await requireAdmin()
    if (!user) {
      return {
        success: false,
        error: accessError,
        onlineUsers: [],
        usersInPeriod: [],
      }
    }

    const periodStartIso = getPeriodStartIso(period)
    const { data: presenceRows, error: presenceError } = await supabase
      .from('user_presence')
      .select('user_id, last_seen_at, last_route, last_section, last_action, last_action_at')
      .gte('last_seen_at', periodStartIso)
      .neq('user_id', user.id)
      .order('last_seen_at', { ascending: false })

    if (presenceError) {
      if (isMissingTableError(presenceError, 'user_presence')) {
        return {
          success: false,
          error: 'Chybí tabulka user_presence.',
          onlineUsers: [],
          usersInPeriod: [],
        }
      }

      return {
        success: false,
        error: 'Nepodařilo se načíst online uživatele.',
        onlineUsers: [],
        usersInPeriod: [],
      }
    }

    const typedPresenceRows = (presenceRows ?? []) as PresenceRow[]
    const uniqueIds = Array.from(new Set(typedPresenceRows.map((row) => row.user_id).filter(Boolean)))

    if (uniqueIds.length === 0) {
      return {
        success: true,
        error: null,
        onlineUsers: [],
        usersInPeriod: [],
      }
    }

    const { data: profileRows, error: profileRowsError } = await supabase
      .from('profiles')
      .select('id, name')
      .in('id', uniqueIds)

    if (profileRowsError) {
      return {
        success: false,
        error: 'Nepodařilo se načíst jména uživatelů.',
        onlineUsers: [],
        usersInPeriod: [],
      }
    }

    const nowMs = Date.now()
    const onlineThresholdMs = nowMs - ONLINE_WINDOW_MINUTES * 60_000
    const profileMap = new Map(
      ((profileRows ?? []) as ProfileRow[]).map((row) => [row.id, row.name?.trim() || 'Uživatel'])
    )

    const usersInPeriod = typedPresenceRows.map((row) => ({
      id: row.user_id,
      name: profileMap.get(row.user_id) ?? 'Uživatel',
      lastSeenAt: row.last_seen_at,
      lastRoute: row.last_route ?? null,
      lastSection: row.last_section ?? null,
      lastAction: row.last_action ?? null,
      lastActionAt: row.last_action_at ?? null,
      isOnline: new Date(row.last_seen_at).getTime() >= onlineThresholdMs,
    }))

    const onlineUsers = usersInPeriod.filter((item) => item.isOnline)

    return {
      success: true,
      error: null,
      onlineUsers,
      usersInPeriod,
    }
  } catch {
    return {
      success: false,
      error: 'Nepodařilo se načíst online přehled.',
      onlineUsers: [],
      usersInPeriod: [],
    }
  }
}

export async function getUserActivityForAdminAction(
  userId: string,
  limit = 30,
  period: PresencePeriod = 'today'
) {
  try {
    const { supabase, user, error: accessError } = await requireAdmin()
    if (!user) {
      return { success: false, error: accessError, items: [] }
    }

    const normalizedUserId = String(userId ?? '').trim()
    if (!normalizedUserId) {
      return { success: false, error: 'Chybí ID uživatele.', items: [] }
    }

    const safeLimit = Math.max(5, Math.min(80, Number(limit) || 30))

    const periodStartIso = getPeriodStartIso(period)

    const { data, error } = await supabase
      .from('user_activity_log')
      .select('id, user_id, route, section, action, created_at')
      .eq('user_id', normalizedUserId)
      .gte('created_at', periodStartIso)
      .order('created_at', { ascending: false })
      .limit(safeLimit)

    if (error) {
      if (isMissingTableError(error, 'user_activity_log')) {
        return { success: false, error: 'Chybí tabulka user_activity_log.', items: [] }
      }

      return { success: false, error: 'Nepodařilo se načíst historii aktivit.', items: [] }
    }

    return {
      success: true,
      error: null,
      items: (data ?? []) as ActivityRow[],
    }
  } catch {
    return { success: false, error: 'Nepodařilo se načíst historii aktivit.', items: [] }
  }
}
