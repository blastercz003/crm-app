import 'server-only'

import { getActivityRuntimeContext } from '@/lib/activities/access'
import {
  getPragueDateKey,
  getPragueWeekDateKeys,
  normalizeActivityDateBoundary,
} from '@/lib/activities/date'
import type { ActivityListItem, ActivityRow } from '@/lib/activities/types'
import type { OfferStatus } from '@/lib/offers/types'
import { getStickyNoteCounts, getStickyNotes } from '@/lib/sticky-notes/service'
import { getServiceRoleClient } from '@/lib/supabase/service'
import { getAssignableUsers } from '@/lib/users/getAssignableUsers'
import type {
  ActivityWorkspaceData,
  ActivityWorkspaceMeeting,
  ActivityWorkspaceOffer,
  ActivityWorkspaceOfferStatusOption,
  ActivityWorkspaceJob,
  ActivityWorkspaceJobPeriod,
  ActivityWorkspaceJobStatus,
  ActivityWorkspaceTask,
  ActivityWorkspaceUser,
  ActivityWorkspaceFormOptions,
} from '@/lib/activities/workspace-types'

const WORKSPACE_LIMITS = {
  manualPlanned: 10,
  manualLogged: 10,
  systemHistory: 50,
  stickyNotes: 30,
  offers: 50,
  tasks: 50,
  meetings: 6,
  jobs: 50,
} as const

const APPROVAL_OFFER_STATUSES = [
  { value: 'submitted', label: 'Ke schválení', tone: 'blue' },
  { value: 'approved', label: 'Schválené', tone: 'green' },
  { value: 'changes_requested', label: 'Vrácené k úpravě', tone: 'amber' },
  { value: 'sent_to_client', label: 'Odeslané', tone: 'blue' },
  { value: 'in_progress', label: 'Rozpracované', tone: 'orange' },
] as const satisfies ReadonlyArray<Omit<ActivityWorkspaceOfferStatusOption, 'count'>>

const USER_OFFER_STATUSES = [
  { value: 'in_progress', label: 'V řešení', tone: 'orange' },
  { value: 'sent_to_client', label: 'Odeslané klientovi', tone: 'blue' },
  { value: 'ordered', label: 'Objednané', tone: 'green' },
  { value: 'rejected', label: 'Zamítnuté', tone: 'red' },
] as const satisfies ReadonlyArray<Omit<ActivityWorkspaceOfferStatusOption, 'count'>>

type WorkspaceProfileRow = {
  id: string
  name: string | null
  role: string | null
  can_view_activities: boolean | null
  can_view_offers: boolean | null
  can_view_jobs: boolean | null
  can_view_jobs_portal: boolean | null
  jobs_sales_scope: 'MICHAL' | 'LÍDA' | null
}

type WorkspaceTaskRow = {
  id: string
  title: string
  note: string | null
  status: string | null
  priority: string | null
  repeat_interval: string | null
  due_date: string | null
  created_at: string | null
  created_by: string | null
  assigned_to: string | null
  client_id: string | null
  company_name: string | null
  contact_person: string | null
}

type WorkspaceMeetingRow = {
  id: string
  title: string | null
  status: string | null
  meeting_datetime: string | null
  client_id: string | null
  company_name: string | null
  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null
  assigned_user_id: string | null
}

type WorkspaceOfferRow = {
  id: string
  offer_number: string
  title: string
  status: OfferStatus
  updated_at: string
  client_id: string
  created_by: string
}

type WorkspaceJobRow = {
  id: string
  job_number: string
  company_name: string
  sales_owner: 'JIŘÍ' | 'MICHAL' | 'LÍDA'
  start_at: string
  end_at: string
  technician_name: string | null
  generator_name: string | null
  site_address: string | null
  info_note: string | null
  job_status: ActivityWorkspaceJobStatus
  marny_vyjezd: boolean | null
  pohotovost: boolean | null
}

type CountResponse = {
  count: number | null
  error: { message: string } | null
}

function assertResponse(
  response: { error: { message: string } | null },
  label: string,
) {
  if (response.error) {
    throw new Error(`${label}: ${response.error.message}`)
  }
}

function countOf(response: CountResponse) {
  return response.count ?? 0
}

function normalizeUserName(name: string | null) {
  return name?.trim() || 'Uživatel'
}

const JOB_PERIODS: ActivityWorkspaceJobPeriod[] = ['today', 'this_week', 'next_week', 'next_30_days', 'all']
const JOB_STATUSES: Array<ActivityWorkspaceJobStatus | 'active' | 'all'> = ['active', 'all', 'nova', 'k_reseni', 'realizace', 'ukoncena', 'storno']

function addDaysToDateKey(value: string, days: number) {
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days, 12))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

function normalizeSalesOwner(name: string | null) {
  const normalized = name?.trim().toLocaleUpperCase('cs-CZ')
  return normalized === 'JIŘÍ' || normalized === 'MICHAL' || normalized === 'LÍDA' ? normalized : null
}

function activityItem(
  row: ActivityRow,
  userName: string,
  clientNames: Map<string, string | null>,
): ActivityListItem {
  return {
    ...row,
    user_name: userName,
    client_name: row.client_id ? clientNames.get(row.client_id) ?? null : null,
  }
}

export async function getActivitiesWorkspace(input: {
  selectedUserId?: string | null
  offerStatus?: string | null
  jobPeriod?: string | null
  jobStatus?: string | null
} = {}): Promise<ActivityWorkspaceData> {
  const { supabase, profile, isAdmin } = await getActivityRuntimeContext()
  const profilesClient = isAdmin ? getServiceRoleClient() : null

  if (isAdmin && !profilesClient) {
    throw new Error('Chybí serverové připojení pro načtení uživatelů pracovního přehledu.')
  }

  const [viewerProfileResponse, usersResponse] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, name, role, can_view_activities, can_view_offers, can_view_jobs, can_view_jobs_portal, jobs_sales_scope')
      .eq('id', profile.id)
      .single<WorkspaceProfileRow>(),
    isAdmin
      ? profilesClient!
          .from('profiles')
          .select('id, name, role, can_view_activities, can_view_offers, can_view_jobs, can_view_jobs_portal, jobs_sales_scope')
          .or('role.eq.admin,can_view_activities.eq.true')
          .order('name', { ascending: true })
      : Promise.resolve({
          data: [{ ...profile, can_view_offers: null, can_view_jobs: true, can_view_jobs_portal: false, jobs_sales_scope: null } as WorkspaceProfileRow],
          error: null,
        }),
  ])

  assertResponse(viewerProfileResponse, 'Oprávnění pracovního přehledu se nepodařilo načíst')
  assertResponse(usersResponse, 'Uživatele pracovního přehledu se nepodařilo načíst')

  const viewerProfile = viewerProfileResponse.data
  const availableProfiles = (usersResponse.data ?? []) as WorkspaceProfileRow[]
  const selectedProfile = isAdmin
    ? availableProfiles.find((item) => item.id === input.selectedUserId)
      ?? availableProfiles.find((item) => item.id === profile.id)
      ?? availableProfiles[0]
    : viewerProfile

  if (!viewerProfile || !selectedProfile) {
    throw new Error('Nepodařilo se určit uživatele pracovního přehledu.')
  }

  const selectedUser: ActivityWorkspaceUser = {
    id: selectedProfile.id,
    name: normalizeUserName(selectedProfile.name),
  }
  const userOptions: ActivityWorkspaceUser[] = availableProfiles.map((item) => ({
    id: item.id,
    name: normalizeUserName(item.name),
  }))

  const todayKey = getPragueDateKey()
  const weekKeys = getPragueWeekDateKeys()
  const todayStart = normalizeActivityDateBoundary(todayKey, false)
  const todayEnd = normalizeActivityDateBoundary(todayKey, true)
  const weekStart = normalizeActivityDateBoundary(weekKeys.start, false)
  const weekEnd = normalizeActivityDateBoundary(weekKeys.end, true)
  if (!todayStart || !todayEnd || !weekStart || !weekEnd) {
    throw new Error('Nepodařilo se určit dnešní datum pro pracovní přehled.')
  }
  const nowIso = new Date().toISOString()
  const taskOwnerFilter = `assigned_to.eq.${selectedUser.id},created_by.eq.${selectedUser.id}`

  const manualPlannedRequest = supabase
    .from('activities')
    .select('*', { count: 'exact' })
    .eq('user_id', selectedUser.id)
    .eq('origin', 'manual')
    .eq('status', 'planned')
    .is('deleted_at', null)
    .order('scheduled_for', { ascending: true, nullsFirst: false })
    .limit(WORKSPACE_LIMITS.manualPlanned)

  const manualLoggedRequest = supabase
    .from('activities')
    .select('*', { count: 'exact' })
    .eq('user_id', selectedUser.id)
    .eq('origin', 'manual')
    .in('status', ['logged', 'completed'])
    .is('deleted_at', null)
    .order('occurred_at', { ascending: false })
    .limit(WORKSPACE_LIMITS.manualLogged)

  let systemHistoryRequest = supabase
    .from('activities')
    .select('*', { count: 'exact' })
    .eq('origin', 'automatic')
    .is('deleted_at', null)
    .order('occurred_at', { ascending: false })
    .limit(WORKSPACE_LIMITS.systemHistory)

  if (!isAdmin) {
    systemHistoryRequest = systemHistoryRequest.eq('user_id', selectedUser.id)
  }

  let systemHistoryTodayRequest = supabase
    .from('activities')
    .select('id', { count: 'exact', head: true })
    .eq('origin', 'automatic')
    .is('deleted_at', null)
    .gte('occurred_at', todayStart)
    .lte('occurred_at', todayEnd)

  if (!isAdmin) {
    systemHistoryTodayRequest = systemHistoryTodayRequest.eq('user_id', selectedUser.id)
  }

  const tasksRequest = supabase
    .from('tasks')
    .select(`
      id,
      title,
      note,
      status,
      priority,
      repeat_interval,
      due_date,
      created_at,
      created_by,
      assigned_to,
      client_id,
      company_name,
      contact_person
    `, { count: 'exact' })
    .neq('status', 'done')
    .or(taskOwnerFilter)
    .order('due_date', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(WORKSPACE_LIMITS.tasks)

  const meetingsRequest = supabase
    .from('meetings')
    .select(`
      id,
      title,
      status,
      meeting_datetime,
      client_id,
      company_name,
      contact_person,
      contact_phone,
      contact_email,
      assigned_user_id
    `, { count: 'exact' })
    .eq('status', 'planned')
    .eq('assigned_user_id', selectedUser.id)
    .not('meeting_datetime', 'is', null)
    .gte('meeting_datetime', nowIso)
    .order('meeting_datetime', { ascending: true })
    .limit(WORKSPACE_LIMITS.meetings)

  const canViewOffers = isAdmin || Boolean(viewerProfile.can_view_offers)
  const viewingOwnProfile = selectedUser.id === profile.id
  const offersMode: ActivityWorkspaceData['offers']['mode'] = !canViewOffers
    ? 'hidden'
    : isAdmin && viewingOwnProfile
      ? 'approval'
      : 'in_progress'
  const offerStatusDefinitions = offersMode === 'approval'
    ? APPROVAL_OFFER_STATUSES
    : offersMode === 'in_progress'
      ? USER_OFFER_STATUSES
      : []
  const selectedOfferStatus = offerStatusDefinitions.find((option) => option.value === input.offerStatus)?.value
    ?? offerStatusDefinitions[0]?.value
    ?? null
  let offersRequest = supabase
    .from('offers')
    .select('id, offer_number, title, status, updated_at, client_id, created_by', {
      count: 'exact',
    })
    .order('updated_at', { ascending: false })
    .limit(WORKSPACE_LIMITS.offers)

  if (selectedOfferStatus) offersRequest = offersRequest.eq('status', selectedOfferStatus)
  if (offersMode === 'in_progress') {
    offersRequest = offersRequest
      .eq('created_by', selectedUser.id)
  }

  const offerStatusCountsRequest = canViewOffers
    ? Promise.all(offerStatusDefinitions.map((option) => {
        let request = supabase
          .from('offers')
          .select('id', { count: 'exact', head: true })
          .eq('status', option.value)
        if (offersMode === 'in_progress') request = request.eq('created_by', selectedUser.id)
        return request
      }))
    : Promise.resolve([])

  const emptyOffersResponse = {
    data: [] as WorkspaceOfferRow[],
    count: 0,
    error: null,
  }

  const hasScopedJobsPortalAccess = Boolean(
    viewerProfile.can_view_jobs_portal && viewerProfile.jobs_sales_scope,
  )
  const canViewJobs = isAdmin || Boolean(viewerProfile.can_view_jobs) || hasScopedJobsPortalAccess
  const jobsListHref: '/jobs' | '/jobs-portal' = !isAdmin && viewerProfile.can_view_jobs_portal
    ? '/jobs-portal'
    : '/jobs'
  const selectedJobPeriod = JOB_PERIODS.includes(input.jobPeriod as ActivityWorkspaceJobPeriod)
    ? input.jobPeriod as ActivityWorkspaceJobPeriod
    : 'this_week'
  const selectedJobStatus = JOB_STATUSES.includes(input.jobStatus as ActivityWorkspaceJobStatus | 'active' | 'all')
    ? input.jobStatus as ActivityWorkspaceJobStatus | 'active' | 'all'
    : 'all'
  const jobSalesOwner = isAdmin && viewingOwnProfile
    ? null
    : selectedProfile.jobs_sales_scope ?? normalizeSalesOwner(selectedProfile.name)
  let jobsRequest = supabase
    .from('jobs')
    .select('id, job_number, company_name, sales_owner, start_at, end_at, technician_name, generator_name, site_address, info_note, job_status, marny_vyjezd, pohotovost', { count: 'exact' })
    .order('start_at', { ascending: true })
    .limit(WORKSPACE_LIMITS.jobs)

  if (jobSalesOwner) jobsRequest = jobsRequest.eq('sales_owner', jobSalesOwner)
  if (selectedJobStatus === 'active') jobsRequest = jobsRequest.in('job_status', ['nova', 'k_reseni', 'realizace'])
  else if (selectedJobStatus !== 'all') jobsRequest = jobsRequest.eq('job_status', selectedJobStatus)

  const jobPeriodRange = selectedJobPeriod === 'today'
    ? { from: todayKey, to: todayKey }
    : selectedJobPeriod === 'this_week'
      ? weekKeys
      : selectedJobPeriod === 'next_week'
        ? { start: addDaysToDateKey(weekKeys.start, 7), end: addDaysToDateKey(weekKeys.end, 7) }
        : selectedJobPeriod === 'next_30_days'
          ? { from: todayKey, to: addDaysToDateKey(todayKey, 29) }
          : null
  if (jobPeriodRange) {
    const from = 'start' in jobPeriodRange ? jobPeriodRange.start : jobPeriodRange.from
    const to = 'end' in jobPeriodRange ? jobPeriodRange.end : jobPeriodRange.to
    jobsRequest = jobsRequest
      .lte('start_at', `${to}T23:59:59`)
      .gte('end_at', `${from}T00:00:00`)
  }

  const emptyJobsResponse = { data: [] as WorkspaceJobRow[], count: 0, error: null }
  const emptyJobsCountResponse = { data: null, count: 0, error: null }
  let jobsThisWeekRequest = supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })
    .lte('start_at', weekEnd)
    .gte('end_at', weekStart)
  let jobsTotalRequest = supabase
    .from('jobs')
    .select('id', { count: 'exact', head: true })

  if (jobSalesOwner) {
    jobsThisWeekRequest = jobsThisWeekRequest.eq('sales_owner', jobSalesOwner)
    jobsTotalRequest = jobsTotalRequest.eq('sales_owner', jobSalesOwner)
  }
  const canLoadSelectedJobs = canViewJobs && (isAdmin && viewingOwnProfile || Boolean(jobSalesOwner))

  const [
    manualPlannedResponse,
    manualLoggedResponse,
    systemHistoryResponse,
    activitiesThisWeekResponse,
    manualLoggedTodayResponse,
    systemTodayResponse,
    selectedSystemTodayResponse,
    tasksResponse,
    tasksDueTodayOrOverdueResponse,
    overdueTasksResponse,
    meetingsResponse,
    meetingsThisWeekResponse,
    meetingsTotalResponse,
    offersResponse,
    offerStatusCountsResponse,
    jobsResponse,
    jobsThisWeekResponse,
    jobsTotalResponse,
    stickyNotes,
    stickyCounts,
  ] = await Promise.all([
    manualPlannedRequest,
    manualLoggedRequest,
    systemHistoryRequest,
    supabase
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', selectedUser.id)
      .in('status', ['logged', 'completed'])
      .is('deleted_at', null)
      .gte('occurred_at', weekStart)
      .lte('occurred_at', weekEnd),
    supabase
      .from('activities')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', selectedUser.id)
      .eq('origin', 'manual')
      .in('status', ['logged', 'completed'])
      .is('deleted_at', null)
      .gte('occurred_at', todayStart)
      .lte('occurred_at', todayEnd),
    systemHistoryTodayRequest,
    isAdmin
      ? supabase
          .from('activities')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', selectedUser.id)
          .eq('origin', 'automatic')
          .is('deleted_at', null)
          .gte('occurred_at', todayStart)
          .lte('occurred_at', todayEnd)
      : Promise.resolve({ data: null, count: 0, error: null }),
    tasksRequest,
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'done')
      .or(taskOwnerFilter)
      .not('due_date', 'is', null)
      .lte('due_date', todayKey),
    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'done')
      .or(taskOwnerFilter)
      .not('due_date', 'is', null)
      .lt('due_date', todayKey),
    meetingsRequest,
    supabase
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'planned')
      .eq('assigned_user_id', selectedUser.id)
      .gte('meeting_datetime', weekStart)
      .lte('meeting_datetime', weekEnd),
    supabase
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_user_id', selectedUser.id),
    canViewOffers ? offersRequest : Promise.resolve(emptyOffersResponse),
    offerStatusCountsRequest,
    canLoadSelectedJobs
      ? jobsRequest
      : Promise.resolve(emptyJobsResponse),
    canLoadSelectedJobs ? jobsThisWeekRequest : Promise.resolve(emptyJobsCountResponse),
    canLoadSelectedJobs ? jobsTotalRequest : Promise.resolve(emptyJobsCountResponse),
    getStickyNotes({ view: 'active', limit: WORKSPACE_LIMITS.stickyNotes }),
    getStickyNoteCounts(),
  ])

  const responsesToCheck = [
    [manualPlannedResponse, 'Plánované aktivity se nepodařilo načíst'],
    [manualLoggedResponse, 'Ruční historie se nepodařila načíst'],
    [systemHistoryResponse, 'Poslední události se nepodařilo načíst'],
    [activitiesThisWeekResponse, 'Aktivity v tomto týdnu se nepodařilo spočítat'],
    [manualLoggedTodayResponse, 'Dnešní zapsané aktivity se nepodařilo spočítat'],
    [systemTodayResponse, 'Dnešní automatické záznamy se nepodařilo spočítat'],
    [selectedSystemTodayResponse, 'Dnešní automatické záznamy uživatele se nepodařilo spočítat'],
    [tasksResponse, 'Úkoly se nepodařilo načíst'],
    [tasksDueTodayOrOverdueResponse, 'Dnešní úkoly a úkoly po termínu se nepodařilo spočítat'],
    [overdueTasksResponse, 'Úkoly po termínu se nepodařilo spočítat'],
    [meetingsResponse, 'Schůzky se nepodařilo načíst'],
    [meetingsThisWeekResponse, 'Schůzky v tomto týdnu se nepodařilo spočítat'],
    [meetingsTotalResponse, 'Celkový počet schůzek se nepodařilo spočítat'],
    [offersResponse, 'Nabídky se nepodařilo načíst'],
    [jobsResponse, 'Zakázky se nepodařilo načíst'],
    [jobsThisWeekResponse, 'Zakázky v tomto týdnu se nepodařilo spočítat'],
    [jobsTotalResponse, 'Celkový počet zakázek se nepodařilo spočítat'],
  ] as const
  for (const [response, label] of responsesToCheck) assertResponse(response, label)
  offerStatusCountsResponse.forEach((response) => assertResponse(response, 'Počty stavů nabídek se nepodařilo načíst'))

  const manualPlannedRows = (manualPlannedResponse.data ?? []) as ActivityRow[]
  const manualLoggedRows = (manualLoggedResponse.data ?? []) as ActivityRow[]
  const systemRows = (systemHistoryResponse.data ?? []) as ActivityRow[]
  const taskRows = (tasksResponse.data ?? []) as WorkspaceTaskRow[]
  const meetingRows = (meetingsResponse.data ?? []) as WorkspaceMeetingRow[]
  const offerRows = (offersResponse.data ?? []) as WorkspaceOfferRow[]
  const jobRows = (jobsResponse.data ?? []) as WorkspaceJobRow[]
  const taskIds = taskRows.map((item) => item.id)
  const clientIds = [...new Set([
    ...manualPlannedRows.map((item) => item.client_id),
    ...manualLoggedRows.map((item) => item.client_id),
    ...systemRows.map((item) => item.client_id),
    ...taskRows.map((item) => item.client_id),
    ...meetingRows.map((item) => item.client_id),
    ...offerRows.map((item) => item.client_id),
  ].filter(Boolean))] as string[]
  const systemUserIds = [...new Set(systemRows.map((item) => item.user_id))]
  const taskNotificationsRequest = taskIds.length
    ? (isAdmin ? profilesClient! : supabase)
        .from('notifications')
        .select('entity_id')
        .eq('category', 'tasks')
        .eq('recipient_user_id', selectedUser.id)
        .in('entity_id', taskIds)
    : Promise.resolve({ data: [], error: null })

  const [clientsResponse, systemProfilesResponse, taskNotificationsResponse] = await Promise.all([
    clientIds.length
      ? supabase.from('clients').select('id, name').in('id', clientIds)
      : Promise.resolve({ data: [], error: null }),
    isAdmin && systemUserIds.length
      ? profilesClient!.from('profiles').select('id, name').in('id', systemUserIds)
      : Promise.resolve({
          data: [{ id: selectedProfile.id, name: selectedProfile.name }],
          error: null,
        }),
    taskNotificationsRequest,
  ])
  assertResponse(clientsResponse, 'Názvy klientů pracovního přehledu se nepodařilo načíst')
  assertResponse(systemProfilesResponse, 'Autoři posledních událostí se nepodařili načíst')
  assertResponse(taskNotificationsResponse, 'Notifikace úkolů se nepodařilo načíst')
  const clientNames = new Map(
    ((clientsResponse.data ?? []) as Array<{ id: string; name: string | null }>).map((item) => [
      item.id,
      item.name,
    ]),
  )
  const systemUserNames = new Map(
    ((systemProfilesResponse.data ?? []) as Array<{ id: string; name: string | null }>).map((item) => [
      item.id,
      normalizeUserName(item.name),
    ]),
  )
  const taskIdsWithNotification = new Set(
    ((taskNotificationsResponse.data ?? []) as Array<{ entity_id: string | null }>)
      .map((item) => item.entity_id)
      .filter((id): id is string => Boolean(id)),
  )

  const tasks: ActivityWorkspaceTask[] = taskRows.map((item) => ({
    id: item.id,
    title: item.title,
    note: item.note,
    status: item.status,
    priority: item.priority,
    repeatInterval: item.repeat_interval,
    hasNotification: taskIdsWithNotification.has(item.id),
    dueDate: item.due_date,
    createdAt: item.created_at,
    createdBy: item.created_by,
    assignedTo: item.assigned_to,
    clientId: item.client_id,
    clientName: item.client_id ? clientNames.get(item.client_id) ?? null : null,
    companyName: item.company_name,
    contactPerson: item.contact_person,
  }))
  const meetings: ActivityWorkspaceMeeting[] = meetingRows.map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    meetingDateTime: item.meeting_datetime,
    clientId: item.client_id,
    clientName: item.client_id ? clientNames.get(item.client_id) ?? null : null,
    companyName: item.company_name,
    contactPerson: item.contact_person,
    contactPhone: item.contact_phone,
    contactEmail: item.contact_email,
    assignedUserId: item.assigned_user_id,
  }))
  const offers: ActivityWorkspaceOffer[] = offerRows.map((item) => ({
    id: item.id,
    offerNumber: item.offer_number,
    title: item.title,
    status: item.status,
    updatedAt: item.updated_at,
    clientId: item.client_id,
    clientName: clientNames.get(item.client_id) ?? null,
    createdBy: item.created_by,
  }))
  const jobs: ActivityWorkspaceJob[] = jobRows.map((item) => ({
    id: item.id,
    jobNumber: item.job_number,
    companyName: item.company_name,
    salesOwner: item.sales_owner,
    startAt: item.start_at,
    endAt: item.end_at,
    technicianName: item.technician_name,
    generatorName: item.generator_name,
    siteAddress: item.site_address,
    jobStatus: item.job_status,
    marnyVyjezd: Boolean(item.marny_vyjezd),
    pohotovost: Boolean(item.pohotovost),
    hasInfo: Boolean(item.info_note?.trim()),
  }))

  const manualLoggedToday = countOf(manualLoggedTodayResponse)
  const systemToday = countOf(systemTodayResponse)
  const selectedSystemToday = isAdmin
    ? countOf(selectedSystemTodayResponse)
    : systemToday
  const activitiesThisWeek = countOf(activitiesThisWeekResponse)
  const tasksDueTodayOrOverdue = countOf(tasksDueTodayOrOverdueResponse)
  const overdueTasks = countOf(overdueTasksResponse)
  const activeTasks = countOf(tasksResponse)
  const meetingsThisWeek = countOf(meetingsThisWeekResponse)
  const meetingsTotal = countOf(meetingsTotalResponse)
  const upcomingMeetings = countOf(meetingsResponse)
  const offersTotal = countOf(offersResponse)
  const offerStatusOptions: ActivityWorkspaceOfferStatusOption[] = offerStatusDefinitions.map((option, index) => ({
    ...option,
    count: countOf(offerStatusCountsResponse[index] ?? { count: 0, error: null }),
  }))

  return {
    viewer: {
      id: profile.id,
      name: profile.name,
      isAdmin,
    },
    selectedUser,
    userOptions,
    kpis: {
      activitiesToday: manualLoggedToday + selectedSystemToday,
      activitiesThisWeek,
      tasksDueTodayOrOverdue,
      activeTasks,
      meetingsThisWeek,
      meetingsTotal,
      jobsThisWeek: countOf(jobsThisWeekResponse),
      jobsTotal: countOf(jobsTotalResponse),
    },
    manualActivities: {
      planned: manualPlannedRows.map((item) => activityItem(item, selectedUser.name, clientNames)),
      logged: manualLoggedRows.map((item) => activityItem(item, selectedUser.name, clientNames)),
      plannedTotal: countOf(manualPlannedResponse),
      loggedTotal: countOf(manualLoggedResponse),
    },
    systemHistory: {
      items: systemRows.map((item) => activityItem(
        item,
        systemUserNames.get(item.user_id) ?? 'Uživatel',
        clientNames,
      )),
      total: countOf(systemHistoryResponse),
      today: countOf(systemTodayResponse),
    },
    tasks: {
      items: tasks,
      activeTotal: activeTasks,
      overdueTotal: overdueTasks,
    },
    meetings: {
      items: meetings,
      upcomingTotal: upcomingMeetings,
      thisWeekTotal: meetingsThisWeek,
    },
    offers: {
      available: canViewOffers,
      mode: offersMode,
      selectedStatus: selectedOfferStatus,
      selectedStatusLabel: offerStatusDefinitions.find((option) => option.value === selectedOfferStatus)?.label ?? 'Nabídky',
      statusOptions: offerStatusOptions,
      items: offers,
      total: offersTotal,
    },
    jobs: {
      available: canViewJobs,
      canEdit: isAdmin,
      listHref: jobsListHref,
      selectedPeriod: selectedJobPeriod,
      selectedStatus: selectedJobStatus,
      items: jobs,
      total: countOf(jobsResponse),
    },
    stickyNotes: {
      items: stickyNotes.items,
      total: stickyNotes.total,
      counts: stickyCounts,
    },
  }
}

export async function getActivitiesWorkspaceFormOptions(): Promise<ActivityWorkspaceFormOptions> {
  const { supabase } = await getActivityRuntimeContext()
  const [users, clientsResponse, contactsResponse] = await Promise.all([
    getAssignableUsers(),
    supabase.from('clients').select('id, name').order('name', { ascending: true }),
    supabase
      .from('client_contacts')
      .select('id, client_id, name, phone, email, is_primary')
      .order('is_primary', { ascending: false })
      .order('name', { ascending: true }),
  ])

  if (clientsResponse.error) {
    throw new Error(`Klienty pracovních formulářů se nepodařilo načíst: ${clientsResponse.error.message}`)
  }
  if (contactsResponse.error) {
    throw new Error(`Kontakty pracovních formulářů se nepodařilo načíst: ${contactsResponse.error.message}`)
  }

  const contacts = (contactsResponse.data ?? []) as Array<{
    id: string
    client_id: string
    name: string
    phone: string | null
    email: string | null
    is_primary: boolean
  }>

  return {
    clients: ((clientsResponse.data ?? []) as Array<{ id: string; name: string | null }>)
      .filter((client): client is { id: string; name: string } => Boolean(client.name?.trim()))
      .map((client) => ({ id: client.id, name: client.name.trim() })),
    taskUsers: users.map((user) => ({ id: user.id, name: user.name, role: user.role })),
    taskContacts: contacts.map((contact) => ({
      id: contact.id,
      client_id: contact.client_id,
      name: contact.name,
      is_primary: contact.is_primary,
    })),
    meetingContacts: contacts,
  }
}
