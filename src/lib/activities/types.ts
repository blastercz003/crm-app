export const MANUAL_ACTIVITY_TYPES = [
  'phone_call',
  'email',
  'in_person_meeting',
  'work_log',
  'other',
] as const

export const ACTIVITY_ORIGINS = ['manual', 'automatic'] as const
export const ACTIVITY_STATUSES = ['logged', 'planned', 'completed', 'cancelled'] as const
export const ACTIVITY_SOURCE_TYPES = ['meeting', 'task', 'offer'] as const

export type ManualActivityType = (typeof MANUAL_ACTIVITY_TYPES)[number]
export type ActivityOrigin = (typeof ACTIVITY_ORIGINS)[number]
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number]
export type ActivitySourceType = (typeof ACTIVITY_SOURCE_TYPES)[number]
export type ActivityRecurrenceUnit = 'day' | 'week' | 'month'

export type ActivityProfile = {
  id: string
  name: string | null
  role: string | null
  can_view_activities: boolean | null
}

export type ActivityRow = {
  id: string
  user_id: string
  created_by: string
  client_id: string | null
  origin: ActivityOrigin
  activity_type: string
  title: string
  description: string | null
  status: ActivityStatus
  occurred_at: string
  scheduled_for: string | null
  completed_at: string | null
  completion_result: string | null
  reminder_enabled: boolean
  reminder_sent_at: string | null
  reminder_skipped_at: string | null
  recurrence_unit: ActivityRecurrenceUnit | null
  recurrence_interval: number | null
  recurrence_series_id: string | null
  recurrence_parent_id: string | null
  recurrence_anchor_at: string | null
  recurrence_sequence: number
  deleted_at: string | null
  deleted_by: string | null
  source_type: ActivitySourceType | null
  source_id: string | null
  source_event_key: string | null
  source_path: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type ActivityListItem = ActivityRow & {
  user_name: string | null
  client_name: string | null
}

export type ActivityListFilters = {
  page?: number
  pageSize?: number
  userId?: string | null
  clientId?: string | null
  origin?: ActivityOrigin | null
  activityType?: string | null
  status?: ActivityStatus | null
  sourceType?: ActivitySourceType | null
  dateFrom?: string | null
  dateTo?: string | null
}

export type ActivityListResult = {
  items: ActivityListItem[]
  total: number
  page: number
  pageSize: number
  pageCount: number
  viewer: {
    id: string
    name: string | null
    isAdmin: boolean
  }
}

export type ActivityClientOption = {
  id: string
  name: string
}

export type ActivityUserOption = {
  id: string
  name: string
}

export type ActivityFilterOptions = {
  clients: ActivityClientOption[]
  users: ActivityUserOption[]
}

export type ActivityOverview = {
  todayCount: number
  plannedCount: number
  overdueCount: number
  plannedItems: ActivityListItem[]
  lastActivity: ActivityListItem | null
}

export type ActivityReportOrigin = 'all' | ActivityOrigin

export type ActivityReportInput = {
  userId?: string | null
  dateFrom: string
  dateTo: string
  includeDeleted?: boolean
  originFilter?: ActivityReportOrigin
}

export type ActivityReportUserSummary = {
  userId: string
  userName: string
  total: number
  manual: number
  automatic: number
  activeDays: number
  lastActivityAt: string | null
}

export type ActivityAdminReport = {
  dateFrom: string
  dateTo: string
  includeDeleted: boolean
  originFilter: ActivityReportOrigin
  selectedUserId: string | null
  selectedUserName: string | null
  total: number
  manualCount: number
  automaticCount: number
  completedCount: number
  deletedCount: number
  withResultCount: number
  activeDays: number
  averagePerActiveDay: number
  meetingCount: number
  taskCount: number
  offerCount: number
  withoutSourceCount: number
  userSummaries: ActivityReportUserSummary[]
  items: ActivityListItem[]
}

export type ActivityReportActionResult = {
  success: boolean
  error: string | null
  report?: ActivityAdminReport
}

export type ActivityActionState = {
  success: boolean
  error: string | null
  activityId?: string
  nextActivityId?: string
}
