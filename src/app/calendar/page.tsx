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

export default async function CalendarPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data, error } = await supabase
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
    .order('meeting_datetime', { ascending: true })

  if (error) {
    throw new Error('Nepodařilo se načíst schůzky do kalendáře.')
  }

  const meetings = (data ?? []) as CalendarMeetingRow[]

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

  return (
    <main className="min-h-screen bg-zinc-100 px-6 py-6 md:px-10 md:py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="rounded-[28px] border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-400">
                Agenda
              </div>
              <h1 className="mt-2 text-3xl font-semibold text-zinc-950">
                Kalendář
              </h1>
              <p className="mt-2 text-sm text-zinc-500">
                Měsíční a týdenní přehledný náhled.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href="/dashboard"
                className="inline-flex items-center rounded-2xl border border-zinc-300 bg-white px-5 py-3 text-sm font-medium tracking-wide text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950"
              >
                ZPĚT NA DASHBOARD
              </Link>

              <Link
                href="/meetings/new"
                className="inline-flex items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-wide text-white transition hover:bg-zinc-800"
              >
                NOVÁ SCHŮZKA
              </Link>
            </div>
          </div>
        </section>

        <CalendarClient events={events} />
      </div>
    </main>
  )
}