import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { updateTaskStatus } from '@/app/tasks/actions'
import { TaskCompleteButton } from '@/app/tasks/task-complete-button'
import {
  getPriorityBadgeClass,
  getPriorityLabel,
} from '@/app/tasks/taskUi'
import {
  MeetingStatusBadge,
  MeetingTaskBadge,
} from '@/components/meetings/meeting-status-badge'
import { DashboardUpdatesLauncher } from '@/components/dashboard/dashboard-updates-launcher'
import {
  getCurrentUserNotificationStats,
  getCurrentUserNotifications,
} from '@/lib/notifications/getNotifications'
import { ensureMeetingResultNotifications } from '@/lib/notifications/meetingNotifications'

export const dynamic = 'force-dynamic'

const PRAGUE_TIME_ZONE = 'Europe/Prague'

type ProfileRef = {
  id: string
  name: string | null
}

type DashboardProfile = {
  name: string | null
  role: string | null
  can_view_jobs: boolean | null
  can_view_jobs_portal: boolean | null
}

type DashboardTask = {
  id: string
  title: string
  status: 'todo' | 'done'
  priority: string | null
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

type CalendarDay = {
  date: Date
  isoKey: string
  dayNumber: number
  isCurrentMonth: boolean
  isToday: boolean
  meetings: DashboardMeeting[]
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

function getTaskPriorityOrder(task: DashboardTask, todayDateKey: string) {
  if (task.status === 'done') return 3
  if (task.due_date && task.due_date < todayDateKey) return 0
  if (task.due_date === todayDateKey) return 1
  return 2
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

function getMonthRange() {
  const now = new Date()
  const { year, month } = getPragueDateParts(now)

  const nextMonthYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1

  return {
    start: convertPragueLocalPartsToUtcIsoString(year, month, 1, 0, 0, 0),
    end: convertPragueLocalPartsToUtcIsoString(
      nextMonthYear,
      nextMonth,
      1,
      0,
      0,
      0
    ),
  }
}

function getCalendarDays(meetings: DashboardMeeting[]): CalendarDay[] {
  const now = new Date()
  const todayParts = getPragueDateParts(now)
  const todayCarrier = createDateCarrier(
    todayParts.year,
    todayParts.month,
    todayParts.day
  )

  const monthStartCarrier = createDateCarrier(todayParts.year, todayParts.month, 1)
  const nextMonthCarrier = createDateCarrier(
    todayParts.month === 12 ? todayParts.year + 1 : todayParts.year,
    todayParts.month === 12 ? 1 : todayParts.month + 1,
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

  const meetingsByDay = new Map<string, DashboardMeeting[]>()

  for (const meeting of meetings) {
    const meetingDate = parseDate(meeting.meeting_datetime)
    if (!meetingDate) continue

    const meetingParts = getPragueDateParts(meetingDate)
    const key = toCarrierKey(
      createDateCarrier(meetingParts.year, meetingParts.month, meetingParts.day)
    )

    const existing = meetingsByDay.get(key) ?? []
    existing.push(meeting)
    meetingsByDay.set(key, existing)
  }

  for (const [key, dayMeetings] of meetingsByDay.entries()) {
    meetingsByDay.set(
      key,
      [...dayMeetings].sort((a, b) => {
        const aTime = a.meeting_datetime
          ? new Date(a.meeting_datetime).getTime()
          : 0
        const bTime = b.meeting_datetime
          ? new Date(b.meeting_datetime).getTime()
          : 0
        return aTime - bTime
      })
    )
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
      meetings: meetingsByDay.get(key) ?? [],
    })

    cursor = addDaysToCarrier(cursor, 1)
  }

  return days
}

function DashboardStatCard({
  label,
  value,
  highlighted = false,
  alert = false,
}: {
  label: string
  value: number
  highlighted?: boolean
  alert?: boolean
}) {
  const cardClassName = highlighted
    ? 'border border-[#2980B9] bg-[#2980B9]'
    : alert
      ? 'border border-red-600 bg-red-600'
      : 'border border-zinc-200 bg-zinc-50'

  const labelClassName = highlighted || alert ? 'text-xs text-white/80' : 'text-xs text-zinc-500'

  const valueClassName =
    highlighted || alert
      ? 'mt-1.5 text-xl font-semibold text-white'
      : 'mt-1.5 text-xl font-semibold text-zinc-950'

  return (
    <div
      className={[
        'min-w-0 rounded-2xl px-3 py-3 shadow-sm transition sm:px-4 sm:py-3.5',
        cardClassName,
      ].join(' ')}
    >
      <div className={`${labelClassName} leading-tight`}>{label}</div>
      <div className={`${valueClassName} text-lg sm:text-xl`}>{value}</div>
    </div>
  )
}

function DashboardSectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
        {eyebrow}
      </div>
      <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
        {title}
      </h2>
      <p className="mt-1.5 text-sm text-zinc-500">{description}</p>
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
        'flex w-full flex-col gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2 shadow-sm sm:flex-row sm:items-center sm:justify-between',
        className,
      ].join(' ')}
    >
      <div className="min-w-0 flex-1 text-[10px] leading-4 text-zinc-500">
        <div className="truncate">
          Uživatel:{' '}
          <span className="font-medium text-zinc-900">
            {profileName ?? userEmail}
          </span>
        </div>
        <div className="truncate">
          Role:{' '}
          <span className="font-medium uppercase text-zinc-900">
            {profileRole ?? 'neuvedeno'}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Link
          href="/settings/password"
          className="inline-flex h-8 items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 text-[10px] font-medium uppercase tracking-[0.04em] text-zinc-700 transition hover:bg-zinc-100 hover:text-zinc-950"
        >
          HESLO
        </Link>

        <form action="/auth/signout" method="post" className="shrink-0">
          <button className="inline-flex h-8 w-full items-center justify-center rounded-xl bg-zinc-900 px-3 text-[10px] font-medium uppercase tracking-[0.04em] text-white transition hover:bg-zinc-800 sm:w-auto">
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
  const dueDate = task.due_date
  const isOverdue =
    task.status !== 'done' &&
    dueDate !== null &&
    dueDate < todayDateKeyInPrague

  return (
    <div
      className={[
        'relative rounded-2xl border px-4 py-3 shadow-sm transition duration-200 hover:shadow-md',
        isOverdue
          ? 'border-red-300 bg-white hover:border-red-400'
          : 'border-zinc-200/80 bg-white hover:border-zinc-300',
      ].join(' ')}
    >
      <Link
        href={`/tasks/${task.id}`}
        className="absolute inset-0 rounded-2xl"
        aria-label={`Otevřít úkol ${task.title}`}
      />

      <div className="flex flex-col gap-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 pr-2">
            <div
              className="relative z-10 line-clamp-2 min-h-10 break-words text-sm font-semibold leading-5 text-zinc-900"
              title={task.title}
            >
              {task.title}
            </div>
          </div>

          <div className="relative z-10 flex min-h-[1.75rem] w-44 shrink-0 flex-wrap justify-end gap-1">
            <div className="min-h-[1.75rem]">
              {task.priority ? (
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getPriorityBadgeClass(task.priority)}`}
                >
                  {getPriorityLabel(task.priority)}
                </span>
              ) : null}
            </div>

            <div className="min-h-[1.75rem]">
              {isOverdue ? (
                <span className="inline-flex items-center rounded-full border border-red-200 bg-red-600 px-2.5 py-1 text-xs font-medium text-white task-overdue-badge">
                  Po termínu
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="relative z-10 flex justify-end gap-2">
          <Link
            href={`/tasks/${task.id}`}
            className="inline-flex items-center justify-center rounded-xl bg-gray-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-gray-800"
          >
            DETAIL
          </Link>

          {task.status !== 'done' ? (
            <form action={markTaskDoneAction}>
              <TaskCompleteButton
                className="inline-flex items-center justify-center rounded-xl border border-emerald-600 bg-emerald-600 px-3 py-2 text-xs font-medium text-white transition hover:border-emerald-700 hover:bg-emerald-700 [animation:task-complete-glow_2.2s_ease-in-out_infinite]"
              />
            </form>
          ) : null}
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
      className="block rounded-2xl border border-zinc-200/80 bg-white px-4 py-3 shadow-sm transition duration-200 hover:border-zinc-300 hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <div className="flex w-[64px] shrink-0 flex-col items-center rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-2 text-center">
          <div className="text-xl font-semibold leading-none text-zinc-950">
            {day}
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
            {month}
          </div>
          <div className="mt-2 w-full rounded-lg border border-zinc-200 bg-white px-1.5 py-1 text-[11px] font-medium text-zinc-700">
            {time}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-zinc-900">
                {meeting.company_name ?? 'Bez firmy'}
              </div>

              <div className="mt-0.5 truncate text-sm text-zinc-600">
                {meeting.contact_person ?? meeting.title ?? 'Bez kontaktní osoby'}
              </div>

              <div className="mt-1 text-[11px] text-zinc-500">
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
  meetings,
}: {
  meetings: DashboardMeeting[]
}) {
  const now = new Date()
  const monthLabel = new Intl.DateTimeFormat('cs-CZ', {
    timeZone: PRAGUE_TIME_ZONE,
    month: 'long',
    year: 'numeric',
  }).format(now)

  const calendarDays = getCalendarDays(meetings)
  const weekdayLabels = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']

  return (
    <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <DashboardSectionHeader
            eyebrow="Kalendář"
            title={monthLabel}
            description="Přehled schůzek v aktuálním měsíci."
          />
        </div>

        <Link
          href="/calendar"
          className="hidden shrink-0 items-center self-start rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-[0.04em] text-white transition duration-200 hover:bg-zinc-800 md:inline-flex"
        >
          KALENDÁŘ
        </Link>
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
          const hasMeetings = day.meetings.length > 0
          const visibleMeetings = day.meetings.slice(0, 3)
          const hasMoreMeetings = day.meetings.length > 3

          return (
            <div key={day.isoKey} className="group relative">
              <div
                className={[
                  'flex min-h-[82px] flex-col rounded-2xl border p-2 transition duration-200',
                  day.isToday
                    ? 'border-[#2980B9] text-white'
                    : day.isCurrentMonth
                      ? 'border-zinc-200 bg-white'
                      : 'border-zinc-100 bg-zinc-50/70 text-zinc-400',
                  hasMeetings
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
                      'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold leading-none',
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

                <div className="mt-auto flex h-6 items-center justify-center pt-4">
                  {hasMeetings ? (
                    <div className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/90 bg-[#2980B9] text-[10px] font-semibold leading-none text-white shadow-sm">
                      {day.meetings.length}
                    </div>
                  ) : null}
                </div>
              </div>

              {hasMeetings ? (
                <div className="pointer-events-none absolute left-1/2 top-[calc(100%+10px)] z-30 hidden w-[260px] -translate-x-1/2 opacity-0 transition duration-150 group-hover:pointer-events-auto group-hover:block group-hover:opacity-100 xl:w-[280px]">
                  <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-xl">
                    <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
                      Schůzky
                    </div>

                    <div className="grid gap-2">
                      {visibleMeetings.map((meeting) => (
                        <Link
                          key={meeting.id}
                          href={`/meetings/${meeting.id}`}
                          className="block rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 transition duration-200 hover:border-zinc-300 hover:bg-white"
                        >
                          <div className="text-[11px] font-semibold text-[#2980B9]">
                            {formatMeetingTime(meeting.meeting_datetime)}
                          </div>
                          <div className="mt-1 text-sm font-medium text-zinc-900">
                            {meeting.company_name ?? 'Bez firmy'}
                          </div>
                          <div className="mt-0.5 text-xs text-zinc-500">
                            {meeting.contact_person ?? 'Bez kontaktní osoby'}
                          </div>
                        </Link>
                      ))}

                      {hasMoreMeetings ? (
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

      <div className="mt-5 flex flex-wrap gap-3 text-xs text-zinc-500">
        <div className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-zinc-900" />
          Dnes
        </div>
        <div className="inline-flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-[#2980B9]" />
          Počet schůzek v daném dni
        </div>
      </div>

      <div className="mt-5 md:hidden">
        <Link
          href="/calendar"
          className="inline-flex min-h-[46px] items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-[0.04em] text-white transition duration-200 hover:bg-zinc-800"
        >
          OTEVŘÍT KALENDÁŘ
        </Link>
      </div>
    </section>
  )
}

function ClientsCard() {
  return (
    <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Sekce
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
            Klienti
          </h2>
        </div>

        <Link
          href="/clients"
          className="inline-flex min-h-[46px] shrink-0 items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-[0.04em] text-white transition duration-200 hover:bg-zinc-800"
        >
          OTEVŘÍT KLIENTY
        </Link>
      </div>
    </section>
  )
}

function JobsCard() {
  return (
    <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Sekce
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
            Zakázky
          </h2>
        </div>

        <Link
          href="/jobs"
          className="inline-flex min-h-[46px] shrink-0 items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-[0.04em] text-white transition duration-200 hover:bg-zinc-800"
        >
          OTEVŘÍT ZAKÁZKY
        </Link>
      </div>
    </section>
  )
}

function JobsPortalCard() {
  return (
    <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Sekce
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
            Portál zakázek
          </h2>
        </div>

        <Link
          href="/jobs-portal"
          className="inline-flex min-h-[46px] shrink-0 items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-[0.04em] text-white transition duration-200 hover:bg-zinc-800"
        >
          OTEVŘÍT PORTÁL
        </Link>
      </div>
    </section>
  )
}

function FinanceCard() {
  return (
    <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-400">
            Sekce
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
            Finance
          </h2>
        </div>

        <Link
          href="/faktury"
          className="inline-flex min-h-[46px] shrink-0 items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-[0.04em] text-white transition duration-200 hover:bg-zinc-800"
        >
          OTEVŘÍT FINANCE
        </Link>
      </div>
    </section>
  )
}

export default async function DashboardPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select(
      'name, role, can_view_jobs, can_view_jobs_portal'
    )
    .eq('id', user.id)
    .single<DashboardProfile>()

  const profilesResponse = await supabase.from('profiles').select('id, name')

  if (profilesResponse.error) {
    throw new Error(`Nepodařilo se načíst uživatele: ${profilesResponse.error.message}`)
  }

  const profileMap = new Map(
    (profilesResponse.data ?? []).map((item) => [item.id, item])
  )

  const { start, end } = getCurrentWeekRange()
  const { start: todayStart, end: todayEnd } = getTodayRange()
  const { start: monthStart, end: monthEnd } = getMonthRange()

  const today = new Date()
  const nowIso = today.toISOString()
  const isAdmin = profile?.role === 'admin'

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

  const [
    tasksResponse,
    activeTasksCountResponse,
    overdueTasksCountResponse,
    meetingsResponse,
    dashboardMeetingsCountResponse,
    dashboardWeeklyMeetingsCountResponse,
    monthMeetingsResponse,
  ] = await Promise.all([
    supabase
      .from('tasks')
      .select(`
        id,
        title,
        status,
        priority,
        source,
        meeting_id,
        company_name,
        contact_person,
        due_date,
        created_at,
        assigned_to,
        created_by
      `)
      .neq('status', 'done')
      .eq('assigned_to', user.id)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(5),

    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'done')
      .eq('assigned_to', user.id),

    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .neq('status', 'done')
      .eq('assigned_to', user.id)
      .lt(
        'due_date',
        new Intl.DateTimeFormat('en-CA', {
          timeZone: PRAGUE_TIME_ZONE,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date())
      ),

    nearestMeetingsQuery,

    dashboardMeetingsCountQuery,

    dashboardWeeklyMeetingsCountQuery,

    monthMeetingsQuery,
  ])

  if (tasksResponse.error) {
    throw new Error(`Nepodařilo se načíst dashboard úkoly: ${tasksResponse.error.message}`)
  }

  if (activeTasksCountResponse.error) {
    throw new Error(
      `Nepodařilo se načíst počet aktivních úkolů: ${activeTasksCountResponse.error.message}`
    )
  }

  if (overdueTasksCountResponse.error) {
    throw new Error(
      `Nepodařilo se načíst počet úkolů po termínu: ${overdueTasksCountResponse.error.message}`
    )
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

  const todayDateKeyInPrague = getTodayDateKeyInPrague()

  const tasks = ((tasksResponse.data ?? []) as DashboardTask[])
    .map((task) => ({
      ...task,
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

  const meetings = (meetingsResponse.data ?? []) as DashboardMeeting[]
  const monthMeetings = (monthMeetingsResponse.data ?? []) as DashboardMeeting[]

  const activeTasksCount = activeTasksCountResponse.count ?? 0
  const overdueTasksCount = overdueTasksCountResponse.count ?? 0
  const dashboardTodayMeetingsCount = dashboardMeetingsCountResponse.count ?? 0
  const dashboardWeeklyMeetingsCount = dashboardWeeklyMeetingsCountResponse.count ?? 0
  await ensureMeetingResultNotifications({ supabase, userId: user.id })

  const [notificationStats, modalNotifications] = await Promise.all([
    getCurrentUserNotificationStats(),
    getCurrentUserNotifications({ status: 'active', limit: 30 }),
  ])

  return (
    <main className="min-h-screen bg-gray-50 text-zinc-900">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm">
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
                <DashboardUpdatesLauncher
                  notifications={modalNotifications}
                  unreadCount={notificationStats.unread}
                  variant="desktop"
                />

                <DashboardUserPanel
                  profileName={profile?.name ?? null}
                  profileRole={profile?.role ?? null}
                  userEmail={user.email ?? ''}
                  className="lg:w-[320px] lg:min-w-[320px] lg:max-w-[320px]"
                />
              </div>
            </div>
          </div>

          <div className="mt-3 lg:hidden">
            <DashboardUpdatesLauncher
              notifications={modalNotifications}
              unreadCount={notificationStats.unread}
              variant="mobile"
            />
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6">
            <ClientsCard />

            {profile?.can_view_jobs ? <JobsCard /> : null}

            {profile?.can_view_jobs_portal ? <JobsPortalCard /> : null}

            {isAdmin ? <FinanceCard /> : null}
          </div>

          <div className="space-y-6">
            <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
              <div className="mb-5">
                <DashboardSectionHeader
                  eyebrow="Úkoly"
                  title="Moje úkoly"
                  description="Nejbližší aktivní úkoly, které máš aktuálně přiřazené."
                />
              </div>

              <div className="mb-5 grid grid-cols-2 gap-3 [&>*]:min-w-0">
                <DashboardStatCard
                  label="Aktivní úkoly"
                  value={activeTasksCount}
                  highlighted
                />
                <DashboardStatCard
                  label="Úkoly po termínu"
                  value={overdueTasksCount}
                  alert={overdueTasksCount > 0}
                />
              </div>

              {tasks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
                  Nemáš žádné aktivní úkoly.
                </div>
              ) : (
                <div className="grid gap-3">
                  {tasks.map((task) => (
                    <DashboardTaskItem key={task.id} task={task} />
                  ))}
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href="/tasks"
                  className="inline-flex min-h-[46px] items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-[0.04em] text-white transition duration-200 hover:bg-zinc-800"
                >
                  VŠECHNY ÚKOLY
                </Link>
              </div>
            </section>

            <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
              <div className="mb-5">
                <DashboardSectionHeader
                  eyebrow="Schůzky"
                  title="Moje nejbližší schůzky"
                  description="Pět nejbližších plánovaných schůzek."
                />
              </div>

              <div className="mb-5 grid grid-cols-2 gap-3 [&>*]:min-w-0">
                <DashboardStatCard
                  label="Schůzky dnes"
                  value={dashboardTodayMeetingsCount}
                  highlighted
                />
                <DashboardStatCard
                  label="Schůzky tento týden"
                  value={dashboardWeeklyMeetingsCount}
                />
              </div>

              {meetings.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
                  Nemáš žádné nadcházející schůzky.
                </div>
              ) : (
                <div className="grid gap-2.5">
                  {meetings.map((meeting) => (
                    <DashboardMeetingItem key={meeting.id} meeting={meeting} />
                  ))}
                </div>
              )}

              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href="/meetings"
                  className="inline-flex min-h-[46px] items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-[0.04em] text-white transition duration-200 hover:bg-zinc-800"
                >
                  VŠECHNY SCHŮZKY
                </Link>
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <DashboardMiniCalendar meetings={monthMeetings} />

            <DashboardUserPanel
              profileName={profile?.name ?? null}
              profileRole={profile?.role ?? null}
              userEmail={user.email ?? ''}
              className="lg:hidden"
            />
          </div>
        </div>
      </div>

      <footer className="border-t border-white/10 bg-zinc-950 px-4 py-5 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-2 text-xs text-white/70 md:flex-row md:items-center md:justify-between">
          <div>B-ENERGY APP — coding by blaster</div>
          <div>v1.9.2</div>
        </div>
      </footer>
    </main>
  )
}
