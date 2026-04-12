import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import {
  MeetingStatusBadge,
  MeetingTaskBadge,
} from '@/components/meetings/meeting-status-badge'

type MeetingRow = {
  id: string
  company_name: string | null
  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null
  address: string | null
  title: string | null
  meeting_datetime: string | null
  pre_meeting_note: string | null
  result_note: string | null
  follow_up_task: string | null
  status: 'planned' | 'completed'
  comment_count: number
  client:
    | {
        id: string
        name: string
      }[]
    | null
}

function formatDateTime(value: string | null) {
  if (!value) return 'Bez termínu'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function getPreviewText(meeting: MeetingRow) {
  if (meeting.status === 'completed' && meeting.result_note) {
    return meeting.result_note
  }

  if (meeting.pre_meeting_note) {
    return meeting.pre_meeting_note
  }

  if (meeting.contact_email) {
    return meeting.contact_email
  }

  if (meeting.address) {
    return meeting.address
  }

  return 'Bez doplňujících poznámek'
}

function trimText(text: string, max = 120) {
  if (text.length <= max) return text
  return `${text.slice(0, max).trim()}…`
}

function attachCommentCounts(
  meetings: Omit<MeetingRow, 'comment_count'>[],
  commentEntityIds: string[]
): MeetingRow[] {
  const commentCountByMeetingId = new Map<string, number>()

  for (const entityId of commentEntityIds) {
    commentCountByMeetingId.set(
      entityId,
      (commentCountByMeetingId.get(entityId) ?? 0) + 1
    )
  }

  return meetings.map((meeting) => ({
    ...meeting,
    comment_count: commentCountByMeetingId.get(meeting.id) ?? 0,
  }))
}

function MeetingListItem({ meeting }: { meeting: MeetingRow }) {
  const preview = trimText(getPreviewText(meeting))
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

  const companyLabel =
    meeting.client?.[0]?.name ?? meeting.company_name ?? 'Bez firmy'

  return (
    <Link
      href={`/meetings/${meeting.id}`}
      className="block rounded-2xl border border-zinc-200/80 bg-white px-5 py-4 shadow-sm transition hover:border-zinc-300 hover:shadow-md"
    >
      <div className="flex items-start gap-4">
        <div className="flex w-[78px] shrink-0 flex-col items-center rounded-2xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-center">
          <div className="text-2xl font-semibold leading-none text-zinc-950">
            {day}
          </div>

          <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
            {month}
          </div>

          <div className="mt-3 w-full rounded-xl border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700">
            {time}
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-sm font-semibold text-zinc-900">
                  {companyLabel}
                </div>

                <span className="inline-flex items-center rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-medium text-zinc-700">
                  💬 {meeting.comment_count}
                </span>
              </div>

              <div className="mt-1 text-sm text-zinc-600">
                {meeting.contact_person ?? meeting.title ?? 'Bez kontaktní osoby'}
              </div>

              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-500">
                {meeting.contact_phone ? <span>{meeting.contact_phone}</span> : null}
                {meeting.contact_email ? <span>{meeting.contact_email}</span> : null}
              </div>

              <div className="mt-3 text-xs leading-5 text-zinc-500">
                {preview}
              </div>

              <div className="mt-3 text-xs text-zinc-400">
                {meeting.status === 'planned' ? 'Nadcházející schůzka' : 'Uzavřená schůzka'} ·{' '}
                {formatDateTime(meeting.meeting_datetime)}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <MeetingStatusBadge status={meeting.status} />
              {hasTask ? <MeetingTaskBadge /> : null}
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

function StatCard({
  label,
  value,
}: {
  label: string
  value: number
}) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white px-4 py-3 shadow-sm">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-zinc-900">{value}</div>
    </div>
  )
}

export default async function MeetingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Uživatel není přihlášen.')
  }

  const meetingSelect = `
    id,
    company_name,
    contact_person,
    contact_phone,
    contact_email,
    address,
    title,
    meeting_datetime,
    pre_meeting_note,
    result_note,
    follow_up_task,
    status,
    client:clients (
      id,
      name
    )
  `

  const plannedResponse = await supabase
    .from('meetings')
    .select(meetingSelect)
    .eq('assigned_user_id', user.id)
    .eq('status', 'planned')
    .order('meeting_datetime', { ascending: true })

  const completedResponse = await supabase
    .from('meetings')
    .select(meetingSelect)
    .eq('assigned_user_id', user.id)
    .eq('status', 'completed')
    .order('meeting_datetime', { ascending: false })

  if (plannedResponse.error) {
    throw new Error(
      `Nepodařilo se načíst plánované schůzky: ${plannedResponse.error.message}`
    )
  }

  if (completedResponse.error) {
    throw new Error(
      `Nepodařilo se načíst proběhlé schůzky: ${completedResponse.error.message}`
    )
  }

  const plannedMeetingsBase = (plannedResponse.data ?? []) as Omit<
    MeetingRow,
    'comment_count'
  >[]
  const completedMeetingsBase = (completedResponse.data ?? []) as Omit<
    MeetingRow,
    'comment_count'
  >[]

  const allMeetingIds = [
    ...plannedMeetingsBase.map((meeting) => meeting.id),
    ...completedMeetingsBase.map((meeting) => meeting.id),
  ]

  const uniqueMeetingIds = Array.from(new Set(allMeetingIds))

  const { data: comments, error: commentsError } = uniqueMeetingIds.length
    ? await supabase
        .from('comments')
        .select('entity_id')
        .eq('entity_type', 'meeting')
        .in('entity_id', uniqueMeetingIds)
    : { data: [], error: null }

  if (commentsError) {
    throw new Error('Nepodařilo se načíst počty komentářů ke schůzkám.')
  }

  const commentEntityIds = (comments ?? []).map((row) => row.entity_id as string)

  const plannedMeetings = attachCommentCounts(
    plannedMeetingsBase,
    commentEntityIds
  )
  const completedMeetings = attachCommentCounts(
    completedMeetingsBase,
    commentEntityIds
  )

  const totalCount = plannedMeetings.length + completedMeetings.length
  const taskCount =
    plannedMeetings.filter((m) => m.follow_up_task?.trim()).length +
    completedMeetings.filter((m) => m.follow_up_task?.trim()).length

  return (
    <main className="min-h-screen bg-zinc-100 px-6 py-6 text-zinc-900 md:px-10 md:py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-start lg:justify-between lg:p-10">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Agenda
              </div>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
                Schůzky
              </h1>
              <p className="mt-2 text-sm text-zinc-500">
                Přehled plánovaných a proběhlých schůzek.
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

        <section className="flex flex-wrap gap-3">
          <StatCard label="Celkem schůzek" value={totalCount} />
          <StatCard label="Plánované" value={plannedMeetings.length} />
          <StatCard label="Proběhlé" value={completedMeetings.length} />
          <StatCard label="S úkolem" value={taskCount} />
        </section>

        <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Aktuální agenda
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
                Plánované
              </h2>
            </div>

            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm text-zinc-500">
              {plannedMeetings.length}
            </span>
          </div>

          {plannedMeetings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
              Zatím tu není žádná plánovaná schůzka.
            </div>
          ) : (
            <div className="grid gap-3">
              {plannedMeetings.map((meeting) => (
                <MeetingListItem key={meeting.id} meeting={meeting} />
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Historie
              </div>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
                Proběhlé
              </h2>
            </div>

            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm text-zinc-500">
              {completedMeetings.length}
            </span>
          </div>

          {completedMeetings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-8 text-sm text-zinc-500">
              Zatím tu není žádná proběhlá schůzka.
            </div>
          ) : (
            <div className="grid gap-3">
              {completedMeetings.map((meeting) => (
                <MeetingListItem key={meeting.id} meeting={meeting} />
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}