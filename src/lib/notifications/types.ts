export type NotificationCategory =
  | 'assets'
  | 'tasks'
  | 'meetings'
  | 'offers'
  | 'jobs'
  | 'activities'
  | 'weather'
  | 'system'

export type NotificationPriority = 'low' | 'normal' | 'high'

export type NotificationRow = {
  id: string
  recipient_user_id: string
  actor_user_id: string | null
  category: NotificationCategory
  type: string
  title: string
  message: string | null
  entity_type: string | null
  entity_id: string | null
  href: string | null
  priority: NotificationPriority
  dedupe_key: string | null
  read_at: string | null
  archived_at: string | null
  created_at: string
  actor_name?: string | null
  recipient_name?: string | null
}

export type NotificationStatusFilter = 'active' | 'unread' | 'today' | 'archive'

export type NotificationCategoryFilter = 'all' | NotificationCategory
