'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import csLocale from '@fullcalendar/core/locales/cs'
import type { EventClickArg, EventDropArg } from '@fullcalendar/core'
import { updateCalendarMeetingDate } from './actions'

const PRAGUE_TIME_ZONE = 'Europe/Prague'

export type CalendarEvent = {
  id: string
  title: string
  start: string
  editable?: boolean
  classNames?: string[]
  extendedProps?: {
    status: 'planned' | 'completed'
    companyName: string | null
    contactPerson: string | null
  }
}

type CalendarClientProps = {
  events: CalendarEvent[]
}

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function formatDateToPragueLocalInput(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: PRAGUE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  const parts = formatter.formatToParts(date)

  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  const hour = parts.find((part) => part.type === 'hour')?.value
  const minute = parts.find((part) => part.type === 'minute')?.value

  if (!year || !month || !day || !hour || !minute) {
    throw new Error('Nepodařilo se převést datum schůzky pro Europe/Prague.')
  }

  return `${year}-${month}-${day}T${hour}:${minute}`
}

export default function CalendarClient({ events }: CalendarClientProps) {
  const router = useRouter()
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  const calendarEvents = useMemo(() => events, [events])

  function handleEventClick(info: EventClickArg) {
    info.jsEvent.preventDefault()
    router.push(`/meetings/${info.event.id}`)
  }

  function handleEventDrop(info: EventDropArg) {
    const start = info.event.start

    if (!start) {
      info.revert()
      return
    }

    setError('')

    startTransition(async () => {
      const result = await updateCalendarMeetingDate({
        meetingId: info.event.id,
        start: formatDateToPragueLocalInput(start),
      })

      if (result?.error) {
        info.revert()
        setError(result.error)
        return
      }

      router.refresh()
    })
  }

  return (
    <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
      <div className="mb-5 flex flex-col gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
          Kalendář
        </div>
        <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">
          Moje schůzky
        </h2>
        <p className="text-sm text-zinc-500">
          Přepínej měsíc a týden. Plánované schůzky můžeš přesouvat tažením.
        </p>
      </div>

      {error ? (
        <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {isPending ? (
        <div className="mb-4 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
          Ukládám nový termín schůzky…
        </div>
      ) : null}

      <div className="calendar-shell">
        <FullCalendar
          plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
          initialView="timeGridWeek"
          locale={csLocale}
          timeZone={PRAGUE_TIME_ZONE}
          firstDay={1}
          weekends
          nowIndicator
          stickyHeaderDates
          editable
          eventStartEditable
          eventDurationEditable={false}
          allDaySlot={false}
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
          height="auto"
          events={calendarEvents}
          eventClick={handleEventClick}
          eventDrop={handleEventDrop}
          headerToolbar={{
            left: 'prev,next today',
            center: 'title',
            right: 'dayGridMonth,timeGridWeek',
          }}
          buttonText={{
            today: 'Dnes',
            month: 'Měsíc',
            week: 'Týden',
          }}
          views={{
            dayGridMonth: {
              dayHeaderFormat: { weekday: 'short' },
            },
            timeGridWeek: {
              dayHeaderFormat: {
                weekday: 'short',
                day: '2-digit',
                month: '2-digit',
              },
            },
          }}
          eventTimeFormat={{
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }}
          eventContent={(arg) => (
            <div className="fc-custom-event-inner">
              {arg.timeText ? (
                <div className="fc-custom-event-time">{arg.timeText}</div>
              ) : null}
              <div className="fc-custom-event-title">{arg.event.title}</div>
            </div>
          )}
        />
      </div>
    </section>
  )
}