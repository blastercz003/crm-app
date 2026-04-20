import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CalendarClient, { type CalendarEvent } from './calendar-client'
import { NewMeetingButton } from '@/app/meetings/new-meeting-button'

const PRAGUE_TIME_ZONE = 'Europe/Prague'

type CalendarMeetingRow = {
  id: string
  company_name: string | null
  contact_person: string | null
  meeting_datetime: string | null
  title: string | null
  status: 'planned' | 'completed'
  assigned_user_id: string | null
  created_by: string | null
}

type ClientOption = {
  id: string
  name: string
}

function buildEventTitle(meeting: CalendarMeetingRow) {
  const company = meeting.company_name?.trim()
  const person = meeting.contact_person?.trim()
  const title = meeting.title?.trim()

  if (company && person) return `${company} · ${person}`
  if (company) return company
  if (person) return person
  return title || 'Schůzka'
}

function convertUtcMeetingDateToPragueCalendarStart(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    throw new Error('Schůzka má neplatný formát data.')
  }

  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })

  const parts = formatter.formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  const hour = parts.find((part) => part.type === 'hour')?.value
  const minute = parts.find((part) => part.type === 'minute')?.value
  const second = parts.find((part) => part.type === 'second')?.value

  if (!year || !month || !day || !hour || !minute || !second) {
    throw new Error('Nepodařilo se převést datum schůzky pro kalendář.')
  }

  return `${year}-${month}-${day}T${hour}:${minute}:${second}`
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
    throw new Error(
      'Nepodařilo se zpracovat offset časového pásma Europe/Prague.'
    )
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
  const utcGuess = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second)
  )

  if (Number.isNaN(utcGuess.getTime())) {
    throw new Error('Nepodařilo se vytvořit datum pro Europe/Prague.')
  }

  const offsetMinutes = getPragueOffsetMinutes(utcGuess)

  const correctedUtcDate = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) -
      offsetMinutes * 60_000
  )

  if (Number.isNaN(correctedUtcDate.getTime())) {
    throw new Error('Nepodařilo se vytvořit datum pro Europe/Prague.')
  }

  return correctedUtcDate.toISOString()
}

function getPragueDateParts(date: Date) {
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

function HeaderStatCard({
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
        'inline-flex items-center justify-between rounded-2xl px-4 py-2.5 text-sm shadow-sm',
        highlighted
          ? 'border border-[#2980B9] bg-[#2980B9]'
          : 'border border-gray-200 bg-white',
      ].join(' ')}
    >
      <span
        className={
          highlighted
            ? 'text-[11px] font-medium text-white/80'
            : 'text-[11px] font-medium text-gray-500'
        }
      >
        {label}
      </span>
      <span
        className={
          highlighted
            ? 'ml-3 text-sm font-semibold text-white'
            : 'ml-3 text-sm font-semibold text-gray-900'
        }
      >
        {value}
      </span>
    </div>
  )
}

function LegendCard({
  label,
  dotClassName,
}: {
  label: string
  dotClassName: string
}) {
  return (
    <div className="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-700 shadow-sm">
      <span className={`h-3 w-3 rounded-full ${dotClassName}`} />
      <span className="text-xs font-medium">{label}</span>
    </div>
  )
}

export default async function CalendarPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single<{ role: 'admin' | 'member' }>()

  const { start: todayStart, end: todayEnd } = getTodayRange()
  const { start: weekStart, end: weekEnd } = getCurrentWeekRange()
  const isAdmin = profile?.role === 'admin'

  let meetingsQuery = supabase
    .from('meetings')
    .select(`
      id,
      company_name,
      contact_person,
      meeting_datetime,
      title,
      status,
      assigned_user_id,
      created_by
    `)
    .not('meeting_datetime', 'is', null)
    .order('meeting_datetime', { ascending: true })

  if (!isAdmin) {
    meetingsQuery = meetingsQuery.eq('assigned_user_id', user.id)
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
    .gte('meeting_datetime', weekStart)
    .lt('meeting_datetime', weekEnd)

  if (!isAdmin) {
    weeklyMeetingsCountQuery = weeklyMeetingsCountQuery.eq('assigned_user_id', user.id)
  }

  let totalPlannedCountQuery = supabase
    .from('meetings')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'planned')
    .not('meeting_datetime', 'is', null)

  if (!isAdmin) {
    totalPlannedCountQuery = totalPlannedCountQuery.eq('assigned_user_id', user.id)
  }

  const [
    meetingsResponse,
    todayMeetingsCountResponse,
    weeklyMeetingsCountResponse,
    totalPlannedCountResponse,
    clientsResponse,
  ] = await Promise.all([
    meetingsQuery,

    todayMeetingsCountQuery,

    weeklyMeetingsCountQuery,

    totalPlannedCountQuery,

    supabase
      .from('clients')
      .select('id, name')
      .order('name', { ascending: true }),
  ])

  if (meetingsResponse.error) {
    throw new Error('Nepodařilo se načíst schůzky do kalendáře.')
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

  if (totalPlannedCountResponse.error) {
    throw new Error(
      `Nepodařilo se načíst celkový počet plánovaných schůzek: ${totalPlannedCountResponse.error.message}`
    )
  }

  if (clientsResponse.error) {
    throw new Error('Nepodařilo se načíst klienty.')
  }

  const meetings = (meetingsResponse.data ?? []) as CalendarMeetingRow[]
  const clientOptions = (clientsResponse.data ?? []) as ClientOption[]

  const events: CalendarEvent[] = meetings
    .filter((meeting) => Boolean(meeting.meeting_datetime))
    .map((meeting) => {
      const isCompleted = meeting.status === 'completed'

      return {
        id: meeting.id,
        title: buildEventTitle(meeting),
        start: convertUtcMeetingDateToPragueCalendarStart(
          meeting.meeting_datetime as string
        ),
        editable: !isCompleted,
        classNames: [isCompleted ? 'fc-event-completed' : 'fc-event-planned'],
        extendedProps: {
          status: meeting.status,
          companyName: meeting.company_name,
          contactPerson: meeting.contact_person,
        },
      }
    })

  const todayMeetingsCount = todayMeetingsCountResponse.count ?? 0
  const weeklyMeetingsCount = weeklyMeetingsCountResponse.count ?? 0
  const totalPlannedCount = totalPlannedCountResponse.count ?? 0

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-[1920px] flex-col gap-5 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:relative lg:min-h-[42px] lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-end">
              <h1 className="text-3xl font-semibold leading-none tracking-tight text-gray-900">
                Kalendář
              </h1>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 lg:absolute lg:left-1/2 lg:top-1/2 lg:w-[760px] lg:-translate-x-1/2 lg:-translate-y-1/2 lg:grid lg:grid-cols-[1fr_auto_1fr] lg:gap-4">
              <div className="flex flex-wrap items-center justify-end gap-3">
                <HeaderStatCard
                  label="Dnes"
                  value={todayMeetingsCount}
                  highlighted
                />
                <HeaderStatCard label="Týden" value={weeklyMeetingsCount} />
              </div>

              <div className="flex items-center justify-center">
                <HeaderStatCard label="Celkem" value={totalPlannedCount} />
              </div>

              <div className="flex flex-wrap items-center justify-start gap-3">
                <LegendCard
                  label="Plánovaná"
                  dotClassName="bg-[#2980B9]"
                />
                <LegendCard
                  label="Proběhlá"
                  dotClassName="bg-zinc-300"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 lg:justify-end">
              <Link
                href="/dashboard"
                className="inline-flex items-center justify-center rounded-2xl bg-black px-4 py-2.5 text-sm font-medium text-white transition-opacity duration-200 hover:opacity-85"
              >
                ZPĚT NA DASHBOARD
              </Link>

              <NewMeetingButton clients={clientOptions} />
            </div>
          </div>
        </section>

        <CalendarClient events={events} />
      </div>
    </main>
  )
}
