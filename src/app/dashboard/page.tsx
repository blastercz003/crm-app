import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  MeetingStatusBadge,
  MeetingTaskBadge,
} from '@/components/meetings/meeting-status-badge'
import {
  TaskSourceBadge,
  TaskStatusBadge,
} from '@/components/tasks/task-status-badge'

type ProfileRef = {
  id: string
  name: string | null
}

type DashboardTask = {
  id: string
  title: string
  status: 'todo' | 'done'
  source: 'manual' | 'meeting'
  meeting_id: string | null
  company_name: string | null
  contact_person: string | null
  due_at: string | null
  created_at: string
  assigned_user_id: string | null
  created_by_user_id: string | null
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

type DashboardComment = {
  id: string
  entity_type: 'task' | 'meeting' | string
  entity_id: string
  content: string | null
  created_at: string
  user_id: string | null
  created_by_profile?: ProfileRef | null
}

type CalendarDay = {
  date: Date
  isoKey: string
  dayNumber: number
  isCurrentMonth: boolean
  isToday: boolean
  meetings: DashboardMeeting[]
}

function formatDateTime(value: string | null) {
  if (!value) return 'Bez termínu'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatShortDateTime(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatMeetingTime(value: string | null) {
  if (!value) return 'Bez času'

  return new Intl.DateTimeFormat('cs-CZ', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function truncateText(value: string | null, maxLength = 140) {
  if (!value?.trim()) return 'Bez textu komentáře.'
  const clean = value.trim().replace(/\s+/g, ' ')
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, maxLength).trim()}…`
}

function getCommentEntityLabel(entityType: string) {
  if (entityType === 'task') return 'Úkol'
  if (entityType === 'meeting') return 'Schůzka'
  return 'Komentář'
}

function getCommentHref(comment: DashboardComment) {
  if (comment.entity_type === 'task') {
    return `/tasks/${comment.entity_id}`
  }

  if (comment.entity_type === 'meeting') {
    return `/meetings/${comment.entity_id}`
  }

  return '/dashboard'
}

function getCurrentWeekRange() {
  const now = new Date()
  const currentDay = now.getDay()
  const diffToMonday = currentDay === 0 ? -6 : 1 - currentDay

  const start = new Date(now)
  start.setHours(0, 0, 0, 0)
  start.setDate(now.getDate() + diffToMonday)

  const end = new Date(start)
  end.setDate(start.getDate() + 7)

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

function getTodayRange() {
  const now = new Date()

  const start = new Date(now)
  start.setHours(0, 0, 0, 0)

  const end = new Date(start)
  end.setDate(start.getDate() + 1)

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

function getMonthRange() {
  const now = new Date()

  const start = new Date(now.getFullYear(), now.getMonth(), 1)
  start.setHours(0, 0, 0, 0)

  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1)
  end.setHours(0, 0, 0, 0)

  return {
    start: start.toISOString(),
    end: end.toISOString(),
  }
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function getCalendarDays(meetings: DashboardMeeting[]): CalendarDay[] {
  const now = new Date()
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  const startDay = monthStart.getDay()
  const diffToMonday = startDay === 0 ? 6 : startDay - 1

  const calendarStart = new Date(monthStart)
  calendarStart.setDate(monthStart.getDate() - diffToMonday)
  calendarStart.setHours(0, 0, 0, 0)

  const endDay = monthEnd.getDay()
  const diffToSunday = endDay === 0 ? 0 : 7 - endDay

  const calendarEnd = new Date(monthEnd)
  calendarEnd.setDate(monthEnd.getDate() + diffToSunday)
  calendarEnd.setHours(0, 0, 0, 0)

  const meetingsByDay = new Map<string, DashboardMeeting[]>()

  for (const meeting of meetings) {
    if (!meeting.meeting_datetime) continue

    const meetingDate = new Date(meeting.meeting_datetime)
    const key = toDateKey(meetingDate)

    const existing = meetingsByDay.get(key) ?? []
    existing.push(meeting)
    meetingsByDay.set(key, existing)
  }

  for (const [key, dayMeetings] of meetingsByDay.entries()) {
    meetingsByDay.set(
      key,
      [...dayMeetings].sort((a, b) => {
        const aTime = a.meeting_datetime ? new Date(a.meeting_datetime).getTime() : 0
        const bTime = b.meeting_datetime ? new Date(b.meeting_datetime).getTime() : 0
        return aTime - bTime
      })
    )
  }

  const days: CalendarDay[] = []
  const cursor = new Date(calendarStart)

  while (cursor <= calendarEnd) {
    const key = toDateKey(cursor)

    days.push({
      date: new Date(cursor),
      isoKey: key,
      dayNumber: cursor.getDate(),
      isCurrentMonth: cursor.getMonth() === now.getMonth(),
      isToday: isSameDay(cursor, today),
      meetings: meetingsByDay.get(key) ?? [],
    })

    cursor.setDate(cursor.getDate() + 1)
  }

  return days
}

function DashboardStatCard({
  label,
  value,
  highlighted = false,
}: {
  label: string
  value: number
  highlighted?: boolean
}) {
  return (
    <div
      className={[
        'rounded-2xl px-4 py-3.5 shadow-sm transition',
        highlighted
          ? 'border border-[#2980B9] bg-[#2980B9]'
          : 'border border-zinc-200 bg-zinc-50',
      ].join(' ')}
    >
      <div className={highlighted ? 'text-xs text-white/80' : 'text-xs text-zinc-500'}>
        {label}
      </div>
      <div
        className={
          highlighted
            ? 'mt-1.5 text-xl font-semibold text-white'
            : 'mt-1.5 text-xl font-semibold text-zinc-950'
        }
      >
        {value}
      </div>
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

function DashboardTaskItem({ task }: { task: DashboardTask }) {
  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white px-5 py-4 shadow-sm transition duration-200 hover:border-zinc-300 hover:shadow-md">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold text-zinc-900">{task.title}</div>
        <TaskStatusBadge status={task.status} />
        <TaskSourceBadge source={task.source} />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        <span>Firma: {task.company_name ?? '—'}</span>
        <span>Kontakt: {task.contact_person ?? '—'}</span>
        <span>Termín: {formatDateTime(task.due_at)}</span>
      </div>

      <div className="mt-2 text-xs text-zinc-500">
        Zadal: {task.created_by_profile?.name?.trim() || '—'}
      </div>

      {task.meeting_id ? (
        <div className="mt-3">
          <Link
            href={`/meetings/${task.meeting_id}`}
            className="text-xs font-medium text-zinc-700 transition hover:text-zinc-950"
          >
            Otevřít schůzku →
          </Link>
        </div>
      ) : null}
    </div>
  )
}

function DashboardMeetingItem({ meeting }: { meeting: DashboardMeeting }) {
  const hasTask = Boolean(meeting.follow_up_task?.trim())

  const meetingDate = meeting.meeting_datetime
    ? new Date(meeting.meeting_datetime)
    : null

  const day = meetingDate
    ? new Intl.DateTimeFormat('cs-CZ', { day: '2-digit' }).format(meetingDate)
    : '--'

  const month = meetingDate
    ? new Intl.DateTimeFormat('cs-CZ', { month: 'short' }).format(meetingDate)
    : 'bez data'

  const time = meetingDate
    ? new Intl.DateTimeFormat('cs-CZ', {
        hour: '2-digit',
        minute: '2-digit',
      }).format(meetingDate)
    : 'Bez času'

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
    month: 'long',
    year: 'numeric',
  }).format(now)

  const calendarDays = getCalendarDays(meetings)
  const weekdayLabels = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne']

  return (
    <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
      <div className="mb-5 flex items-end justify-between gap-4">
        <DashboardSectionHeader
          eyebrow="Kalendář"
          title={monthLabel}
          description="Přehled schůzek v aktuálním měsíci."
        />

        <Link
          href="/calendar"
          className="hidden min-h-[46px] items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-[0.04em] text-white transition duration-200 hover:bg-zinc-800 md:inline-flex"
        >
          OTEVŘÍT KALENDÁŘ
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
                  'min-h-[82px] rounded-2xl border p-2 transition duration-200',
                  day.isCurrentMonth
                    ? 'border-zinc-200 bg-white'
                    : 'border-zinc-100 bg-zinc-50/70 text-zinc-400',
                  day.isToday ? 'ring-2 ring-zinc-900/10' : '',
                  hasMeetings
                    ? 'border-zinc-300 bg-zinc-50 hover:border-[#2980B9]/60'
                    : '',
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-2">
                  <div
                    className={[
                      'flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold',
                      day.isToday
                        ? 'bg-zinc-900 text-white'
                        : day.isCurrentMonth
                          ? 'text-zinc-900'
                          : 'text-zinc-400',
                    ].join(' ')}
                  >
                    {day.dayNumber}
                  </div>

                  {hasMeetings ? (
                    <div className="rounded-full bg-[#2980B9] px-2 py-0.5 text-[10px] font-semibold text-white">
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
      <div className="mb-5">
        <DashboardSectionHeader
          eyebrow="Sekce"
          title="Klienti"
          description="Rychlý vstup do klientské databáze a firemních kontaktů."
        />
      </div>

      <div className="mb-5 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-4">
        <div className="text-sm font-medium text-zinc-900">
          Firemní kontakty a detail klienta na jednom místě.
        </div>
        <div className="mt-1 text-sm text-zinc-500">
          Otevři seznam klientů, vyhledej konkrétní firmu a přejdi rovnou na její detail.
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/clients"
          className="inline-flex min-h-[46px] items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-[0.04em] text-white transition duration-200 hover:bg-zinc-800"
        >
          OTEVŘÍT KLIENTY
        </Link>
      </div>
    </section>
  )
}

function LatestCommentsCard({
  comments,
}: {
  comments: DashboardComment[]
}) {
  return (
    <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
      <div className="mb-5">
        <DashboardSectionHeader
          eyebrow="Teamwork"
          title="Nejnovější komentáře"
          description="Poslední komentáře z úkolů a schůzek, ke kterým máš přístup."
        />
      </div>

      {comments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
          Zatím tu nejsou žádné nové komentáře.
        </div>
      ) : (
        <div className="grid gap-3">
          {comments.map((comment) => (
            <Link
              key={comment.id}
              href={getCommentHref(comment)}
              className="block rounded-2xl border border-zinc-200/80 bg-white px-5 py-4 shadow-sm transition duration-200 hover:border-zinc-300 hover:shadow-md"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">
                  {getCommentEntityLabel(comment.entity_type)}
                </span>

                <span className="text-xs text-zinc-500">
                  {formatShortDateTime(comment.created_at)}
                </span>
              </div>

              <p className="mt-3 text-sm leading-6 text-zinc-800">
                {truncateText(comment.content)}
              </p>

              <div className="mt-3 text-xs text-zinc-500">
                Autor: {comment.created_by_profile?.name?.trim() || '—'}
              </div>
            </Link>
          ))}
        </div>
      )}
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
    .select('name, role')
    .eq('id', user.id)
    .single()

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

  const [
    tasksResponse,
    activeTasksCountResponse,
    overdueTasksCountResponse,
    meetingsResponse,
    todayMeetingsCountResponse,
    weeklyMeetingsCountResponse,
    monthMeetingsResponse,
    assignedTasksIdsResponse,
    createdTasksIdsResponse,
    meetingIdsResponse,
    commentsResponse,
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
        due_at,
        created_at,
        assigned_user_id,
        created_by_user_id
      `)
      .eq('status', 'todo')
      .eq('assigned_user_id', user.id)
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(5),

    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'todo')
      .eq('assigned_user_id', user.id),

    supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'todo')
      .eq('assigned_user_id', user.id)
      .lt('due_at', new Date().toISOString()),

    supabase
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
      .gte('meeting_datetime', new Date().toISOString())
      .order('meeting_datetime', { ascending: true })
      .limit(5),

    supabase
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_user_id', user.id)
      .gte('meeting_datetime', todayStart)
      .lt('meeting_datetime', todayEnd),

    supabase
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_user_id', user.id)
      .gte('meeting_datetime', start)
      .lt('meeting_datetime', end),

    supabase
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
      .gte('meeting_datetime', monthStart)
      .lt('meeting_datetime', monthEnd)
      .order('meeting_datetime', { ascending: true }),

    supabase
      .from('tasks')
      .select('id')
      .eq('assigned_user_id', user.id),

    supabase
      .from('tasks')
      .select('id')
      .eq('created_by_user_id', user.id),

    supabase
      .from('meetings')
      .select('id')
      .eq('assigned_user_id', user.id),

    supabase
      .from('comments')
      .select(`
        id,
        entity_type,
        entity_id,
        content,
        created_at,
        user_id
      `)
      .in('entity_type', ['task', 'meeting'])
      .order('created_at', { ascending: false })
      .limit(50),
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

  if (assignedTasksIdsResponse.error) {
    throw new Error(
      `Nepodařilo se načíst ID přiřazených úkolů: ${assignedTasksIdsResponse.error.message}`
    )
  }

  if (createdTasksIdsResponse.error) {
    throw new Error(
      `Nepodařilo se načíst ID vytvořených úkolů: ${createdTasksIdsResponse.error.message}`
    )
  }

  if (meetingIdsResponse.error) {
    throw new Error(`Nepodařilo se načíst ID schůzek: ${meetingIdsResponse.error.message}`)
  }

  if (commentsResponse.error) {
    throw new Error(`Nepodařilo se načíst komentáře: ${commentsResponse.error.message}`)
  }

  const tasks = ((tasksResponse.data ?? []) as DashboardTask[]).map((task) => ({
    ...task,
    created_by_profile: task.created_by_user_id
      ? profileMap.get(task.created_by_user_id) ?? null
      : null,
  }))

  const meetings = (meetingsResponse.data ?? []) as DashboardMeeting[]
  const monthMeetings = (monthMeetingsResponse.data ?? []) as DashboardMeeting[]

  const visibleTaskIds = new Set([
    ...((assignedTasksIdsResponse.data ?? []).map((row) => row.id as string)),
    ...((createdTasksIdsResponse.data ?? []).map((row) => row.id as string)),
  ])

  const visibleMeetingIds = new Set(
    (meetingIdsResponse.data ?? []).map((row) => row.id as string)
  )

  const recentComments = ((commentsResponse.data ?? []) as DashboardComment[])
    .filter((comment) => {
      if (comment.entity_type === 'task') {
        return visibleTaskIds.has(comment.entity_id)
      }

      if (comment.entity_type === 'meeting') {
        return visibleMeetingIds.has(comment.entity_id)
      }

      return false
    })
    .slice(0, 5)
    .map((comment) => ({
      ...comment,
      created_by_profile: comment.user_id
        ? profileMap.get(comment.user_id) ?? null
        : null,
    }))

  const activeTasksCount = activeTasksCountResponse.count ?? 0
  const overdueTasksCount = overdueTasksCountResponse.count ?? 0
  const todayMeetingsCount = todayMeetingsCountResponse.count ?? 0
  const weeklyMeetingsCount = weeklyMeetingsCountResponse.count ?? 0

  return (
    <main className="min-h-screen bg-zinc-100 text-zinc-900">
      <div className="px-6 py-6 md:px-10 md:py-10">
        <div className="mx-auto max-w-7xl space-y-6">
          <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 p-4 md:p-5 lg:flex-row lg:items-start lg:justify-between lg:p-5">
              <div className="self-start">
                <Link href="/dashboard" className="inline-flex flex-col items-start">
                  <Image
                    src="/logo.png"
                    alt="B-ENERGY"
                    width={150}
                    height={42}
                    priority
                    className="h-7 w-auto transition hover:opacity-80"
                  />
                  <div className="mt-1.5 text-left text-[13px] font-semibold uppercase tracking-[0.18em] text-zinc-800">
                    MY MINI CRM. #nebo ne?
                  </div>
                </Link>
              </div>

              <div className="w-full max-w-[320px] rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2.5 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1 text-[11px] text-zinc-500">
                    <div>
                      Uživatel:{' '}
                      <span className="font-medium text-zinc-900">
                        {profile?.name ?? user.email}
                      </span>
                    </div>
                    <div>
                      Role:{' '}
                      <span className="font-medium uppercase text-zinc-900">
                        {profile?.role ?? 'neuvedeno'}
                      </span>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-col gap-1.5">
                    <Link
                      href="/settings/password"
                      className="inline-flex min-h-[34px] items-center justify-center rounded-xl border border-zinc-300 bg-white px-3 py-1.5 text-[11px] font-medium tracking-[0.04em] text-zinc-700 transition duration-200 hover:bg-zinc-100 hover:text-zinc-950"
                    >
                      ZMĚNIT HESLO
                    </Link>

                    <form action="/auth/signout" method="post" className="shrink-0">
                      <button className="inline-flex min-h-[34px] w-full items-center justify-center rounded-xl bg-zinc-900 px-3 py-1.5 text-[11px] font-medium tracking-[0.04em] text-white transition duration-200 hover:bg-zinc-800">
                        ODHLÁSIT SE
                      </button>
                    </form>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-2">
            <div className="space-y-6">
              <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
                <div className="mb-5">
                  <DashboardSectionHeader
                    eyebrow="Úkoly"
                    title="Moje úkoly"
                    description="Nejbližší aktivní úkoly, které jsou aktuálně přiřazené tobě."
                  />
                </div>

                <div className="mb-5 grid gap-3 sm:grid-cols-2">
                  <DashboardStatCard
                    label="Aktivní úkoly"
                    value={activeTasksCount}
                    highlighted
                  />
                  <DashboardStatCard
                    label="Úkoly po termínu"
                    value={overdueTasksCount}
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

                  <Link
                    href="/tasks/new"
                    className="inline-flex min-h-[46px] items-center rounded-2xl border border-zinc-300 bg-white px-5 py-3 text-sm font-medium tracking-[0.04em] text-zinc-700 transition duration-200 hover:bg-zinc-50 hover:text-zinc-950"
                  >
                    NOVÝ ÚKOL
                  </Link>
                </div>
              </section>

              <DashboardMiniCalendar meetings={monthMeetings} />
            </div>

            <div className="space-y-6">
              <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
                <div className="mb-5">
                  <DashboardSectionHeader
                    eyebrow="Schůzky"
                    title="Moje nejbližší schůzky"
                    description="Pět nejbližších plánovaných schůzek."
                  />
                </div>

                <div className="mb-5 grid gap-3 sm:grid-cols-2">
                  <DashboardStatCard
                    label="Schůzky dnes"
                    value={todayMeetingsCount}
                    highlighted
                  />
                  <DashboardStatCard
                    label="Schůzky tento týden"
                    value={weeklyMeetingsCount}
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

                  <Link
                    href="/meetings/new"
                    className="inline-flex min-h-[46px] items-center rounded-2xl border border-zinc-300 bg-white px-5 py-3 text-sm font-medium tracking-[0.04em] text-zinc-700 transition duration-200 hover:bg-zinc-50 hover:text-zinc-950"
                  >
                    NOVÁ SCHŮZKA
                  </Link>
                </div>
              </section>

              <ClientsCard />

              <LatestCommentsCard comments={recentComments} />
            </div>
          </div>
        </div>
      </div>

      <footer className="border-t border-white/10 bg-zinc-950 px-6 py-5 md:px-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 text-xs text-white/70 md:flex-row md:items-center md:justify-between">
          <div>B-ENERGY CRM — coding by blaster</div>
          <div>v1.0.0</div>
        </div>
      </footer>
    </main>
  )
}