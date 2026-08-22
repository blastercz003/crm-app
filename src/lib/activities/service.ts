import 'server-only'

import { getActivityRuntimeContext } from '@/lib/activities/access'
import {
  getPragueDateKey,
  normalizeActivityDateBoundary,
} from '@/lib/activities/date'
import {
  ACTIVITY_ORIGINS,
  ACTIVITY_SOURCE_TYPES,
  ACTIVITY_STATUSES,
  type ActivityClientOption,
  type ActivityFilterOptions,
  type ActivityListFilters,
  type ActivityListItem,
  type ActivityListResult,
  type ActivityOrigin,
  type ActivityAdminReport,
  type ActivityReportInput,
  type ActivityOverview,
  type ActivityProfile,
  type ActivityRow,
  type ActivitySourceType,
  type ActivityStatus,
  type ActivityUserOption,
} from '@/lib/activities/types'

const DEFAULT_PAGE_SIZE = 30
const MAX_PAGE_SIZE = 100

function toPositiveInteger(value: number | undefined, fallback: number) {
  if (!Number.isFinite(value)) return fallback
  return Math.max(1, Math.floor(value ?? fallback))
}

function isOneOf<T extends string>(value: string | null | undefined, values: readonly T[]): value is T {
  return Boolean(value && values.includes(value as T))
}

function normalizeUuid(value: string | null | undefined) {
  const normalized = String(value ?? '').trim()
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null
}

function uniqueValues(values: Array<string | null>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

async function hydrateActivityRows(
  supabase: Awaited<ReturnType<typeof getActivityRuntimeContext>>['supabase'],
  rows: ActivityRow[],
) {
  const userIds = uniqueValues(rows.map((row) => row.user_id))
  const clientIds = uniqueValues(rows.map((row) => row.client_id))

  const [profilesResponse, clientsResponse] = await Promise.all([
    userIds.length
      ? supabase.from('profiles').select('id, name').in('id', userIds)
      : Promise.resolve({ data: [], error: null }),
    clientIds.length
      ? supabase.from('clients').select('id, name').in('id', clientIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (profilesResponse.error) {
    throw new Error(`Autory aktivit se nepodařilo načíst: ${profilesResponse.error.message}`)
  }

  if (clientsResponse.error) {
    throw new Error(`Klienty aktivit se nepodařilo načíst: ${clientsResponse.error.message}`)
  }

  const userNameById = new Map(
    ((profilesResponse.data ?? []) as Array<{ id: string; name: string | null }>).map((row) => [
      row.id,
      row.name,
    ]),
  )
  const clientNameById = new Map(
    ((clientsResponse.data ?? []) as Array<{ id: string; name: string | null }>).map((row) => [
      row.id,
      row.name,
    ]),
  )

  return rows.map<ActivityListItem>((row) => ({
    ...row,
    user_name: userNameById.get(row.user_id) ?? null,
    client_name: row.client_id ? clientNameById.get(row.client_id) ?? null : null,
  }))
}

export async function getActivities(
  filters: ActivityListFilters = {},
): Promise<ActivityListResult> {
  const { supabase, profile, isAdmin } = await getActivityRuntimeContext()
  const page = toPositiveInteger(filters.page, 1)
  const pageSize = Math.min(toPositiveInteger(filters.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE)
  const rangeFrom = (page - 1) * pageSize
  const rangeTo = rangeFrom + pageSize - 1

  let request = supabase
    .from('activities')
    .select('*', { count: 'exact' })
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })

  if (!isAdmin) {
    request = request.eq('user_id', profile.id)
  } else {
    const requestedUserId = normalizeUuid(filters.userId)
    if (requestedUserId) request = request.eq('user_id', requestedUserId)
  }

  const clientId = normalizeUuid(filters.clientId)
  if (clientId) request = request.eq('client_id', clientId)

  if (isOneOf(filters.origin, ACTIVITY_ORIGINS)) {
    request = request.eq('origin', filters.origin as ActivityOrigin)
  }

  const activityType = String(filters.activityType ?? '').trim().toLowerCase()
  if (activityType) request = request.eq('activity_type', activityType)

  if (isOneOf(filters.status, ACTIVITY_STATUSES)) {
    request = request.eq('status', filters.status as ActivityStatus)
  }

  if (isOneOf(filters.sourceType, ACTIVITY_SOURCE_TYPES)) {
    request = request.eq('source_type', filters.sourceType as ActivitySourceType)
  }

  const dateFrom = normalizeActivityDateBoundary(filters.dateFrom, false)
  const dateTo = normalizeActivityDateBoundary(filters.dateTo, true)
  if (dateFrom) request = request.gte('occurred_at', dateFrom)
  if (dateTo) request = request.lte('occurred_at', dateTo)

  const { data, error, count } = await request.range(rangeFrom, rangeTo)

  if (error) {
    throw new Error(`Aktivity se nepodařilo načíst: ${error.message}`)
  }

  const items = await hydrateActivityRows(supabase, (data ?? []) as ActivityRow[])
  const total = count ?? 0

  return {
    items,
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
    viewer: {
      id: profile.id,
      name: profile.name,
      isAdmin,
    },
  }
}

export async function getActivityOverview(filters: {
  userId?: string | null
  clientId?: string | null
} = {}): Promise<ActivityOverview> {
  const { supabase, profile, isAdmin } = await getActivityRuntimeContext()
  const requestedUserId = isAdmin ? normalizeUuid(filters.userId) : profile.id
  const clientId = normalizeUuid(filters.clientId)
  const todayKey = getPragueDateKey()
  const todayStart = normalizeActivityDateBoundary(todayKey, false)!
  const todayEnd = normalizeActivityDateBoundary(todayKey, true)!
  const nowIso = new Date().toISOString()

  let todayRequest = supabase
    .from('activities')
    .select('id', { count: 'exact', head: true })
    .gte('occurred_at', todayStart)
    .lte('occurred_at', todayEnd)
  let plannedRequest = supabase
    .from('activities')
    .select('*', { count: 'exact' })
    .eq('status', 'planned')
    .gte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true, nullsFirst: false })
    .limit(6)
  let overdueRequest = supabase
    .from('activities')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'planned')
    .lt('scheduled_for', nowIso)
  let lastActivityRequest = supabase
    .from('activities')
    .select('*')
    .order('occurred_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(1)

  if (requestedUserId) {
    todayRequest = todayRequest.eq('user_id', requestedUserId)
    plannedRequest = plannedRequest.eq('user_id', requestedUserId)
    overdueRequest = overdueRequest.eq('user_id', requestedUserId)
    lastActivityRequest = lastActivityRequest.eq('user_id', requestedUserId)
  }

  if (clientId) {
    todayRequest = todayRequest.eq('client_id', clientId)
    plannedRequest = plannedRequest.eq('client_id', clientId)
    overdueRequest = overdueRequest.eq('client_id', clientId)
    lastActivityRequest = lastActivityRequest.eq('client_id', clientId)
  }

  const [todayResponse, plannedResponse, overdueResponse, lastActivityResponse] =
    await Promise.all([
      todayRequest,
      plannedRequest,
      overdueRequest,
      lastActivityRequest,
    ])

  if (todayResponse.error || plannedResponse.error || overdueResponse.error || lastActivityResponse.error) {
    throw new Error('Souhrn aktivit se nepodařilo načíst.')
  }

  const hydrated = await hydrateActivityRows(supabase, [
    ...((plannedResponse.data ?? []) as ActivityRow[]),
    ...((lastActivityResponse.data ?? []) as ActivityRow[]),
  ])
  const plannedIds = new Set(((plannedResponse.data ?? []) as ActivityRow[]).map((row) => row.id))
  const lastActivityId = ((lastActivityResponse.data ?? []) as ActivityRow[])[0]?.id ?? null

  return {
    todayCount: todayResponse.count ?? 0,
    plannedCount: plannedResponse.count ?? 0,
    overdueCount: overdueResponse.count ?? 0,
    plannedItems: hydrated.filter((row) => plannedIds.has(row.id)),
    lastActivity: lastActivityId
      ? hydrated.find((row) => row.id === lastActivityId) ?? null
      : null,
  }
}

export async function getActivityFilterOptions(): Promise<ActivityFilterOptions> {
  const { supabase, profile, isAdmin } = await getActivityRuntimeContext()

  const clientsPromise = supabase
    .from('clients')
    .select('id, name')
    .order('name', { ascending: true })

  const usersPromise = isAdmin
    ? supabase
        .from('profiles')
        .select('id, name, role, can_view_activities')
        .or('role.eq.admin,can_view_activities.eq.true')
        .order('name', { ascending: true })
    : Promise.resolve({
        data: [profile],
        error: null,
      })

  const [clientsResponse, usersResponse] = await Promise.all([clientsPromise, usersPromise])

  if (clientsResponse.error) {
    throw new Error(`Klienty pro aktivity se nepodařilo načíst: ${clientsResponse.error.message}`)
  }

  if (usersResponse.error) {
    throw new Error(`Uživatele pro aktivity se nepodařilo načíst: ${usersResponse.error.message}`)
  }

  const clients = ((clientsResponse.data ?? []) as Array<{ id: string; name: string | null }>)
    .filter((row) => Boolean(row.name?.trim()))
    .map<ActivityClientOption>((row) => ({ id: row.id, name: row.name!.trim() }))

  const users = ((usersResponse.data ?? []) as ActivityProfile[])
    .filter((row) => Boolean(row.name?.trim()))
    .map<ActivityUserOption>((row) => ({ id: row.id, name: row.name!.trim() }))

  return { clients, users }
}

export async function getActivityAdminReport(
  input: ActivityReportInput,
): Promise<ActivityAdminReport> {
  const { supabase, isAdmin } = await getActivityRuntimeContext()
  if (!isAdmin) throw new Error('Přehled aktivit je dostupný pouze administrátorovi.')

  const selectedUserId = input.userId ? normalizeUuid(input.userId) : null
  if (input.userId && !selectedUserId) throw new Error('Vybraný uživatel není platný.')

  const dateFromIso = normalizeActivityDateBoundary(input.dateFrom, false)
  const dateToIso = normalizeActivityDateBoundary(input.dateTo, true)
  if (!dateFromIso || !dateToIso) throw new Error('Vyberte platné období reportu.')
  if (dateFromIso > dateToIso) throw new Error('Datum od musí být před datem do.')

  const rows: ActivityRow[] = []
  const batchSize = 1000
  const maximumRows = 20_000

  for (let offset = 0; offset < maximumRows; offset += batchSize) {
    let request = supabase
      .from('activities')
      .select('*')
      .gte('occurred_at', dateFromIso)
      .lte('occurred_at', dateToIso)
      .order('occurred_at', { ascending: false })
      .order('created_at', { ascending: false })

    if (selectedUserId) request = request.eq('user_id', selectedUserId)

    const { data, error } = await request.range(offset, offset + batchSize - 1)
    if (error) throw new Error(`Report aktivit se nepodařilo načíst: ${error.message}`)

    const batch = (data ?? []) as ActivityRow[]
    rows.push(...batch)
    if (batch.length < batchSize) break
    if (offset + batchSize >= maximumRows) {
      throw new Error('Report obsahuje více než 20 000 aktivit. Zvolte kratší období.')
    }
  }

  const items = await hydrateActivityRows(supabase, rows)
  const activeDays = new Set(items.map((item) => getPragueDateKey(new Date(item.occurred_at)))).size
  const summaries = new Map<string, {
    userName: string
    total: number
    manual: number
    automatic: number
    activeDays: Set<string>
    lastActivityAt: string | null
  }>()

  for (const item of items) {
    const current = summaries.get(item.user_id) ?? {
      userName: item.user_name ?? 'Neznámý uživatel',
      total: 0,
      manual: 0,
      automatic: 0,
      activeDays: new Set<string>(),
      lastActivityAt: null,
    }
    current.total += 1
    if (item.origin === 'manual') current.manual += 1
    else current.automatic += 1
    current.activeDays.add(getPragueDateKey(new Date(item.occurred_at)))
    if (!current.lastActivityAt || item.occurred_at > current.lastActivityAt) {
      current.lastActivityAt = item.occurred_at
    }
    summaries.set(item.user_id, current)
  }

  const userSummaries = [...summaries.entries()]
    .map(([userId, summary]) => ({
      userId,
      userName: summary.userName,
      total: summary.total,
      manual: summary.manual,
      automatic: summary.automatic,
      activeDays: summary.activeDays.size,
      lastActivityAt: summary.lastActivityAt,
    }))
    .sort((a, b) => b.total - a.total || a.userName.localeCompare(b.userName, 'cs'))

  return {
    dateFrom: input.dateFrom,
    dateTo: input.dateTo,
    selectedUserId,
    selectedUserName: selectedUserId
      ? items.find((item) => item.user_id === selectedUserId)?.user_name
        ?? (await supabase.from('profiles').select('name').eq('id', selectedUserId).maybeSingle<{ name: string | null }>()).data?.name
        ?? 'Neznámý uživatel'
      : null,
    total: items.length,
    manualCount: items.filter((item) => item.origin === 'manual').length,
    automaticCount: items.filter((item) => item.origin === 'automatic').length,
    activeDays,
    averagePerActiveDay: activeDays ? Math.round((items.length / activeDays) * 10) / 10 : 0,
    meetingCount: items.filter((item) => item.source_type === 'meeting').length,
    taskCount: items.filter((item) => item.source_type === 'task').length,
    offerCount: items.filter((item) => item.source_type === 'offer').length,
    withoutSourceCount: items.filter((item) => item.source_type === null).length,
    userSummaries,
    items,
  }
}
