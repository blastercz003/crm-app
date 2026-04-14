import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CalendarClient, { type CalendarEvent } from './calendar-client'

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
        'flex min-h-[46px] items-center justify-between rounded-2xl px-4 shadow-sm',
        highlighted
          ? 'border border-[#2980B9] bg-[#2980B9]'
          : 'border border-zinc-200 bg-zinc-50',
      ].join(' ')}
    >
      <div
        className={
          highlighted
            ? 'text-[11px] font-medium text-white/80'
            : 'text-[11px] font-medium text-zinc-500'
        }
      >
        {label}
      </div>
      <div
        className={
          highlighted
            ? 'text-base font-semibold text-white'
            : 'text-base font-semibold text-zinc-950'
        }
      >
        {value}
      </div>
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

  const { start: todayStart, end: todayEnd } = getTodayRange()
  const { start: weekStart, end: weekEnd } = getCurrentWeekRange()

  const [
    meetingsResponse,
    todayMeetingsCountResponse,
    weeklyMeetingsCountResponse,
    totalPlannedCountResponse,
  ] = await Promise.all([
    supabase
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
      .eq('assigned_user_id', user.id)
      .not('meeting_datetime', 'is', null)
      .order('meeting_datetime', { ascending: true }),

    supabase
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_user_id', user.id)
      .eq('status', 'planned')
      .gte('meeting_datetime', todayStart)
      .lt('meeting_datetime', todayEnd),

    supabase
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_user_id', user.id)
      .eq('status', 'planned')
      .gte('meeting_datetime', weekStart)
      .lt('meeting_datetime', weekEnd),

    supabase
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_user_id', user.id)
      .eq('status', 'planned')
      .not('meeting_datetime', 'is', null),
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

  const meetings = (meetingsResponse.data ?? []) as CalendarMeetingRow[]

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
    <main className="min-h-screen bg-zinc-100 px-6 py-6 md:px-10 md:py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-5 p-5 md:p-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Agenda
              </div>

              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950 md:text-4xl">
                Kalendář
              </h1>

              <p className="mt-3 text-sm leading-6 text-zinc-500 md:text-[15px]">
                Přehled všech tvých schůzek na jednom místě.
                <br />
                Kliknutím otevřeš detail, v týdenním view můžeš
                plánované schůzky přesouvat tažením.
              </p>
            </div>

            <div className="w-full lg:w-[420px]">
              <div className="grid grid-cols-2 gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex min-h-[46px] items-center justify-center rounded-2xl border border-zinc-300 bg-white px-5 py-3 text-sm font-medium tracking-[0.04em] text-zinc-700 transition duration-200 hover:bg-zinc-50 hover:text-zinc-950"
                >
                  ZPĚT NA DASHBOARD
                </Link>

                <Link
                  href="/meetings/new"
                  className="inline-flex min-h-[46px] items-center justify-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-[0.04em] text-white transition duration-200 hover:bg-zinc-800"
                >
                  NOVÁ SCHŮZKA
                </Link>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-3">
                <HeaderStatCard
                  label="Dnes"
                  value={todayMeetingsCount}
                  highlighted
                />
                <HeaderStatCard
                  label="Týden"
                  value={weeklyMeetingsCount}
                />
                <HeaderStatCard
                  label="Celkem"
                  value={totalPlannedCount}
                />
              </div>

              <div className="mt-3 flex flex-wrap gap-3 text-xs text-zinc-500">
                <div className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <span className="h-3 w-3 rounded-full bg-[#2980B9]" />
                  Plánovaná
                </div>
                <div className="inline-flex min-h-[46px] flex-1 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <span className="h-3 w-3 rounded-full bg-zinc-300" />
                  Proběhlá
                </div>
              </div>
            </div>
          </div>
        </section>

        <CalendarClient events={events} />
      </div>
    </main>
  )
}