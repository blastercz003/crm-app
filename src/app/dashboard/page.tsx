import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  MeetingStatusBadge,
  MeetingTaskBadge,
} from '@/components/meetings/meeting-status-badge'
import { DashboardWelcomeOverlay } from '@/components/dashboard/dashboard-welcome-overlay'
import { AppShell } from '@/components/layout/app-shell'

export const dynamic = 'force-dynamic'

const PRAGUE_TIME_ZONE = 'Europe/Prague'

type ProfileRef = {
  id: string
  name: string | null
}

type DashboardProfile = {
  name: string | null
  role: string | null
  last_seen_dashboard_at: string | null
  last_seen_updates_at: string | null
  can_view_jobs: boolean | null
  can_view_jobs_portal: boolean | null
}

type DashboardTask = {
  id: string
  title: string
  status: 'todo' | 'done'
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

type OverlaySummaryItem = {
  label: string
  value: string
  tone?: 'default' | 'highlight' | 'warning'
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

function isSamePragueDay(a: string | null, b: Date) {
  const parsed = parseDate(a)

  if (!parsed) return false

  const aParts = getPragueDateParts(parsed)
  const bParts = getPragueDateParts(b)

  return (
    aParts.year === bParts.year &&
    aParts.month === bParts.month &&
    aParts.day === bParts.day
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

function getDayGreeting() {
  const now = new Date()
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: PRAGUE_TIME_ZONE,
      hour: '2-digit',
      hour12: false,
    }).format(now)
  )

  if (hour < 12) return 'Dobré ráno'
  if (hour < 18) return 'Vítej zpět'
  return 'Dobrý večer'
}

function getOverlayHeadline(hasNewUpdates: boolean) {
  if (hasNewUpdates) return 'Máme pro Tebe novinky'
  return getDayGreeting()
}

function getOverlayDescription(
  hasNewUpdates: boolean,
  newTasksCount: number,
  todayMeetingsCount: number,
  overdueTasksCount: number
) {
  if (hasNewUpdates) {
    return 'V aplikaci se objevilo něco nového, co se týká právě Tebe.'
  }

  if (todayMeetingsCount > 0 || overdueTasksCount > 0) {
    return 'Tady je rychlý přehled, ať hned víš, co je dnes důležité.'
  }

  if (newTasksCount === 0) {
    return 'Dnes je zatím klid. Přesto máš přehled o tom nejdůležitějším.'
  }

  return 'Tady je rychlé shrnutí po přihlášení.'
}

function buildOverlaySummaryItems(args: {
  newTasksCount: number
  todayMeetingsCount: number
  overdueTasksCount: number
}): OverlaySummaryItem[] {
  const items: OverlaySummaryItem[] = []

  if (args.newTasksCount > 0) {
    items.push({
      label: 'Nové úkoly',
      value:
        args.newTasksCount === 1
          ? 'Byl Ti přiřazen 1 nový úkol'
          : `Byly Ti přiřazeny ${args.newTasksCount} nové úkoly`,
      tone: 'highlight',
    })
  }

  if (args.todayMeetingsCount > 0) {
    items.push({
      label: 'Dnešní schůzky',
      value:
        args.todayMeetingsCount === 1
          ? 'Dnes máš 1 schůzku'
          : `Dnes máš ${args.todayMeetingsCount} schůzky`,
      tone: 'default',
    })
  } else {
    items.push({
      label: 'Dnešní schůzky',
      value: 'Dnes zatím nemáš žádnou schůzku',
      tone: 'default',
    })
  }

  if (args.overdueTasksCount > 0) {
    items.push({
      label: 'Po termínu',
      value:
        args.overdueTasksCount === 1
          ? '1 úkol je po termínu'
          : `${args.overdueTasksCount} úkoly jsou po termínu`,
      tone: 'warning',
    })
  }

  return items
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
    ? 'bg-gradient-to-br from-[#2f8fc8] to-[#2369A0] border border-white/20 shadow-[0_2px_12px_rgba(41,128,185,0.30)]'
    : alert
      ? 'bg-gradient-to-br from-red-500 to-red-600 border border-white/20 shadow-[0_2px_12px_rgba(220,38,38,0.25)]'
      : 'glass-card'

  const labelClassName = highlighted || alert ? 'text-xs text-white/80' : 'text-xs text-slate-500'

  const valueClassName =
    highlighted || alert
      ? 'mt-1.5 text-xl font-semibold text-white'
      : 'mt-1.5 text-xl font-semibold text-slate-900'

  return (
    <div
      className={[
        'rounded-2xl px-4 py-3.5 transition',
        cardClassName,
      ].join(' ')}
    >
      <div className={labelClassName}>{label}</div>
      <div className={valueClassName}>{value}</div>
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
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
        {eyebrow}
      </div>
      <h2 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">
        {title}
      </h2>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
  )
}

function DashboardTaskItem({ task }: { task: DashboardTask }) {
  const todayDateKeyInPrague = getTodayDateKeyInPrague()
  const dueDate = task.due_date
  const isOverdue =
    task.status !== 'done' &&
    dueDate !== null &&
    dueDate < todayDateKeyInPrague

  return (
    <div
      className={[
        'relative rounded-xl px-4 py-3 transition duration-200',
        isOverdue
          ? 'bg-red-500/10 border border-red-400/25 hover:bg-red-500/15'
          : 'glass-card hover:bg-white/80',
      ].join(' ')}
    >
      <Link
        href={`/tasks/${task.id}`}
        className="absolute inset-0 rounded-xl"
        aria-label={`Otevřít úkol ${task.title}`}
      />

      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="relative z-10 break-words text-sm font-medium text-slate-800">
              {task.title}
            </div>
          </div>

          <div className="relative z-10 flex shrink-0 items-center gap-2">
            {isOverdue ? (
              <span className="inline-flex items-center rounded-full status-badge-overdue px-2.5 py-0.5 text-xs font-medium">
                Po termínu
              </span>
            ) : null}

            <Link
              href={`/tasks/${task.id}`}
              className="inline-flex items-center justify-center rounded-lg btn-glass-secondary px-3 py-1.5 text-xs font-medium transition"
            >
              Detail
            </Link>
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
      className="block glass-card rounded-xl px-4 py-3 transition duration-200 hover:bg-white/80"
    >
      <div className="flex items-start gap-3">
        <div className="flex w-[58px] shrink-0 flex-col items-center rounded-lg bg-[#2980B9]/10 border border-[#2980B9]/15 px-2 py-2 text-center">
          <div className="text-lg font-bold leading-none text-[#2369A0]">
            {day}
          </div>
          <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#2980B9]/70">
            {month}
          </div>
          <div className="mt-1.5 w-full rounded-md bg-white/70 border border-white/80 px-1 py-0.5 text-[10px] font-medium text-slate-600">
            {time}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-800">
                {meeting.company_name ?? 'Bez firmy'}
              </div>

              <div className="mt-0.5 truncate text-sm text-slate-500">
                {meeting.contact_person ?? meeting.title ?? 'Bez kontaktní osoby'}
              </div>

              <div className="mt-0.5 text-[11px] text-slate-400">
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
    <section className="glass-card rounded-2xl p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <DashboardSectionHeader
            eyebrow="Kalendář"
            title={monthLabel}
            description="Přehled schůzek v aktuálním měsíci."
          />
        </div>

        <Link
          href="/calendar"
          className="hidden shrink-0 items-center self-start rounded-xl btn-glass-primary px-4 py-2 text-sm font-medium transition md:inline-flex"
        >
          Kalendář
        </Link>
      </div>

      <div className="mb-2 grid grid-cols-7 gap-1">
        {weekdayLabels.map((label) => (
          <div
            key={label}
            className="px-1 py-1.5 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400"
          >
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {calendarDays.map((day) => {
          const hasMeetings = day.meetings.length > 0
          const visibleMeetings = day.meetings.slice(0, 3)
          const hasMoreMeetings = day.meetings.length > 3

          return (
            <div key={day.isoKey} className="group relative">
              <div
                className={[
                  'flex min-h-[72px] flex-col rounded-xl border p-1.5 transition duration-200',
                  day.isToday && hasMeetings
                    ? 'bg-[#2980B9] border-[#2369A0]/50 text-white hover:opacity-95'
                    : day.isToday
                      ? 'bg-[#2980B9] border-[#2369A0]/50 text-white'
                      : day.isCurrentMonth
                        ? hasMeetings
                          ? 'border-[#2980B9]/25 bg-white/60 hover:border-[#2980B9]/40'
                          : 'border-white/50 bg-white/35 hover:bg-white/50'
                        : 'border-transparent bg-transparent',
                ].join(' ')}
              >
                <div
                  className={[
                    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold leading-none',
                    day.isToday
                      ? 'bg-white/20 text-white'
                      : day.isCurrentMonth
                        ? 'text-slate-700'
                        : 'text-slate-300',
                  ].join(' ')}
                >
                  {day.dayNumber}
                </div>

                <div className="mt-auto flex h-5 items-center justify-center">
                  {hasMeetings ? (
                    <div
                      className={[
                        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold leading-none',
                        day.isToday
                          ? 'bg-white/25 text-white'
                          : 'bg-[#2980B9] text-white shadow-sm',
                      ].join(' ')}
                    >
                      {day.meetings.length}
                    </div>
                  ) : null}
                </div>
              </div>

              {hasMeetings ? (
                <div className="pointer-events-none absolute left-1/2 top-[calc(100%+8px)] z-30 hidden w-[240px] -translate-x-1/2 opacity-0 transition duration-150 group-hover:pointer-events-auto group-hover:block group-hover:opacity-100 xl:w-[260px]">
                  <div className="glass-card rounded-xl border border-white/60 p-3 shadow-xl backdrop-blur-2xl">
                    <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                      Schůzky
                    </div>

                    <div className="grid gap-1.5">
                      {visibleMeetings.map((meeting) => (
                        <Link
                          key={meeting.id}
                          href={`/meetings/${meeting.id}`}
                          className="block rounded-lg bg-white/60 border border-white/70 px-2.5 py-2 transition duration-200 hover:bg-white/80"
                        >
                          <div className="text-[11px] font-semibold text-[#2980B9]">
                            {formatMeetingTime(meeting.meeting_datetime)}
                          </div>
                          <div className="mt-0.5 text-xs font-medium text-slate-800">
                            {meeting.company_name ?? 'Bez firmy'}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {meeting.contact_person ?? 'Bez kontaktní osoby'}
                          </div>
                        </Link>
                      ))}

                      {hasMoreMeetings ? (
                        <div className="px-1 pt-0.5 text-xs font-medium text-slate-400">
                          a další…
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

      <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-400">
        <div className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#2980B9]" />
          Dnes
        </div>
        <div className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#2980B9]/50" />
          Schůzky
        </div>
      </div>

      <div className="mt-4 md:hidden">
        <Link
          href="/calendar"
          className="inline-flex items-center rounded-xl btn-glass-primary px-4 py-2 text-sm font-medium transition"
        >
          Otevřít kalendář
        </Link>
      </div>
    </section>
  )
}

function QuickNavCard({
  href,
  label,
  description,
}: {
  href: string
  label: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="glass-card group flex flex-col gap-1 rounded-xl p-4 transition duration-200 hover:bg-white/80"
    >
      <div className="text-sm font-semibold text-slate-800 group-hover:text-[#2980B9] transition-colors">
        {label}
      </div>
      <div className="text-xs text-slate-500">{description}</div>
    </Link>
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
      'name, role, last_seen_dashboard_at, last_seen_updates_at, can_view_jobs, can_view_jobs_portal'
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

  const lastSeenUpdatesAt = profile?.last_seen_updates_at ?? null
  const today = new Date()
  const nowIso = today.toISOString()
  const isFirstVisitToday = !isSamePragueDay(profile?.last_seen_dashboard_at ?? null, today)
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

  let todayMeetingsCountQuery = supabase
    .from('meetings')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'planned')
    .gte('meeting_datetime', todayStart)
    .lt('meeting_datetime', todayEnd)

  if (!isAdmin) {
    todayMeetingsCountQuery = todayMeetingsCountQuery.eq('assigned_user_id', user.id)
  }

  let weeklyMeetingsCountQuery = supabase
    .from('meetings')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'planned')
    .gte('meeting_datetime', start)
    .lt('meeting_datetime', end)

  if (!isAdmin) {
    weeklyMeetingsCountQuery = weeklyMeetingsCountQuery.eq('assigned_user_id', user.id)
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
    todayMeetingsCountResponse,
    weeklyMeetingsCountResponse,
    monthMeetingsResponse,
    newTasksCountResponse,
  ] = await Promise.all([
    supabase
      .from('tasks')
      .select(`
        id,
        title,
        status,
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

    todayMeetingsCountQuery,

    weeklyMeetingsCountQuery,

    monthMeetingsQuery,

    lastSeenUpdatesAt
      ? supabase
          .from('tasks')
          .select('id', { count: 'exact', head: true })
          .neq('status', 'done')
          .eq('assigned_to', user.id)
          .gt('created_at', lastSeenUpdatesAt)
      : Promise.resolve({ count: 0, error: null } as { count: number | null; error: null }),
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

  if (todayMeetingsCountResponse.error) {
    throw new Error(
      `Nepodařilo se načíst dnešní počet schůzek: ${todayMeetingsCountResponse.error.message}`
    )
  }

  if (weeklyMeetingsCountResponse.error) {
    throw new Error(
      `Nepodařilo se načíst týdenní počet schůzek: ${weeklyMeetingsCountResponse.error.message}`
    )
  }

  if (monthMeetingsResponse.error) {
    throw new Error(
      `Nepodařilo se načíst měsíční kalendář schůzek: ${monthMeetingsResponse.error.message}`
    )
  }

  if (newTasksCountResponse.error) {
    throw new Error(
      `Nepodařilo se načíst počet nových úkolů: ${newTasksCountResponse.error.message}`
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
  const todayMeetingsCount = todayMeetingsCountResponse.count ?? 0
  const newTasksCount = newTasksCountResponse.count ?? 0
  const hasNewUpdates = newTasksCount > 0
  const shouldShowOverlay = isFirstVisitToday || hasNewUpdates

  const overlayHeadline = getOverlayHeadline(hasNewUpdates)
  const overlayDescription = getOverlayDescription(
    hasNewUpdates,
    newTasksCount,
    todayMeetingsCount,
    overdueTasksCount
  )
  const overlaySummaryItems = buildOverlaySummaryItems({
    newTasksCount,
    todayMeetingsCount,
    overdueTasksCount,
  })

  return (
    <AppShell>
      {shouldShowOverlay ? (
        <DashboardWelcomeOverlay
          shouldShow={shouldShowOverlay}
          profileName={profile?.name ?? ''}
          newTasksCount={newTasksCount}
          todayMeetingsCount={todayMeetingsCount}
          overdueTasksCount={overdueTasksCount}
          headline={overlayHeadline}
          description={overlayDescription}
          summaryItems={overlaySummaryItems}
        />
      ) : null}

      <div className="flex flex-col gap-6 p-6 lg:p-8">
        {/* Page header */}
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
              Vítej zpět{profile?.name ? `, ${profile.name.split(' ')[0]}` : ''}!
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Přehled tvých úkolů a schůzek
            </p>
          </div>

          <div className="flex shrink-0 gap-2">
            <Link
              href="/tasks/new"
              className="inline-flex items-center rounded-xl btn-glass-primary px-4 py-2 text-sm font-medium transition"
            >
              + Nový úkol
            </Link>
            <Link
              href="/meetings/new"
              className="inline-flex items-center rounded-xl btn-glass-secondary px-4 py-2 text-sm font-medium transition"
            >
              + Schůzka
            </Link>
          </div>
        </div>

        {/* Quick nav (optional module shortcuts) */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:hidden">
          <QuickNavCard href="/clients" label="Klienti" description="Databáze klientů" />
          {profile?.can_view_jobs ? (
            <QuickNavCard href="/jobs" label="Zakázky" description="Přehled projektů" />
          ) : null}
          {profile?.can_view_jobs_portal ? (
            <QuickNavCard href="/jobs-portal" label="Portál" description="Portál zakázek" />
          ) : null}
          {isAdmin ? (
            <QuickNavCard href="/faktury" label="Finance" description="Faktury a platby" />
          ) : null}
        </div>

        {/* Main grid */}
        <div className="grid gap-6 xl:grid-cols-3">
          {/* Tasks + Meetings */}
          <div className="xl:col-span-2 space-y-6">
            {/* Tasks */}
            <section className="glass-card rounded-2xl p-5">
              <div className="mb-4">
                <DashboardSectionHeader
                  eyebrow="Úkoly"
                  title="Moje úkoly"
                  description="Nejbližší aktivní úkoly, které máš aktuálně přiřazené."
                />
              </div>

              <div className="mb-4 grid gap-3 sm:grid-cols-2">
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
                <div className="rounded-xl border border-dashed border-slate-200 bg-white/40 px-4 py-8 text-center text-sm text-slate-400">
                  Nemáš žádné aktivní úkoly.
                </div>
              ) : (
                <div className="grid gap-2">
                  {tasks.map((task) => (
                    <DashboardTaskItem key={task.id} task={task} />
                  ))}
                </div>
              )}

              <div className="mt-4">
                <Link
                  href="/tasks"
                  className="inline-flex items-center rounded-xl btn-glass-primary px-4 py-2 text-sm font-medium transition"
                >
                  Všechny úkoly
                </Link>
              </div>
            </section>

            {/* Meetings */}
            <section className="glass-card rounded-2xl p-5">
              <div className="mb-4">
                <DashboardSectionHeader
                  eyebrow="Schůzky"
                  title="Moje nejbližší schůzky"
                  description="Pět nejbližších plánovaných schůzek."
                />
              </div>

              <div className="mb-4 grid gap-3 sm:grid-cols-2">
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
                <div className="rounded-xl border border-dashed border-slate-200 bg-white/40 px-4 py-8 text-center text-sm text-slate-400">
                  Nemáš žádné nadcházející schůzky.
                </div>
              ) : (
                <div className="grid gap-2">
                  {meetings.map((meeting) => (
                    <DashboardMeetingItem key={meeting.id} meeting={meeting} />
                  ))}
                </div>
              )}

              <div className="mt-4">
                <Link
                  href="/meetings"
                  className="inline-flex items-center rounded-xl btn-glass-primary px-4 py-2 text-sm font-medium transition"
                >
                  Všechny schůzky
                </Link>
              </div>
            </section>
          </div>

          {/* Calendar */}
          <div className="space-y-6">
            <DashboardMiniCalendar meetings={monthMeetings} />
          </div>
        </div>
      </div>
    </AppShell>
  )
}
