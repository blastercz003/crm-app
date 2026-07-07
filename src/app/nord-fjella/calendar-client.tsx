'use client'

import { useMemo, useRef, useState } from 'react'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import csLocale from '@fullcalendar/core/locales/cs'
import type { EventClickArg } from '@fullcalendar/core'

export type NordFjellaCalendarEvent = {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  display: 'auto' | 'block'
  backgroundColor: string
  borderColor: string
  textColor: string
  classNames?: string[]
  extendedProps: {
    reservationNumber: string
    recordTypeLabel: string
    statusLabel: string
    paymentLabel: string | null
    settlementLabel: string
    guestLabel: string
    amountLabel: string | null
  }
}

type NordFjellaCalendarClientProps = {
  events: NordFjellaCalendarEvent[]
}

type CalendarMode = 'month' | 'week' | 'list'

function CalendarModeButton({
  active,
  label,
  onClick,
}: {
  active: boolean
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
      className={[
        'inline-flex h-9 min-w-[92px] items-center justify-center whitespace-nowrap rounded-full px-3 text-[13px] font-medium transition duration-200 ease-out sm:h-10 sm:min-w-[104px] sm:px-4 sm:text-sm',
        active
          ? 'border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)]'
          : 'border border-transparent bg-transparent text-zinc-600 shadow-none hover:-translate-y-[1px] hover:text-zinc-900 [html[data-theme=\'dark\']_&]:text-slate-300 [html[data-theme=\'dark\']_&]:hover:text-white',
      ].join(' ')}
    >
      {label}
    </button>
  )
}

function getEventStartTime(event: NordFjellaCalendarEvent) {
  return new Date(event.start).getTime()
}

function formatDateRange(event: NordFjellaCalendarEvent) {
  const start = new Date(event.start)
  const end = new Date(event.end)
  const endMinusOneDay = new Date(end)
  endMinusOneDay.setUTCDate(endMinusOneDay.getUTCDate() - 1)

  return `${new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(start)} - ${new Intl.DateTimeFormat('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(endMinusOneDay)}`
}

export default function NordFjellaCalendarClient({
  events,
}: NordFjellaCalendarClientProps) {
  const [mode, setMode] = useState<CalendarMode>('month')
  const calendarRef = useRef<FullCalendar | null>(null)

  const sortedEvents = useMemo(
    () => [...events].sort((left, right) => getEventStartTime(left) - getEventStartTime(right)),
    [events]
  )

  function handleEventClick(info: EventClickArg) {
    info.jsEvent.preventDefault()
    const anchorId = `reservation-${info.event.id}`
    const target = document.getElementById(anchorId)

    if (!target) return

    target.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    })
  }

  function handleCalendarNavigation(action: 'prev' | 'next' | 'today') {
    const calendarApi = calendarRef.current?.getApi()

    if (!calendarApi) return

    if (action === 'prev') {
      calendarApi.prev()
      return
    }

    if (action === 'next') {
      calendarApi.next()
      return
    }

    calendarApi.today()
  }

  return (
    <section className="nord-fjella-panel rounded-[26px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px] sm:p-5 [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white sm:text-xl">
              Obsazenost objektu
            </h2>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2">
            {mode !== 'list' ? (
              <>
                <div className="nord-fjella-chip-group inline-flex w-fit items-center gap-0 rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.78)]">
                  <button
                    type="button"
                    onClick={() => handleCalendarNavigation('prev')}
                    className="inline-flex h-9 min-w-[52px] items-center justify-center rounded-full px-3 text-[20px] font-medium leading-none text-zinc-700 transition duration-200 ease-out hover:-translate-y-[1px] hover:text-zinc-900 [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&]:hover:text-white sm:h-10 sm:min-w-[56px]"
                    aria-label="Předchozí období"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCalendarNavigation('next')}
                    className="inline-flex h-9 min-w-[52px] items-center justify-center rounded-full px-3 text-[20px] font-medium leading-none text-zinc-700 transition duration-200 ease-out hover:-translate-y-[1px] hover:text-zinc-900 [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&]:hover:text-white sm:h-10 sm:min-w-[56px]"
                    aria-label="Následující období"
                  >
                    ›
                  </button>
                </div>

                <div className="nord-fjella-chip-group inline-flex w-fit items-center gap-1 rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.78)]">
                  <button
                    type="button"
                    onClick={() => handleCalendarNavigation('today')}
                    className="inline-flex h-9 min-w-[92px] items-center justify-center whitespace-nowrap rounded-full px-3 text-[13px] font-medium text-zinc-600 transition duration-200 ease-out hover:-translate-y-[1px] hover:text-zinc-900 [html[data-theme='dark']_&]:text-slate-300 [html[data-theme='dark']_&]:hover:text-white sm:h-10 sm:min-w-[104px] sm:px-4 sm:text-sm"
                  >
                    Dnes
                  </button>
                </div>
              </>
            ) : null}

            <div className="nord-fjella-chip-group inline-flex w-fit items-center gap-1 rounded-full border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.78)]">
              <CalendarModeButton active={mode === 'month'} label="Měsíc" onClick={() => setMode('month')} />
              <CalendarModeButton active={mode === 'week'} label="Týden" onClick={() => setMode('week')} />
              <CalendarModeButton active={mode === 'list'} label="Seznam" onClick={() => setMode('list')} />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 [html[data-theme='dark']_&]:text-slate-400">
          <span className="nord-fjella-chip inline-flex items-center gap-2 rounded-full border border-white/75 bg-white/90 px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.78)]">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#16a34a]" />
            Rezervace
          </span>
          <span className="nord-fjella-chip inline-flex items-center gap-2 rounded-full border border-white/75 bg-white/90 px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.78)]">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#71717a]" />
            Proběhlo
          </span>
          <span className="nord-fjella-chip inline-flex items-center gap-2 rounded-full border border-white/75 bg-white/90 px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.78)]">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#e11d48]" />
            Storno
          </span>
          <span className="nord-fjella-chip inline-flex items-center gap-2 rounded-full border border-white/75 bg-white/90 px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.78)]">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#7c3aed]" />
            Vlastní pobyt
          </span>
          <span className="nord-fjella-chip inline-flex items-center gap-2 rounded-full border border-white/75 bg-white/90 px-2.5 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.92)] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.78)]">
            <span className="inline-flex h-2.5 w-2.5 rounded-full bg-[#f59e0b]" />
            Technická blokace
          </span>
        </div>

        {mode === 'list' ? (
          <div className="grid gap-3">
            {sortedEvents.length === 0 ? (
              <div className="nord-fjella-card rounded-[24px] border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-4 text-sm text-zinc-600 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_28px_rgba(15,23,42,0.08)] backdrop-blur-[10px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[linear-gradient(155deg,rgba(17,27,46,0.96)_0%,rgba(12,20,34,0.94)_100%)] [html[data-theme='dark']_&]:text-slate-300">
                V seznamu zatím nejsou žádné rezervace ani blokace.
              </div>
            ) : (
              sortedEvents.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => {
                    const target = document.getElementById(`reservation-${event.id}`)
                    target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                  }}
                  className="nord-fjella-card flex w-full flex-col items-start gap-2 rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.92)_0%,rgba(240,245,250,0.86)_100%)] px-4 py-3 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_18px_rgba(15,23,42,0.08)] transition duration-200 hover:-translate-y-[1px] [html[data-theme='dark']_&]:border-[rgba(148,163,184,0.16)] [html[data-theme='dark']_&]:bg-[rgba(15,23,42,0.78)]"
                >
                  <div className="flex w-full items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-zinc-900 [html[data-theme='dark']_&]:text-white">
                        {event.title}
                      </div>
                      <div className="mt-1 text-xs text-zinc-500 [html[data-theme='dark']_&]:text-slate-400">
                        {formatDateRange(event)}
                      </div>
                    </div>
                    <span
                      className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold"
                      style={{
                        backgroundColor: event.backgroundColor,
                        color: event.textColor,
                      }}
                    >
                      {event.extendedProps.statusLabel}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2 text-xs text-zinc-600 [html[data-theme='dark']_&]:text-slate-300">
                    <span>{event.extendedProps.recordTypeLabel}</span>
                    {event.extendedProps.paymentLabel ? <span>• {event.extendedProps.paymentLabel}</span> : null}
                    <span>• {event.extendedProps.settlementLabel}</span>
                    {event.extendedProps.amountLabel ? <span>• {event.extendedProps.amountLabel}</span> : null}
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="calendar-shell nord-fjella-calendar-shell">
            <FullCalendar
              key={mode}
              ref={calendarRef}
              plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
              initialView={mode === 'month' ? 'dayGridMonth' : 'timeGridWeek'}
              viewDidMount={(arg) => {
                const nextMode = arg.view.type === 'dayGridMonth' ? 'month' : 'week'
                if (nextMode !== mode) {
                  setMode(nextMode)
                }
              }}
              locale={csLocale}
              timeZone="Europe/Prague"
              firstDay={1}
              weekends
              nowIndicator
              stickyHeaderDates
              editable={false}
              selectable={false}
              allDaySlot
              height="auto"
              dayMaxEventRows={4}
              events={events}
              eventClick={handleEventClick}
              headerToolbar={{
                left: '',
                center: 'title',
                right: '',
              }}
              buttonText={{
                today: 'Dnes',
                month: 'Měsíc',
                week: 'Týden',
              }}
              views={{
                dayGridMonth: {
                  dayHeaderFormat: { weekday: 'short' },
                  fixedWeekCount: false,
                },
                timeGridWeek: {
                  dayHeaderFormat: {
                    weekday: 'short',
                    day: '2-digit',
                    month: '2-digit',
                  },
                },
              }}
              eventContent={(arg) => (
                <div className="fc-custom-event-inner">
                  <div className="fc-custom-event-title">{arg.event.title}</div>
                  <div className="mt-0.5 text-[10px] font-medium opacity-80">
                    {arg.event.extendedProps.statusLabel}
                  </div>
                </div>
              )}
            />
          </div>
        )}
      </div>
    </section>
  )
}
