import { getServiceRoleClient } from '@/lib/supabase/service'
import {
  backfillDispatcherJobCalendarItemsForUser,
} from './dispatcher-calendar-feed'
import { backfillDispatcherGoogleCalendarItemsForUser } from './dispatcher-google-calendar'
import {
  isDispatcherCalendarSalesOwner,
  type DispatcherCalendarScope,
} from './dispatcher-calendar-scope'

type ActiveFeedRow = {
  user_id: string
  calendar_scope: DispatcherCalendarScope
}

type CalendarProfileRow = {
  id: string
  role: string | null
  can_view_jobs: boolean | null
  can_view_jobs_portal: boolean | null
  jobs_sales_scope: string | null
}

type ReconciliationResult = {
  kind: 'apple' | 'google'
  userId: string
  ok: boolean
  insertedCount?: number
  updatedCount?: number
  cancelledCount?: number
  error?: string
}

function getServiceClient() {
  const client = getServiceRoleClient()
  if (!client) {
    throw new Error('Chybí Supabase service role client pro opravu kalendářů zakázek.')
  }
  return client
}

function canReconcileFeed(feed: ActiveFeedRow, profile: CalendarProfileRow | null) {
  if (feed.calendar_scope === 'all_jobs') {
    return profile?.role === 'admin' || profile?.can_view_jobs === true
  }

  return (
    profile?.role !== 'admin' &&
    profile?.can_view_jobs_portal === true &&
    isDispatcherCalendarSalesOwner(profile.jobs_sales_scope)
  )
}

export async function reconcileActiveDispatcherCalendars(options: { forceGoogle?: boolean } = {}) {
  const supabase = getServiceClient()
  const [feedsResponse, googleResponse] = await Promise.all([
    supabase
      .from('dispatcher_job_calendar_feeds')
      .select('user_id, calendar_scope')
      .eq('enabled', true)
      .is('disabled_at', null),
    supabase
      .from('dispatcher_job_google_calendar_integrations')
      .select('user_id')
      .eq('enabled', true)
      .is('disabled_at', null),
  ])

  if (feedsResponse.error) {
    throw new Error(`Nepodařilo se načíst aktivní Apple kalendáře: ${feedsResponse.error.message}`)
  }
  if (googleResponse.error) {
    throw new Error(`Nepodařilo se načíst aktivní Google kalendáře: ${googleResponse.error.message}`)
  }

  const feeds = (feedsResponse.data ?? []) as ActiveFeedRow[]
  const googleUsers = (googleResponse.data ?? []).map((row) => String(row.user_id))
  const userIds = Array.from(new Set([...feeds.map((feed) => feed.user_id), ...googleUsers]))
  const { data: profiles, error: profilesError } = userIds.length
    ? await supabase
        .from('profiles')
        .select('id, role, can_view_jobs, can_view_jobs_portal, jobs_sales_scope')
        .in('id', userIds)
    : { data: [], error: null }

  if (profilesError) {
    throw new Error(`Nepodařilo se načíst profily kalendářů: ${profilesError.message}`)
  }

  const profilesById = new Map(
    ((profiles ?? []) as CalendarProfileRow[]).map((profile) => [profile.id, profile])
  )
  const results: ReconciliationResult[] = []

  for (const feed of feeds) {
    const profile = profilesById.get(feed.user_id) ?? null
    if (!canReconcileFeed(feed, profile)) {
      results.push({
        kind: 'apple',
        userId: feed.user_id,
        ok: false,
        error: 'Aktivní feed již nemá platné oprávnění nebo rozsah obchodníka.',
      })
      continue
    }

    try {
      const salesOwner = isDispatcherCalendarSalesOwner(profile?.jobs_sales_scope)
        ? profile.jobs_sales_scope
        : null
      const result = await backfillDispatcherJobCalendarItemsForUser(
        feed.user_id,
        feed.calendar_scope,
        salesOwner
      )
      results.push({ kind: 'apple', userId: feed.user_id, ok: true, ...result })
    } catch (error) {
      results.push({
        kind: 'apple',
        userId: feed.user_id,
        ok: false,
        error: error instanceof Error ? error.message : 'Neznámá chyba Apple kalendáře.',
      })
    }
  }

  for (const userId of googleUsers) {
    try {
      const result = await backfillDispatcherGoogleCalendarItemsForUser(userId, {
        force: options.forceGoogle === true,
      })
      results.push({ kind: 'google', userId, ok: true, ...result })
    } catch (error) {
      results.push({
        kind: 'google',
        userId,
        ok: false,
        error: error instanceof Error ? error.message : 'Neznámá chyba Google kalendáře.',
      })
    }
  }

  const failedCount = results.filter((result) => !result.ok).length
  return {
    ok: failedCount === 0,
    forceGoogle: options.forceGoogle === true,
    checkedCount: results.length,
    repairedCount: results.reduce(
      (sum, result) =>
        sum +
        (result.insertedCount ?? 0) +
        (result.updatedCount ?? 0) +
        (result.cancelledCount ?? 0),
      0
    ),
    failedCount,
    results,
  }
}
