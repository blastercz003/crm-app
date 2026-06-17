import Image from 'next/image'
import Link from 'next/link'
import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { Plug } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getAssignableUsers } from '@/lib/users/getAssignableUsers'
import { endTaskRecurrence, updateTaskStatus } from '@/app/tasks/actions'
import { TaskCompleteButton } from '@/app/tasks/task-complete-button'
import { RepeatTaskBadge } from '@/app/tasks/repeat-task-badge'
import {
  formatTaskDueDateShort,
  getPriorityBadgeClass,
  getPriorityLabel,
  getTaskDueBadgeClass,
} from '@/app/tasks/taskUi'
import {
  MeetingStatusBadge,
  MeetingTaskBadge,
} from '@/components/meetings/meeting-status-badge'
import { DashboardUpdatesLauncher } from '@/components/dashboard/dashboard-updates-launcher'
import { DashboardMobileQuickActions } from '@/components/dashboard/dashboard-mobile-quick-actions'
import { DashboardMyOffersModule } from '@/components/dashboard/dashboard-my-offers-module'
import { DashboardMyTasksModule } from '@/components/dashboard/dashboard-my-tasks-module'
import { DashboardMyMeetingsModule } from '@/components/dashboard/dashboard-my-meetings-module'
import { DashboardSectionLinks } from '@/components/dashboard/dashboard-section-links'
import { DashboardHandoverProtocolUploadLauncher } from '@/components/dashboard/dashboard-handover-protocol-upload-launcher'
import {
  getCurrentUserNotificationStats,
  getCurrentUserNotifications,
} from '@/lib/notifications/getNotifications'
import { ensureMeetingResultNotifications } from '@/lib/notifications/meetingNotifications'
import { AppBadgeSync } from '@/components/pwa/app-badge-sync'
import { DashboardStartupReadyBridge } from '@/components/pwa/pwa-startup-screen'
import { getReceivedInvoiceBadgeCount } from '@/lib/received-invoices/service'
import { DashboardThemeToggle } from '@/components/dashboard/dashboard-theme-toggle'
import {
  DashboardGlobalSearchBody,
  DashboardGlobalSearchInput,
  DashboardGlobalSearchProvider,
} from './dashboard-global-search'
import {
  canViewHandoverProtocolUploadSection,
  isTechnikRole,
} from '@/lib/auth/access'
import {
  type ThemePreferences,
} from '@/lib/theme/theme-preference'
import { getServiceRoleClient } from '@/lib/supabase/service'
import {
  getHandoverProtocolUploadJobOptions,
  type HandoverProtocolUploadJobOption as DashboardHandoverProtocolUploadJobOption,
} from './handover-protocol-upload-actions'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Dashboard',
}

const PRAGUE_TIME_ZONE = 'Europe/Prague'
function TechnicianSectionLinks({
  canViewTechJobs,
  canViewConnectionPoints,
  canViewHandoverProtocolUpload,
  includeJobsLink,
  handoverProtocolUploadJobs,
}: {
  canViewTechJobs: boolean
  canViewConnectionPoints: boolean
  canViewHandoverProtocolUpload: boolean
  includeJobsLink?: boolean
  handoverProtocolUploadJobs: DashboardHandoverProtocolUploadJobOption[]
}) {
  const items = [
    canViewTechJobs
      ? {
          key: 'tech-jobs',
          href: '/zakazky-techniku',
          label: 'Moje zakázky',
          icon: (
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="6" width="18" height="14" rx="2.4" />
              <path d="M9 6V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V6" />
              <path d="M3 11h18" />
            </svg>
          ),
        }
      : null,
    includeJobsLink
      ? {
          key: 'jobs',
          href: '/jobs',
          label: 'Zakázky',
          icon: (
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="6" width="18" height="14" rx="2.4" />
              <path d="M9 6V4.8A1.8 1.8 0 0 1 10.8 3h2.4A1.8 1.8 0 0 1 15 4.8V6" />
              <path d="M3 11h18" />
            </svg>
          ),
        }
      : null,
    canViewConnectionPoints
      ? {
          key: 'connection-points',
          href: '/pripojne-body',
          label: 'Přípojné body',
          icon: (
            <Plug className="h-6 w-6" strokeWidth={1.9} />
          ),
        }
      : null,
  ].filter(Boolean) as Array<{
    key: string
    href: string
    label: string
    icon: ReactNode
  }>

  if (items.length === 0 && !canViewHandoverProtocolUpload) return null

  return (
    <section className="px-1 py-1 sm:px-2">
      <div className="grid grid-cols-3 gap-3 lg:flex lg:justify-center lg:gap-7">
        {items.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className="dashboard-section-link group relative flex min-h-[112px] min-w-0 flex-col items-center justify-center gap-2.5 overflow-visible rounded-2xl px-2 py-3 text-center text-[#0b1d2c] transition lg:w-[170px]"
          >
            <span className="dashboard-section-link__icon relative inline-flex h-[74px] w-[74px] items-center justify-center rounded-[18px] border border-[#2b6f9f]/95 bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] text-white shadow-[inset_0_1px_0_rgba(170,217,247,0.35),0_10px_22px_rgba(9,48,82,0.28)] backdrop-blur-xl transition-all duration-200 ease-out lg:h-[82px] lg:w-[82px] lg:group-hover:-translate-y-[2px]">
              {item.icon}
            </span>
            <span className="dashboard-section-link__label truncate text-[13px] font-semibold uppercase tracking-[0.01em] leading-tight lg:text-[15px]">
              {item.label}
            </span>
          </Link>
        ))}

        {canViewHandoverProtocolUpload ? (
          <DashboardHandoverProtocolUploadLauncher jobs={handoverProtocolUploadJobs} />
        ) : null}
      </div>
    </section>
  )
}

type ProfileRef = {
  id: string
  name: string | null
}

type DashboardProfile = {
  name: string | null
  role: string | null
  can_view_jobs: boolean | null
  can_view_jobs_portal: boolean | null
  can_view_offers: boolean | null
  can_view_tech_jobs: boolean | null
  can_view_connection_points: boolean | null
  can_view_handover_protocol_upload: boolean | null
  can_view_all_technician_handover_uploads: boolean | null
  david_dashboard_ikony: boolean | null
  dashboard_schovat_ukoly_a_schuzky: boolean | null
  dashboard_calendar: boolean | null
}

type DashboardThemePreference = {
  theme_mode: 'light' | 'dark' | 'auto' | null
  theme_auto_override_mode: 'light' | 'dark' | null
  theme_auto_override_until: string | null
}

type DashboardClientOption = {
  id: string
  name: string
}

type DashboardClientContactOption = {
  id: string
  client_id: string
  name: string
  phone: string | null
  email: string | null
  is_primary: boolean
}

type DashboardOfferOption = {
  id: string
  client_id: string
  offer_number: string
  title: string
}

type DashboardTask = {
  id: string
  title: string
  status: 'todo' | 'done'
  priority: string | null
  repeat_interval: string | null
  source: 'manual' | 'meeting' | null
  meeting_id: string | null
  company_name: string | null
  contact_person: string | null
  due_date: string | null
  created_at: string
  assigned_to: string | null
  created_by: string | null
  created_by_profile?: ProfileRef | null
}


type DashboardMeeting = {
  id: string
  company_name: string | null
  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null
  title: string | null
  meeting_datetime: string | null
  follow_up_task: string | null
  status: 'planned' | 'completed'
}

type DashboardOfferRow = {
  id: string
  offer_number: string
  title: string
  status:
    | 'draft'
    | 'submitted'
    | 'changes_requested'
    | 'approved'
    | 'sent_to_client'
    | 'in_progress'
    | 'ordered'
    | 'rejected'
  updated_at: string
  client_id: string
  created_by: string
}

type DashboardOfferCommentRow = {
  id: string
  offer_id: string
  author_user_id: string
  note: string
  created_at: string
}

function isMissingRepeatIntervalColumnError(error: {
  code?: string
  message?: string
} | null) {
  const message = String(error?.message ?? '').toLowerCase()

  return (
    error?.code === '42703' ||
    error?.code === 'PGRST204' ||
    (message.includes('repeat_interval') && message.includes('column'))
  )
}

type CalendarDay = {
  date: Date
  isoKey: string
  dayNumber: number
  isCurrentMonth: boolean
  isToday: boolean
  count: number
  jobs: DashboardJobCalendarRow[]
}

type DashboardJobCalendarRow = {
  id: string
  job_number: string
  start_at: string | null
  end_at: string | null
  site_address: string | null
  marny_vyjezd: boolean | null
}

type PragueDateParts = {
  year: number
  month: number
  day: number
}

function parseDate(value: string | null) {
  if (!value) return null

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return null
  }

  return date
}

function formatPragueDateTime(value: string | null) {
  if (!value) return 'Bez začátku'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Bez začátku'
  }

  return new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatPragueDateTimeCompact(value: string | null) {
  if (!value) return 'Bez termínu'

  const date = parseDate(value)

  if (!date) return 'Bez termínu'

  const dateParts = new Intl.DateTimeFormat('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    timeZone: PRAGUE_TIME_ZONE,
  }).formatToParts(date)
  const day = dateParts.find((part) => part.type === 'day')?.value ?? ''
  const month = dateParts.find((part) => part.type === 'month')?.value ?? ''

  const time = new Intl.DateTimeFormat('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PRAGUE_TIME_ZONE,
  }).format(date)

  return `${day}.${month}. ${time}`
}

function getJobCity(address: string | null) {
  const value = String(address ?? '').trim()

  if (!value) return 'Bez adresy'

  return value.split(',')[0]?.trim() || 'Bez adresy'
}

function getPragueOffsetMinutes(dateUtc: Date) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PRAGUE_TIME_ZONE,
    timeZoneName: 'shortOffset',
  })

  const parts = formatter.formatToParts(dateUtc)
  const timeZoneName = parts.find((part) => part.type === 'timeZoneName')?.value

  if (!timeZoneName) {
    throw new Error('Nepodařilo se určit časové pásmo Europe/Prague.')
  }

  if (timeZoneName === 'GMT' || timeZoneName === 'UTC') {
    return 0
  }

  const match = timeZoneName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/)

  if (!match) {
    throw new Error('Nepodařilo se zpracovat offset časového pásma Europe/Prague.')
  }

  const sign = match[1] === '-' ? -1 : 1
  const hours = Number(match[2])
  const minutes = Number(match[3] ?? '0')

  return sign * (hours * 60 + minutes)
}

function convertPragueLocalPartsToUtcIsoString(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
) {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second))

  if (Number.isNaN(utcGuess.getTime())) {
    throw new Error('Nepodařilo se vytvořit datum pro Europe/Prague.')
  }

  const offsetMinutes = getPragueOffsetMinutes(utcGuess)

  const correctedUtcDate = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000
  )

  if (Number.isNaN(correctedUtcDate.getTime())) {
    throw new Error('Nepodařilo se vytvořit datum pro Europe/Prague.')
  }

  return correctedUtcDate.toISOString()
}

function getPragueDateParts(date: Date): PragueDateParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = formatter.formatToParts(date)

  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const day = Number(parts.find((part) => part.type === 'day')?.value)

  return { year, month, day }
}

function getPragueWeekday(date: Date) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: PRAGUE_TIME_ZONE,
    weekday: 'short',
  }).format(date)

  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  }

  return map[weekday] ?? 1
}

function createDateCarrier(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
}

function addDaysToCarrier(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function toCarrierKey(date: Date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isSameCarrierDay(a: Date, b: Date) {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  )
}

function formatInPrague(
  value: string | null,
  options: Intl.DateTimeFormatOptions,
  fallback = 'Bez termínu'
) {
  const date = parseDate(value)

  if (!date) return fallback

  return new Intl.DateTimeFormat('cs-CZ', {
    ...options,
    timeZone: PRAGUE_TIME_ZONE,
  }).format(date)
}

function getTodayDateKeyInPrague() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function getSingleSearchParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? ''
  }

  return value ?? ''
}

function normalizeMonthOffset(value: string | string[] | undefined) {
  const parsed = Number(getSingleSearchParam(value))

  if (!Number.isFinite(parsed)) {
    return 0
  }

  return Math.max(-24, Math.min(24, Math.trunc(parsed)))
}

function getTaskPriorityOrder(task: DashboardTask, todayDateKey: string) {
  if (task.status === 'done') return 3
  if (task.due_date && task.due_date < todayDateKey) return 0
  if (task.due_date === todayDateKey) return 1
  return 2
}

function isDashboardTaskOverdue(task: DashboardTask, todayDateKey: string) {
  return (
    task.status !== 'done' &&
    task.due_date !== null &&
    task.due_date < todayDateKey
  )
}

function formatMeetingTime(value: string | null) {
  return formatInPrague(
    value,
    {
      hour: '2-digit',
      minute: '2-digit',
    },
    'Bez času'
  )
}

function getMeetingDateParts(value: string | null) {
  const date = parseDate(value)

  if (!date) {
    return {
      day: '--',
      month: 'bez data',
      time: 'Bez času',
    }
  }

  const day = new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    timeZone: PRAGUE_TIME_ZONE,
  }).format(date)

  const month = new Intl.DateTimeFormat('cs-CZ', {
    month: 'short',
    timeZone: PRAGUE_TIME_ZONE,
  }).format(date)

  const time = new Intl.DateTimeFormat('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: PRAGUE_TIME_ZONE,
  }).format(date)

  return { day, month, time }
}

function getCurrentWeekRange() {
  const now = new Date()
  const todayParts = getPragueDateParts(now)
  const weekday = getPragueWeekday(now)

  const todayCarrier = createDateCarrier(
    todayParts.year,
    todayParts.month,
    todayParts.day
  )

  const mondayCarrier = addDaysToCarrier(todayCarrier, -(weekday - 1))
  const nextMondayCarrier = addDaysToCarrier(mondayCarrier, 7)

  return {
    start: convertPragueLocalPartsToUtcIsoString(
      mondayCarrier.getUTCFullYear(),
      mondayCarrier.getUTCMonth() + 1,
      mondayCarrier.getUTCDate(),
      0,
      0,
      0
    ),
    end: convertPragueLocalPartsToUtcIsoString(
      nextMondayCarrier.getUTCFullYear(),
      nextMondayCarrier.getUTCMonth() + 1,
      nextMondayCarrier.getUTCDate(),
      0,
      0,
      0
    ),
  }
}

function getTodayRange() {
  const now = new Date()
  const todayParts = getPragueDateParts(now)
  const todayCarrier = createDateCarrier(
    todayParts.year,
    todayParts.month,
    todayParts.day
  )
  const tomorrowCarrier = addDaysToCarrier(todayCarrier, 1)

  return {
    start: convertPragueLocalPartsToUtcIsoString(
      todayCarrier.getUTCFullYear(),
      todayCarrier.getUTCMonth() + 1,
      todayCarrier.getUTCDate(),
      0,
      0,
      0
    ),
    end: convertPragueLocalPartsToUtcIsoString(
      tomorrowCarrier.getUTCFullYear(),
      tomorrowCarrier.getUTCMonth() + 1,
      tomorrowCarrier.getUTCDate(),
      0,
      0,
      0
    ),
  }
}

function addMonthsToCarrier(value: Date, months: number) {
  const next = new Date(value)
  next.setUTCMonth(next.getUTCMonth() + months)
  return next
}

function getMonthRange(monthOffset = 0) {
  const now = new Date()
  const { year, month } = getPragueDateParts(now)
  const baseCarrier = createDateCarrier(year, month, 1)
  const targetCarrier = addMonthsToCarrier(baseCarrier, monthOffset)
  const targetYear = targetCarrier.getUTCFullYear()
  const targetMonth = targetCarrier.getUTCMonth() + 1

  const nextMonthCarrier = addMonthsToCarrier(targetCarrier, 1)

  return {
    start: convertPragueLocalPartsToUtcIsoString(targetYear, targetMonth, 1, 0, 0, 0),
    end: convertPragueLocalPartsToUtcIsoString(
      nextMonthCarrier.getUTCFullYear(),
      nextMonthCarrier.getUTCMonth() + 1,
      1,
      0,
      0,
      0
    ),
  }
}

function getCalendarDays(jobs: DashboardJobCalendarRow[], monthOffset = 0): CalendarDay[] {
  const now = new Date()
  const todayParts = getPragueDateParts(now)
  const todayCarrier = createDateCarrier(
    todayParts.year,
    todayParts.month,
    todayParts.day
  )

  const baseCarrier = createDateCarrier(todayParts.year, todayParts.month, 1)
  const monthStartCarrier = addMonthsToCarrier(baseCarrier, monthOffset)
  const nextMonthCarrier = createDateCarrier(
    monthStartCarrier.getUTCMonth() === 11
      ? monthStartCarrier.getUTCFullYear() + 1
      : monthStartCarrier.getUTCFullYear(),
    monthStartCarrier.getUTCMonth() === 11 ? 1 : monthStartCarrier.getUTCMonth() + 2,
    1
  )
  const monthEndCarrier = addDaysToCarrier(nextMonthCarrier, -1)

  const startWeekday = getPragueWeekday(
    new Date(
      convertPragueLocalPartsToUtcIsoString(
        monthStartCarrier.getUTCFullYear(),
        monthStartCarrier.getUTCMonth() + 1,
        monthStartCarrier.getUTCDate(),
        12,
        0,
        0
      )
    )
  )

  const calendarStart = addDaysToCarrier(monthStartCarrier, -(startWeekday - 1))

  const endWeekday = getPragueWeekday(
    new Date(
      convertPragueLocalPartsToUtcIsoString(
        monthEndCarrier.getUTCFullYear(),
        monthEndCarrier.getUTCMonth() + 1,
        monthEndCarrier.getUTCDate(),
        12,
        0,
        0
      )
    )
  )

  const calendarEnd = addDaysToCarrier(monthEndCarrier, 7 - endWeekday)

  const jobsByDay = new Map<string, DashboardJobCalendarRow[]>()

  for (const job of jobs) {
    if (job.marny_vyjezd) continue

    const jobDate = parseDate(job.start_at)
    if (!jobDate) continue

    const jobParts = getPragueDateParts(jobDate)
    const key = toCarrierKey(
      createDateCarrier(jobParts.year, jobParts.month, jobParts.day)
    )

    const existing = jobsByDay.get(key) ?? []
    existing.push(job)
    jobsByDay.set(key, existing)
  }

  const days: CalendarDay[] = []
  let cursor = new Date(calendarStart)

  while (cursor.getTime() <= calendarEnd.getTime()) {
    const key = toCarrierKey(cursor)

    days.push({
      date: new Date(cursor),
      isoKey: key,
      dayNumber: cursor.getUTCDate(),
      isCurrentMonth: cursor.getUTCMonth() === monthStartCarrier.getUTCMonth(),
      isToday: isSameCarrierDay(cursor, todayCarrier),
      count: jobsByDay.get(key)?.length ?? 0,
      jobs: jobsByDay.get(key) ?? [],
    })

    cursor = addDaysToCarrier(cursor, 1)
  }

  return days
}

function DashboardSectionHeader({
  eyebrow,
  title,
  href,
  description,
}: {
  eyebrow: string
  title: string
  href?: string
  description?: string
}) {
  return (
    <div>
      <div className="dashboard-section-header__eyebrow text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
        {eyebrow}
      </div>
      {href ? (
        <Link
          href={href}
          className="dashboard-section-header__link group mt-2 inline-flex items-center gap-2 text-2xl font-semibold tracking-tight text-zinc-950 transition duration-200 ease-out hover:-translate-y-[1px] hover:text-[#2f6f9f]"
        >
          <span className="dashboard-section-header__title">{title}</span>
          <span
            aria-hidden
            className="dashboard-section-header__arrow inline-flex h-7 w-7 items-center justify-center rounded-full border border-[#2f2f2f]/95 bg-[linear-gradient(160deg,rgba(38,38,38,0.95)_0%,rgba(20,20,20,0.96)_45%,rgba(8,8,8,0.98)_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.16),0_6px_12px_rgba(0,0,0,0.26)] transition duration-200 ease-out group-hover:-translate-y-[1px] group-hover:border-[#1f5f8e] group-hover:bg-[linear-gradient(160deg,rgba(60,132,186,0.95)_0%,rgba(41,117,174,0.96)_45%,rgba(26,92,146,0.98)_100%)] group-hover:shadow-[inset_0_1px_0_rgba(170,217,247,0.36),0_9px_16px_rgba(9,48,82,0.30)]"
          >
            <span className="-translate-y-[1px] text-[18px] leading-none">›</span>
          </span>
        </Link>
      ) : (
        <h2 className="dashboard-section-header__title mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
          {title}
        </h2>
      )}
      {description ? (
        <p className="dashboard-section-header__description mt-1.5 text-sm text-zinc-500">{description}</p>
      ) : null}
    </div>
  )
}

function DashboardUserPanel({
  profileName,
  profileRole,
  userEmail,
  className = '',
}: {
  profileName: string | null
  profileRole: string | null
  userEmail: string
  className?: string
}) {
  return (
    <div
      className={[
        'dashboard-user-panel flex w-full flex-col gap-2 rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.86)_100%)] px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_22px_rgba(15,23,42,0.10)] sm:flex-row sm:items-center sm:justify-between',
        className,
      ].join(' ')}
    >
      <div className="dashboard-user-panel__details min-w-0 flex-1 text-[10px] leading-4 text-zinc-500">
        <div className="truncate">
          Uživatel:{' '}
          <span className="dashboard-user-panel__value font-medium text-zinc-900">
            {profileName ?? userEmail}
          </span>
        </div>
        <div className="truncate">
          Role:{' '}
          <span className="dashboard-user-panel__value font-medium uppercase text-zinc-900">
            {profileRole ?? 'neuvedeno'}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Link
          href="/settings/password"
          className="dashboard-control inline-flex h-8 items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 text-[10px] font-medium uppercase tracking-[0.04em] text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:text-zinc-900 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]"
        >
          NASTAVENÍ
        </Link>

        <form action="/auth/signout" method="post" className="shrink-0">
          <button className="dashboard-control dashboard-control--dark inline-flex h-8 w-full items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-3 text-[10px] font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_20px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-800 sm:w-auto">
            ODHLÁSIT
          </button>
        </form>
      </div>
    </div>
  )
}

function DashboardTaskItem({ task }: { task: DashboardTask }) {
  const todayDateKeyInPrague = getTodayDateKeyInPrague()
  const markTaskDoneAction = updateTaskStatus.bind(null, task.id, 'done')
  const endTaskRecurrenceAction = endTaskRecurrence.bind(null, task.id)
  const dueDate = task.due_date
  const hasDueDate = Boolean(dueDate)
  const isToday = dueDate !== null && dueDate === todayDateKeyInPrague
  const isOverdue =
    task.status !== 'done' &&
    dueDate !== null &&
    dueDate < todayDateKeyInPrague

  return (
    <div className="dashboard-task-item relative rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_22px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px]">
      <Link
        href={`/tasks/${task.id}`}
        className="absolute inset-0 rounded-2xl"
        aria-label={`Otevřít úkol ${task.title}`}
      />

      <div className="flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 pr-2">
            <div
              className="dashboard-task-item__title line-clamp-2 min-h-10 break-words text-sm font-semibold leading-5 text-zinc-900"
              title={task.title}
            >
              {task.title}
            </div>
          </div>

          <div className="relative z-10 flex min-h-[1.75rem] w-44 shrink-0 flex-wrap justify-end gap-1.5">
            {hasDueDate ? (
              <span
                className={`inline-flex h-6 w-[74px] shrink-0 items-center justify-center rounded-full px-2.5 py-1 text-xs font-medium ${getTaskDueBadgeClass({
                  hasDueDate,
                  isToday,
                  isOverdue,
                })}`}
              >
                <span className="text-center">{formatTaskDueDateShort(dueDate)}</span>
              </span>
            ) : null}

            {task.priority ? (
              <span
                className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium ${getPriorityBadgeClass(task.priority)}`}
              >
                {getPriorityLabel(task.priority)}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
          {task.repeat_interval ? (
            <div className="relative z-10">
              <RepeatTaskBadge repeatInterval={task.repeat_interval} />
            </div>
          ) : null}

          <div className="relative z-10 ml-auto flex min-w-0 flex-wrap justify-end gap-2">
            {task.status !== 'done' ? (
              <>
                {task.repeat_interval ? (
                  <form action={endTaskRecurrenceAction}>
                    <button
                      type="submit"
                      className="dashboard-control inline-flex items-center justify-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-3 py-2 text-xs font-medium text-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_22px_rgba(15,23,42,0.12)]"
                    >
                      UKONČIT
                    </button>
                  </form>
                ) : null}

                <form action={markTaskDoneAction}>
                  <TaskCompleteButton
                    className="inline-flex h-8 items-center justify-center rounded-xl border border-emerald-400/90 bg-[linear-gradient(155deg,#16a46f_0%,#0e9a68_100%)] px-3 text-[11px] font-bold uppercase text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_8px_18px_rgba(16,185,129,0.2)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_12px_22px_rgba(16,185,129,0.24)]"
                  />
                </form>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

function DashboardMeetingItem({ meeting }: { meeting: DashboardMeeting }) {
  const hasTask = Boolean(meeting.follow_up_task?.trim())
  const { day, month, time } = getMeetingDateParts(meeting.meeting_datetime)

  return (
    <Link
      href={`/meetings/${meeting.id}`}
      className="dashboard-meeting-item block rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_22px_rgba(15,23,42,0.10)] transition duration-200 hover:-translate-y-[1px]"
    >
      <div className="flex items-start gap-3">
        <div className="dashboard-meeting-item__date flex w-[64px] shrink-0 flex-col items-center rounded-xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-2 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)]">
          <div className="dashboard-meeting-item__day text-xl font-semibold leading-none text-zinc-950">
            {day}
          </div>
          <div className="dashboard-meeting-item__month mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            {month}
          </div>
          <div className="mt-2 w-full rounded-lg border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.94)_0%,rgba(241,245,249,0.88)_100%)] px-1.5 py-1 text-[11px] font-medium text-zinc-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
            {time}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div
                className="dashboard-meeting-item__title truncate text-sm font-semibold text-zinc-900"
                title={meeting.company_name ?? 'Bez firmy'}
              >
                {meeting.company_name ?? 'Bez firmy'}
              </div>

              <div className="dashboard-meeting-item__meta mt-0.5 truncate text-sm text-zinc-600">
                {meeting.contact_person ?? meeting.title ?? 'Bez kontaktní osoby'}
              </div>

              <div className="dashboard-meeting-item__submeta mt-1 text-[11px] text-zinc-500">
                {meeting.contact_phone ?? '—'}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-1.5">
              <MeetingStatusBadge status={meeting.status} />
              {hasTask ? <MeetingTaskBadge /> : null}
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

function DashboardMiniCalendar({
  jobs,
  monthOffset,
}: {
  jobs: DashboardJobCalendarRow[]
  monthOffset: number
}) {
  const now = new Date()
  const monthDate = addMonthsToCarrier(
    createDateCarrier(
      getPragueDateParts(now).year,
      getPragueDateParts(now).month,
      1
    ),
    monthOffset
  )
  const monthLabel = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    month: 'long',
    year: 'numeric',
  }).format(monthDate)

  const calendarDays = getCalendarDays(jobs, monthOffset)
  const weekdayLabels = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']
  const prevMonthOffset = monthOffset - 1
  const nextMonthOffset = monthOffset + 1
  const prevMonthHref = `/dashboard?calendar_month_offset=${prevMonthOffset}`
  const nextMonthHref = `/dashboard?calendar_month_offset=${nextMonthOffset}`

  return (
    <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="dashboard-section-header__eyebrow text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Kalendář
          </div>
        </div>

        <div className="shrink-0 self-start text-right text-2xl font-semibold tracking-tight text-zinc-950">
          {monthLabel}
        </div>
      </div>

      <div className="mb-3 grid grid-cols-7 gap-2">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="px-1 py-2 text-center text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-2">
        {calendarDays.map((day) => {
          const hasJobs = day.count > 0
          const visibleJobs = day.jobs.slice(0, 3)
          const hasMoreJobs = day.jobs.length > 3

          return (
            <div key={day.isoKey} className="group relative">
              <div
                className={[
                  'flex min-h-[62px] flex-col rounded-2xl border p-1.5 transition duration-200',
                  day.isToday
                    ? 'border-[#2980B9] text-white'
                    : day.isCurrentMonth
                      ? 'border-zinc-200 bg-white'
                      : 'border-zinc-100 bg-zinc-50/70 text-zinc-400',
                  hasJobs
                    ? day.isToday
                      ? 'bg-[#2980B9] hover:opacity-95'
                      : 'border-zinc-300 bg-white hover:border-[#2980B9]/60'
                    : day.isToday
                      ? 'bg-[#2980B9]'
                    : '',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className={[
                      'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold leading-none',
                      day.isToday
                        ? 'bg-black text-white'
                        : day.isCurrentMonth
                          ? 'text-zinc-900'
                          : 'text-zinc-400',
                    ].join(' ')}
                  >
                    {day.dayNumber}
                  </div>
                </div>

                <div className="mt-auto flex h-5 items-center justify-center pt-1">
                  {hasJobs ? (
                    <div className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/90 bg-[#2980B9] text-[10px] font-semibold leading-none text-white shadow-sm">
                      {day.count}
                    </div>
                  ) : null}
                </div>
              </div>

              {hasJobs ? (
                <div className="pointer-events-none absolute left-1/2 top-[calc(100%+10px)] z-30 hidden w-[260px] -translate-x-1/2 opacity-0 transition duration-150 group-hover:pointer-events-auto group-hover:block group-hover:opacity-100 xl:w-[280px]">
                  <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                      Zakázky
                    </div>

                    <div className="grid gap-2">
                      {visibleJobs.map((job) => (
                        <Link
                          key={job.id}
                          href="/jobs"
                          className="block rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 transition duration-200 hover:border-zinc-300 hover:bg-white"
                        >
                          <div className="text-[11px] font-semibold text-[#2980B9]">
                            {job.job_number || 'Bez čísla zakázky'} · {formatPragueDateTimeCompact(job.start_at)} · {formatPragueDateTimeCompact(job.end_at)} · {getJobCity(job.site_address)}
                          </div>
                        </Link>
                      ))}

                      {hasMoreJobs ? (
                        <div className="px-1 pt-1 text-xs font-medium text-zinc-500">
                          a další
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      <div className="mt-5 flex items-center gap-3 text-xs text-zinc-500">
        <div className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-zinc-900" />
          Dnes
        </div>
        <div className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#2980B9]" />
          Počet zakázek
        </div>
        <div className="ml-auto flex items-center gap-2">
        <Link
          href={prevMonthHref}
          aria-label="Předchozí měsíc"
          title="Předchozí měsíc"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black bg-black text-white shadow-sm transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-900 hover:border-zinc-900"
        >
          <span className="text-base font-semibold leading-none">↑</span>
        </Link>
        <Link
          href={nextMonthHref}
          aria-label="Další měsíc"
          title="Další měsíc"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black bg-black text-white shadow-sm transition duration-200 hover:-translate-y-[1px] hover:bg-zinc-900 hover:border-zinc-900"
        >
          <span className="text-base font-semibold leading-none">↓</span>
        </Link>
      </div>
      </div>

    </section>
  )
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createClient()
  const resolvedSearchParams = searchParams ? await searchParams : {}

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'name, role, can_view_jobs, can_view_jobs_portal, can_view_offers, can_view_tech_jobs, can_view_connection_points, can_view_handover_protocol_upload, can_view_all_technician_handover_uploads, david_dashboard_ikony, dashboard_schovat_ukoly_a_schuzky, dashboard_calendar'
    )
    .eq('id', user.id)
    .single<DashboardProfile>()

  const { data: themePreference } = await supabase
    .from('profiles')
    .select('theme_mode, theme_auto_override_mode, theme_auto_override_until')
    .eq('id', user.id)
    .maybeSingle<DashboardThemePreference>()

  const profilesResponse = await supabase.from('profiles').select('id, name')

  if (profilesResponse.error) {
    throw new Error(`Nepodařilo se načíst uživatele: ${profilesResponse.error.message}`)
  }

  const profileMap = new Map(
    (profilesResponse.data ?? []).map((item) => [item.id, item])
  )

  const { start, end } = getCurrentWeekRange()
  const { start: todayStart, end: todayEnd } = getTodayRange()
  const dashboardCalendarMonthOffset = normalizeMonthOffset(
    resolvedSearchParams.calendar_month_offset
  )
  const { start: monthStart, end: monthEnd } = getMonthRange(
    dashboardCalendarMonthOffset
  )

  const today = new Date()
  const nowIso = today.toISOString()
  const isAdmin = profile?.role === 'admin'
  const isTechnik = isTechnikRole(profile?.role ?? null)
  const useDavidDashboardLayout = Boolean(profile?.david_dashboard_ikony)
  const hideTasksAndMeetingsOnDashboard = Boolean(
    profile?.dashboard_schovat_ukoly_a_schuzky
  )
  const showDashboardMiniCalendar = Boolean(profile?.dashboard_calendar)
  const canViewTechJobs = isTechnik || Boolean(profile?.can_view_tech_jobs)
  const canViewConnectionPoints =
    isTechnik || Boolean(profile?.can_view_connection_points)
  const canViewHandoverProtocolUpload =
    isTechnik ||
    canViewHandoverProtocolUploadSection(profile?.role ?? null, profile)
  const showTechnicianSection =
    canViewTechJobs ||
    (isTechnik && canViewConnectionPoints) ||
    canViewHandoverProtocolUpload
  const showConnectionPointsInMainMenu =
    Boolean(profile?.can_view_connection_points) && !showTechnicianSection
  const showJobsInMainMenu = Boolean(profile?.can_view_jobs) && !useDavidDashboardLayout
  const showClientsInMainMenu = !useDavidDashboardLayout
  const showJobsInTechnicianSection =
    useDavidDashboardLayout && Boolean(profile?.can_view_jobs)
  const initialThemePreferences: ThemePreferences = {
    themeMode: themePreference?.theme_mode ?? 'light',
    themeAutoOverrideMode: themePreference?.theme_auto_override_mode ?? null,
    themeAutoOverrideUntil: themePreference?.theme_auto_override_until ?? null,
  }

  const nearestMeetingsQuery = supabase
    .from('meetings')
    .select(`
      id,
      company_name,
      contact_person,
      contact_phone,
      contact_email,
      title,
      meeting_datetime,
      follow_up_task,
      status
    `)
    .eq('status', 'planned')
    .eq('assigned_user_id', user.id)
    .not('meeting_datetime', 'is', null)
    .gte('meeting_datetime', nowIso)
    .order('meeting_datetime', { ascending: true })
    .limit(5)

  let dashboardMeetingsCountQuery = supabase
    .from('meetings')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'planned')
    .gte('meeting_datetime', todayStart)
    .lt('meeting_datetime', todayEnd)

  const dashboardWeeklyMeetingsCountQuery = supabase
    .from('meetings')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'planned')
    .eq('assigned_user_id', user.id)
    .gte('meeting_datetime', start)
    .lt('meeting_datetime', end)

  if (!isAdmin) {
    dashboardMeetingsCountQuery = dashboardMeetingsCountQuery.eq('assigned_user_id', user.id)
  }

  let monthMeetingsQuery = supabase
    .from('meetings')
    .select(`
      id,
      company_name,
      contact_person,
      contact_phone,
      contact_email,
      title,
      meeting_datetime,
      follow_up_task,
      status
    `)
    .in('status', ['planned', 'completed'])
    .gte('meeting_datetime', monthStart)
    .lt('meeting_datetime', monthEnd)
    .order('meeting_datetime', { ascending: true })

  if (!isAdmin) {
    monthMeetingsQuery = monthMeetingsQuery.eq('assigned_user_id', user.id)
  }

  const serviceSupabase = getServiceRoleClient()
  if (!serviceSupabase) {
    throw new Error('Chybí Supabase service role client pro dashboardový mini kalendář.')
  }

  const monthJobsQuery = serviceSupabase
    .from('jobs')
    .select('id, job_number, start_at, end_at, site_address, marny_vyjezd')
    .not('start_at', 'is', null)
    .gte('start_at', monthStart)
    .lt('start_at', monthEnd)
    .order('start_at', { ascending: true })

  const tasksSelect = `
    id,
    title,
    status,
    priority,
    repeat_interval,
    source,
    meeting_id,
    company_name,
    contact_person,
    due_date,
    created_at,
    assigned_to,
    created_by
  `
  const tasksSelectWithoutRepeatInterval = tasksSelect
    .replace(/\s*repeat_interval,\n/, '\n')

  const dashboardTasksQuery = async () => {
    const response = await supabase
      .from('tasks')
      .select(tasksSelect)
      .neq('status', 'done')
      .or(`assigned_to.eq.${user.id},created_by.eq.${user.id}`)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(20)

    if (!isMissingRepeatIntervalColumnError(response.error)) {
      return response
    }

    return supabase
      .from('tasks')
      .select(tasksSelectWithoutRepeatInterval)
      .neq('status', 'done')
      .or(`assigned_to.eq.${user.id},created_by.eq.${user.id}`)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(20)
  }

  const [
    tasksResponse,
    meetingsResponse,
    dashboardMeetingsCountResponse,
    dashboardWeeklyMeetingsCountResponse,
    monthMeetingsResponse,
    monthJobsResponse,
    dashboardOffersResponse,
  ] = await Promise.all([
    dashboardTasksQuery(),

    nearestMeetingsQuery,

    dashboardMeetingsCountQuery,

    dashboardWeeklyMeetingsCountQuery,

    monthMeetingsQuery,

    monthJobsQuery,

    isAdmin
      ? supabase
          .from('offers')
          .select('id, offer_number, title, status, updated_at, client_id, created_by')
          .or(`created_by.eq.${user.id},status.eq.in_progress,status.eq.submitted`)
          .order('updated_at', { ascending: false })
      : supabase
          .from('offers')
          .select('id, offer_number, title, status, updated_at, client_id, created_by')
          .eq('created_by', user.id)
          .order('updated_at', { ascending: false }),
  ])

  if (tasksResponse.error) {
    throw new Error(`Nepodařilo se načíst dashboard úkoly: ${tasksResponse.error.message}`)
  }

  if (meetingsResponse.error) {
    throw new Error(`Nepodařilo se načíst dashboard schůzky: ${meetingsResponse.error.message}`)
  }

  if (dashboardMeetingsCountResponse.error) {
    throw new Error(
      `Nepodařilo se načíst dnešní počet schůzek na dashboardu: ${dashboardMeetingsCountResponse.error.message}`
    )
  }

  if (dashboardWeeklyMeetingsCountResponse.error) {
    throw new Error(
      `Nepodařilo se načíst týdenní počet schůzek na dashboardu: ${dashboardWeeklyMeetingsCountResponse.error.message}`
    )
  }

  if (monthMeetingsResponse.error) {
    throw new Error(
      `Nepodařilo se načíst měsíční kalendář schůzek: ${monthMeetingsResponse.error.message}`
    )
  }

  if (monthJobsResponse.error) {
    throw new Error(
      `Nepodařilo se načíst měsíční kalendář zakázek: ${monthJobsResponse.error.message}`
    )
  }

  if (dashboardOffersResponse.error) {
    throw new Error(`Nepodařilo se načíst dashboard nabídky: ${dashboardOffersResponse.error.message}`)
  }

  const todayDateKeyInPrague = getTodayDateKeyInPrague()

  const tasks = ((tasksResponse.data ?? []) as DashboardTask[])
    .map((task) => ({
      ...task,
      repeat_interval: task.repeat_interval ?? null,
      created_by_profile: task.created_by
        ? profileMap.get(task.created_by) ?? null
        : null,
    }))
    .sort((a, b) => {
      const aPriority = getTaskPriorityOrder(a, todayDateKeyInPrague)
      const bPriority = getTaskPriorityOrder(b, todayDateKeyInPrague)

      if (aPriority !== bPriority) {
        return aPriority - bPriority
      }

      if (a.due_date && b.due_date && a.due_date !== b.due_date) {
        return a.due_date.localeCompare(b.due_date)
      }

      if (a.due_date && !b.due_date) return -1
      if (!a.due_date && b.due_date) return 1

      return b.created_at.localeCompare(a.created_at)
    })

  const activeTasks = tasks.filter(
    (task) => !isDashboardTaskOverdue(task, todayDateKeyInPrague)
  )
  const overdueTasks = tasks.filter((task) =>
    isDashboardTaskOverdue(task, todayDateKeyInPrague)
  )
  const visibleAllTasks = tasks.slice(0, 10)
  const visibleActiveTasks = activeTasks.slice(0, 10)
  const visibleOverdueTasks = overdueTasks.slice(0, 10)

  const meetings = (meetingsResponse.data ?? []) as DashboardMeeting[]
  const todayMeetings = meetings.filter(
    (meeting) =>
      Boolean(meeting.meeting_datetime) &&
      meeting.meeting_datetime! >= todayStart &&
      meeting.meeting_datetime! < todayEnd
  )
  const weeklyMeetings = meetings.filter(
    (meeting) =>
      Boolean(meeting.meeting_datetime) &&
      meeting.meeting_datetime! >= start &&
      meeting.meeting_datetime! < end
  )
  const monthMeetings = (monthMeetingsResponse.data ?? []) as DashboardMeeting[]
  const monthJobs = (monthJobsResponse.data ?? []) as DashboardJobCalendarRow[]
  const dashboardOffers = (dashboardOffersResponse.data ?? []) as DashboardOfferRow[]

  await ensureMeetingResultNotifications({ supabase, userId: user.id })

  const [notificationStats, modalNotifications, assignableUsers, clientsResponse, contactsResponse, offerSuggestionsResponse, receivedInvoicesDueCount, orderedOffersCountResponse] =
    await Promise.all([
    getCurrentUserNotificationStats(),
    getCurrentUserNotifications({ status: 'active', limit: 30 }),
    getAssignableUsers(),
    supabase.from('clients').select('id, name').order('name', { ascending: true }),
    supabase
      .from('client_contacts')
      .select('id, client_id, name, phone, email, is_primary')
      .order('is_primary', { ascending: false })
      .order('name', { ascending: true }),
    supabase
      .from('offers')
      .select('id, client_id, offer_number, title, offer_type, status')
      .eq('offer_type', 'classic')
      .neq('status', 'realizace')
      .order('offer_number', { ascending: false }),
    isAdmin ? getReceivedInvoiceBadgeCount() : Promise.resolve(0),
    isAdmin
      ? supabase
          .from('offers')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'ordered')
      : Promise.resolve({ count: 0, error: null }),
    ])

  if (clientsResponse.error) {
    throw new Error(
      `Nepodařilo se načíst klienty pro rychlé akce: ${clientsResponse.error.message}`
    )
  }

  if (contactsResponse.error) {
    throw new Error(
      `Nepodařilo se načíst kontaktní osoby pro rychlé akce: ${contactsResponse.error.message}`
    )
  }

  if (offerSuggestionsResponse.error) {
    throw new Error(
      `Nepodařilo se načíst nabídky pro rychlé akce: ${offerSuggestionsResponse.error.message}`
    )
  }

  if (orderedOffersCountResponse.error) {
    throw new Error(
      `Nepodařilo se načíst počet objednaných nabídek: ${orderedOffersCountResponse.error.message}`
    )
  }

  const orderedOffersCount = Number(orderedOffersCountResponse.count ?? 0)

  let handoverProtocolUploadJobs: DashboardHandoverProtocolUploadJobOption[] = []

  if (canViewHandoverProtocolUpload) {
    const uploadJobOptions = await getHandoverProtocolUploadJobOptions(user.id)
    handoverProtocolUploadJobs = uploadJobOptions.map((job) => ({
      id: job.id,
      jobNumber: job.jobNumber,
      companyName: job.companyName,
      siteAddress: job.siteAddress,
      startAt: job.startAt,
      showInHandoverProtocolUpload: job.showInHandoverProtocolUpload,
    }))
  }

  const quickActionClients = (clientsResponse.data ?? []) as DashboardClientOption[]
  const quickActionContacts =
    (contactsResponse.data ?? []) as DashboardClientContactOption[]
  const quickActionOffers = ((offerSuggestionsResponse.data ?? []) as DashboardOfferOption[]).filter(
    (item) =>
      Boolean(String(item.id ?? '').trim()) &&
      Boolean(String(item.client_id ?? '').trim()) &&
      Boolean(String(item.offer_number ?? '').trim()) &&
      Boolean(String(item.title ?? '').trim())
  )
  const clientNameById = new Map(quickActionClients.map((client) => [client.id, client.name]))

  const offerIds = dashboardOffers.map((offer) => offer.id)
  let latestCommentByOfferId = new Map<
    string,
    {
      authorUserId: string | null
      authorName: string | null
      note: string | null
      createdAt: string | null
    }
  >()

  if (offerIds.length > 0) {
    const { data: offerComments, error: offerCommentsError } = await supabase
      .from('offer_progress_notes')
      .select('id, offer_id, author_user_id, note, created_at')
      .in('offer_id', offerIds)
      .order('created_at', { ascending: false })

    if (offerCommentsError) {
      throw new Error(
        `Nepodařilo se načíst komentáře nabídek pro dashboard: ${offerCommentsError.message}`
      )
    }

    const typedOfferComments = (offerComments ?? []) as DashboardOfferCommentRow[]
    latestCommentByOfferId = typedOfferComments.reduce((map, comment) => {
      if (!map.has(comment.offer_id)) {
        map.set(comment.offer_id, {
          authorUserId: comment.author_user_id,
          authorName: profileMap.get(comment.author_user_id)?.name ?? null,
          note: comment.note,
          createdAt: comment.created_at,
        })
      }
      return map
    }, latestCommentByOfferId)
  }

  const dashboardOfferPreviews = dashboardOffers
    .map((offer) => {
      const latest = latestCommentByOfferId.get(offer.id)
      return {
        id: offer.id,
        offerNumber: offer.offer_number,
        title: offer.title,
        clientName: clientNameById.get(offer.client_id) ?? 'Neznámý klient',
        status: offer.status,
        createdByUserId: offer.created_by,
        createdByName: profileMap.get(offer.created_by)?.name ?? null,
        updatedAt: offer.updated_at,
        lastCommentAt: latest?.createdAt ?? null,
        lastCommentAuthorId: latest?.authorUserId ?? null,
        lastCommentAuthorName: latest?.authorName ?? null,
        lastCommentText: latest?.note ?? null,
      }
    })
    .sort((a, b) => {
      const aTime = new Date(a.lastCommentAt ?? a.updatedAt).getTime()
      const bTime = new Date(b.lastCommentAt ?? b.updatedAt).getTime()
      return bTime - aTime
    })

  return (
    <DashboardGlobalSearchProvider>
      <div className="relative flex min-h-screen flex-col overflow-hidden">
        <div className="dashboard-shell flex-1">
          <div
            aria-hidden
            className="dashboard-shell__glow--top-right pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full blur-3xl"
          />
          <div
            aria-hidden
            className="dashboard-shell__glow--bottom-left pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full blur-3xl"
          />
          <main className="relative z-10 flex flex-1 flex-col">
            <AppBadgeSync count={notificationStats.unread} />
            <DashboardStartupReadyBridge />
            <div className="mx-auto flex w-full max-w-[1920px] flex-1 flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="dashboard-card dashboard-card--strong rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center justify-center lg:justify-start">
              <Link href="/dashboard" className="inline-flex items-center">
                <Image
                  src="/logo2.png"
                  alt="B-ENERGY"
                  width={150}
                  height={42}
                  priority
                  className="h-6 w-auto transition hover:opacity-80"
                />
              </Link>
            </div>

            <div className="hidden w-full lg:block lg:w-auto lg:flex-none">
              <div className="flex w-full items-stretch justify-end gap-3 lg:w-auto">
                <div className="hidden lg:block">
                  <DashboardGlobalSearchInput
                    className="dashboard-search-input h-full w-[260px] rounded-2xl border border-gray-200 bg-white/96 px-4 text-sm font-normal text-zinc-900 outline-none shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_8px_18px_rgba(39,39,42,0.08)] transition placeholder:text-zinc-400 focus:border-[#9dc7e5] focus:ring-2 focus:ring-[#b9d8ef]"
                  />
                </div>

                <DashboardUpdatesLauncher
                  notifications={modalNotifications}
                  unreadCount={notificationStats.unread}
                  receivedInvoicesDueCount={receivedInvoicesDueCount}
                  variant="desktop"
                />

                <DashboardUserPanel
                  profileName={profile?.name ?? null}
                  profileRole={profile?.role ?? null}
                  userEmail={user.email ?? ''}
                  className="dashboard-user-panel lg:w-[320px] lg:min-w-[320px] lg:max-w-[320px]"
                />
              </div>
            </div>
          </div>

          <div className="mt-3 lg:hidden">
            <DashboardUpdatesLauncher
              notifications={modalNotifications}
              unreadCount={notificationStats.unread}
              receivedInvoicesDueCount={receivedInvoicesDueCount}
              variant="mobile"
            />
          </div>
        </section>

        {showTechnicianSection ? (
          <TechnicianSectionLinks
            canViewTechJobs={canViewTechJobs}
            canViewConnectionPoints={canViewConnectionPoints}
            canViewHandoverProtocolUpload={canViewHandoverProtocolUpload}
            includeJobsLink={showJobsInTechnicianSection}
            handoverProtocolUploadJobs={handoverProtocolUploadJobs}
          />
        ) : null}

        {isTechnik ? null : (
          <>
            <DashboardSectionLinks
              canViewJobs={showJobsInMainMenu}
              canViewJobsPortal={Boolean(!isAdmin && profile?.can_view_jobs_portal)}
              canViewOffers={Boolean(isAdmin || profile?.can_view_offers)}
              canViewConnectionPoints={showConnectionPointsInMainMenu}
              showClients={showClientsInMainMenu}
              isAdmin={isAdmin}
              offersOrderedCount={orderedOffersCount}
            />

            <DashboardGlobalSearchBody>
              <div className="grid gap-6 xl:grid-cols-3">
                <div className="contents xl:block xl:space-y-6">
                  {isAdmin || profile?.can_view_offers ? (
                    <div className="order-1 xl:order-none">
                      <DashboardMyOffersModule
                        className="dashboard-card dashboard-card--strong dashboard-offers-module"
                        offers={dashboardOfferPreviews}
                        currentUserId={user.id}
                        isAdmin={isAdmin}
                      />
                    </div>
                  ) : null}

                  {showDashboardMiniCalendar ? (
                    <div className="order-3 xl:order-none">
                      <DashboardMiniCalendar
                        jobs={monthJobs}
                        monthOffset={dashboardCalendarMonthOffset}
                      />
                    </div>
                  ) : null}
                </div>

                {!hideTasksAndMeetingsOnDashboard ? (
                  <>
                    <div className="contents xl:block xl:space-y-6">
                      <section className="dashboard-card order-2 rounded-[28px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] md:p-6 xl:order-none">
                        <div className="mb-4 flex items-start justify-between gap-4">
                          <DashboardSectionHeader
                            eyebrow="Úkoly"
                            title="Moje úkoly"
                            href="/tasks"
                          />
                        </div>

                        <DashboardMyTasksModule
                          allContent={
                            visibleAllTasks.length === 0 ? (
                              <div className="dashboard-empty-state rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] px-4 py-8 text-sm text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                                Nemáš žádné úkoly.
                              </div>
                            ) : (
                              <div className="grid gap-3">
                                {visibleAllTasks.map((task) => (
                                  <DashboardTaskItem key={task.id} task={task} />
                                ))}
                              </div>
                            )
                          }
                          activeContent={
                            visibleActiveTasks.length === 0 ? (
                              <div className="dashboard-empty-state rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] px-4 py-8 text-sm text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                                Nemáš žádné aktivní úkoly.
                              </div>
                            ) : (
                              <div className="grid gap-3">
                                {visibleActiveTasks.map((task) => (
                                  <DashboardTaskItem key={task.id} task={task} />
                                ))}
                              </div>
                            )
                          }
                          overdueContent={
                            visibleOverdueTasks.length === 0 ? (
                              <div className="dashboard-empty-state rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] px-4 py-8 text-sm text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                                Nemáš žádné úkoly po termínu.
                              </div>
                            ) : (
                              <div className="grid gap-3">
                                {visibleOverdueTasks.map((task) => (
                                  <DashboardTaskItem key={task.id} task={task} />
                                ))}
                              </div>
                            )
                          }
                        />
                      </section>
                    </div>

                    <div className="contents xl:block xl:space-y-6">
                      <section className="dashboard-card order-3 rounded-[28px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] md:p-6 xl:order-none">
                        <div className="mb-4 flex items-start justify-between gap-4">
                          <DashboardSectionHeader
                            eyebrow="Schůzky"
                            title="Moje schůzky"
                            href="/meetings"
                          />
                        </div>

                        <DashboardMyMeetingsModule
                          todayContent={
                            todayMeetings.length === 0 ? (
                              <div className="dashboard-empty-state rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] px-4 py-8 text-sm text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                                Nemáš žádné schůzky dnes.
                              </div>
                            ) : (
                              <div className="grid gap-2.5">
                                {todayMeetings.map((meeting) => (
                                  <DashboardMeetingItem key={meeting.id} meeting={meeting} />
                                ))}
                              </div>
                            )
                          }
                          weekContent={
                            weeklyMeetings.length === 0 ? (
                              <div className="dashboard-empty-state rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.82)_100%)] px-4 py-8 text-sm text-zinc-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)]">
                                Nemáš žádné nadcházející schůzky.
                              </div>
                            ) : (
                              <div className="grid gap-2.5">
                                {weeklyMeetings.map((meeting) => (
                                  <DashboardMeetingItem key={meeting.id} meeting={meeting} />
                                ))}
                              </div>
                            )
                          }
                        />
                      </section>
                    </div>
                  </>
                ) : null}

                <DashboardUserPanel
                  profileName={profile?.name ?? null}
                  profileRole={profile?.role ?? null}
                  userEmail={user.email ?? ''}
                  className="order-6 lg:hidden xl:order-none"
                />
              </div>
            </DashboardGlobalSearchBody>
            <DashboardMobileQuickActions
              users={assignableUsers}
              clients={quickActionClients}
              contacts={quickActionContacts}
              offers={quickActionOffers}
              canViewJobs={Boolean(profile?.can_view_jobs)}
              canViewOffers={isAdmin || Boolean(profile?.can_view_offers)}
              canCreateJobs={isAdmin}
              isAdmin={isAdmin}
              receivedInvoicesDueCount={receivedInvoicesDueCount}
            />
          </>
        )}

        {isTechnik ? (
          <DashboardUserPanel
            profileName={profile?.name ?? null}
            profileRole={profile?.role ?? null}
            userEmail={user.email ?? ''}
            className="mt-auto lg:hidden"
          />
        ) : null}
          </div>
          </main>
        </div>

        <footer className="dashboard-footer border-t border-white/12 bg-zinc-950 px-4 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.10)] sm:px-6 lg:px-8">
          <div className="dashboard-footer__content mx-auto flex w-full max-w-[1920px] flex-col gap-1 text-xs text-white/70 md:flex-row md:items-center md:justify-between md:gap-3">
            <div className="flex items-center gap-3 whitespace-nowrap">
              <DashboardThemeToggle initialThemePreferences={initialThemePreferences} />
              {!isTechnik ? (
                <Link
                  href="/snake"
                  aria-label="Otevřít hru Snake"
                  title="Snake"
                  className="dashboard-footer__link inline-flex h-4 w-4 items-center justify-center text-white/70 transition hover:text-white"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 scale-[1.42]"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M8.1 8.2h7.8c1.6 0 2.6.9 3 2.3l.9 3.1c.4 1.6-.6 3.1-2.2 3.1-.8 0-1.5-.4-1.9-1l-1-1.5h-5.4l-1 1.5c-.4.6-1.1 1-1.9 1-1.6 0-2.7-1.5-2.2-3.1l.9-3.1c.4-1.4 1.4-2.3 3-2.3Z"
                      stroke="currentColor"
                      strokeWidth="1.65"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M9 11.4v2.2M7.9 12.5h2.2"
                      stroke="currentColor"
                      strokeWidth="1.55"
                      strokeLinecap="round"
                    />
                    <circle cx="15.3" cy="11.8" r="0.85" fill="currentColor" />
                    <circle cx="17.1" cy="13.2" r="0.85" fill="currentColor" />
                  </svg>
                </Link>
              ) : null}
            </div>
            <div className="self-end text-right md:self-auto md:text-left">v3.1.1</div>
          </div>
        </footer>
      </div>
    </DashboardGlobalSearchProvider>
  )
}
