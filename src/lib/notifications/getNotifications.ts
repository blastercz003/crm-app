import { createClient } from '@/lib/supabase/server'
import type {
  NotificationCategory,
  NotificationCategoryFilter,
  NotificationRow,
  NotificationStatusFilter,
} from './types'

type SupabaseClient = Awaited<ReturnType<typeof createClient>>

type ProfileName = {
  id: string
  name: string | null
}

export function getPragueTodayIsoRange() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Prague',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const [year, month, day] = formatter.format(new Date()).split('-').map(Number)
  const start = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
  const offsetFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Prague',
    timeZoneName: 'shortOffset',
  })
  const timeZoneName = offsetFormatter
    .formatToParts(start)
    .find((part) => part.type === 'timeZoneName')?.value
  const match = timeZoneName?.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)
  const offsetMinutes = match
    ? (match[1] === '-' ? -1 : 1) *
      (Number(match[2]) * 60 + Number(match[3] ?? '0'))
    : 0

  const startUtc = new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMinutes * 60_000
  )
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000)

  return {
    start: startUtc.toISOString(),
    end: endUtc.toISOString(),
  }
}

export async function attachNotificationProfileNames(
  supabase: SupabaseClient,
  notifications: NotificationRow[]
) {
  const ids = Array.from(
    new Set(
      notifications
        .flatMap((notification) => [
          notification.actor_user_id,
          notification.recipient_user_id,
        ])
        .filter(Boolean) as string[]
    )
  )

  if (ids.length === 0) return notifications

  const { data } = await supabase.from('profiles').select('id, name').in('id', ids)
  const profileMap = new Map(
    ((data ?? []) as ProfileName[]).map((profile) => [profile.id, profile.name])
  )

  return notifications.map((notification) => ({
    ...notification,
    actor_name: notification.actor_user_id
      ? profileMap.get(notification.actor_user_id) ?? null
      : null,
    recipient_name: profileMap.get(notification.recipient_user_id) ?? null,
  }))
}

export async function getCurrentUserNotifications(params?: {
  limit?: number
  status?: NotificationStatusFilter
  category?: NotificationCategoryFilter
  search?: string
}) {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Uživatel není přihlášen.')
  }

  const limit = params?.limit ?? 50
  const status = params?.status ?? 'active'
  const category = params?.category ?? 'all'
  const search = params?.search?.trim()

  let query = supabase
    .from('notifications')
    .select(
      'id, recipient_user_id, actor_user_id, category, type, title, message, entity_type, entity_id, href, priority, dedupe_key, read_at, archived_at, created_at'
    )
    .eq('recipient_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status === 'active') {
    query = query.is('archived_at', null)
  } else if (status === 'unread') {
    query = query.is('read_at', null).is('archived_at', null)
  } else if (status === 'today') {
    const todayRange = getPragueTodayIsoRange()
    query = query
      .gte('created_at', todayRange.start)
      .lt('created_at', todayRange.end)
      .is('archived_at', null)
  } else if (status === 'archive') {
    query = query.not('archived_at', 'is', null)
  }

  if (category !== 'all') {
    query = query.eq('category', category as NotificationCategory)
  }

  if (search) {
    const escapedSearch = search.replaceAll('%', '\\%').replaceAll('_', '\\_')
    query = query.or(
      `title.ilike.%${escapedSearch}%,message.ilike.%${escapedSearch}%`
    )
  }

  const { data, error } = await query

  if (error) {
    throw new Error(`Nepodařilo se načíst notifikace: ${error.message}`)
  }

  return attachNotificationProfileNames(
    supabase,
    (data ?? []) as NotificationRow[]
  )
}

export async function getCurrentUserNotificationStats() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Uživatel není přihlášen.')
  }

  const todayRange = getPragueTodayIsoRange()

  const [unread, today, active, archived] = await Promise.all([
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', user.id)
      .is('read_at', null)
      .is('archived_at', null),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', user.id)
      .gte('created_at', todayRange.start)
      .lt('created_at', todayRange.end)
      .is('archived_at', null),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', user.id)
      .is('archived_at', null),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', user.id)
      .not('archived_at', 'is', null),
  ])

  const firstError = [unread.error, today.error, active.error, archived.error].find(Boolean)

  if (firstError) {
    throw new Error(`Nepodařilo se načíst statistiky notifikací: ${firstError.message}`)
  }

  return {
    unread: unread.count ?? 0,
    today: today.count ?? 0,
    active: active.count ?? 0,
    archived: archived.count ?? 0,
  }
}
