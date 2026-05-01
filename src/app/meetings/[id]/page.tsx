import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { joinTitleParts } from '@/lib/pageTitles'
import { deleteMeeting } from '../actions'
import {
  MeetingStatusBadge,
  MeetingTaskBadge,
} from '@/components/meetings/meeting-status-badge'
import { getPriorityLabel } from '@/app/tasks/taskUi'

const PRAGUE_TIME_ZONE = 'Europe/Prague'

type MeetingDetail = {
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
  follow_up_task_note: string | null
  follow_up_task_priority: string | null
  follow_up_task_due_date: string | null
  status: 'planned' | 'completed'
  created_at: string | null
  updated_at: string | null
  assigned_user_id: string | null
  created_by: string | null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('meetings')
    .select('company_name, contact_person, title')
    .eq('id', id)
    .maybeSingle<Pick<MeetingDetail, 'company_name' | 'contact_person' | 'title'>>()

  const meetingTitle = joinTitleParts(
    data?.company_name,
    data?.contact_person,
    data?.title
  )

  return {
    title: meetingTitle ? `Schůzka - ${meetingTitle}` : 'Detail schůzky',
  }
}

function getMeetingDisplayStatus(meeting: MeetingDetail): 'planned' | 'overdue' | 'completed' {
  if (meeting.status === 'completed') {
    return 'completed'
  }

  if (!meeting.meeting_datetime) {
    return 'planned'
  }

  const meetingDate = new Date(meeting.meeting_datetime)

  if (Number.isNaN(meetingDate.getTime())) {
    return 'planned'
  }

  return meetingDate.getTime() < Date.now() ? 'overdue' : 'planned'
}

function formatDateTime(value: string | null) {
  if (!value) return 'Bez termínu'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return 'Bez termínu'
  }

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: PRAGUE_TIME_ZONE,
  }).format(date)
}

function formatDate(value: string | null) {
  if (!value) return '—'

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '—'
  }

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeZone: PRAGUE_TIME_ZONE,
  }).format(date)
}

function InfoCard({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-gray-900">{value}</p>
    </div>
  )
}

function ContentSection({
  title,
  description,
  value,
  emptyText,
}: {
  title: string
  description: string
  value: string | null | undefined
  emptyText: string
}) {
  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5">
        {value?.trim() ? (
          <p className="whitespace-pre-wrap text-sm leading-7 text-gray-700">
            {value}
          </p>
        ) : (
          <p className="text-sm text-gray-500">{emptyText}</p>
        )}
      </div>
    </section>
  )
}

function FollowUpTaskSection({
  title,
  description,
  taskTitle,
  taskNote,
  taskPriority,
  taskDueDate,
}: {
  title: string
  description: string
  taskTitle: string | null | undefined
  taskNote: string | null | undefined
  taskPriority: string | null | undefined
  taskDueDate: string | null | undefined
}) {
  const hasTaskTitle = Boolean(taskTitle?.trim())
  const hasTaskNote = Boolean(taskNote?.trim())

  return (
    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        <p className="mt-1 text-sm text-gray-500">{description}</p>
      </div>

      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5">
        {hasTaskTitle || hasTaskNote ? (
          <div className="space-y-4">
            {hasTaskTitle ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                  Název úkolu
                </div>
                <p className="mt-2 text-sm font-medium leading-7 text-gray-900">
                  {taskTitle}
                </p>
              </div>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                  Termín
                </div>
                <p className="mt-2 text-sm font-medium leading-7 text-gray-900">
                  {taskDueDate ?? 'Bez termínu'}
                </p>
              </div>

              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                  Priorita
                </div>
                <p className="mt-2 text-sm font-medium leading-7 text-gray-900">
                  {getPriorityLabel(taskPriority ?? 'medium')}
                </p>
              </div>
            </div>

            {hasTaskNote ? (
              <div>
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
                  Poznámka
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-gray-700">
                  {taskNote}
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Zatím bez navazujícího úkolu po schůzce.</p>
        )}
      </div>
    </section>
  )
}

export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('id', user.id)
    .single()

  if (profileError || !profile) {
    notFound()
  }

  const { data, error } = await supabase
    .from('meetings')
    .select(`
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
      follow_up_task_note,
      follow_up_task_priority,
      follow_up_task_due_date,
      status,
      created_at,
      updated_at,
      assigned_user_id,
      created_by
    `)
    .eq('id', id)
    .single()

  if (error || !data) {
    notFound()
  }

  const meeting = data as MeetingDetail
  const isAdmin = profile.role === 'admin'

  const canView =
    isAdmin ||
    meeting.assigned_user_id === user.id ||
    meeting.created_by === user.id

  if (!canView) {
    notFound()
  }

  const canDelete = isAdmin
  const hasTask = Boolean(meeting.follow_up_task?.trim())
  const displayStatus = getMeetingDisplayStatus(meeting)

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
                  {meeting.title ?? meeting.company_name ?? 'Detail schůzky'}
                </h1>

                <MeetingStatusBadge status={displayStatus} />
                {hasTask ? <MeetingTaskBadge /> : null}
              </div>

              <p className="text-sm text-gray-500">
                {meeting.company_name ?? 'Bez firmy'} · {formatDateTime(meeting.meeting_datetime)}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
              {canDelete ? (
                <form action={deleteMeeting}>
                  <input type="hidden" name="id" value={meeting.id} />
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-red-700 transition hover:bg-red-100"
                  >
                    SMAZAT SCHŮZKU
                  </button>
                </form>
              ) : null}

              <Link
                href={`/meetings/${meeting.id}/edit`}
                className="inline-flex items-center justify-center rounded-2xl bg-black px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:bg-gray-900"
              >
                UPRAVIT SCHŮZKU
              </Link>

              <Link
                href="/meetings"
                className="inline-flex items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:opacity-90"
                style={{ backgroundColor: '#2980B9' }}
              >
                ZPĚT NA SCHŮZKY
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-gray-900">
                  Základní informace
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Přehled hlavních údajů o schůzce a kontaktních informací.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <InfoCard label="Firma" value={meeting.company_name ?? '—'} />
                <InfoCard
                  label="Datum a čas"
                  value={formatDateTime(meeting.meeting_datetime)}
                />
                <InfoCard
                  label="Kontaktní osoba"
                  value={meeting.contact_person ?? '—'}
                />
                <InfoCard label="Telefon" value={meeting.contact_phone ?? '—'} />
                <InfoCard label="E-mail" value={meeting.contact_email ?? '—'} />
                <InfoCard label="Adresa" value={meeting.address ?? '—'} />
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-gray-900">
                  Shrnutí
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Rychlý přehled stavu a navazujících informací.
                </p>
              </div>

              <div className="space-y-3">
                <InfoCard
                  label="Stav"
                  value={
                    displayStatus === 'completed'
                      ? 'Proběhlo'
                      : displayStatus === 'overdue'
                        ? 'Po termínu'
                        : 'Plánováno'
                  }
                />
                <InfoCard
                  label="Úkol po schůzce"
                  value={hasTask ? 'Ano' : 'Ne'}
                />
                <InfoCard
                  label="Vytvořeno"
                  value={formatDate(meeting.created_at)}
                />
              </div>
            </div>
          </div>
        </section>

        <ContentSection
          title="Poznámka před schůzkou"
          description="Příprava, očekávání a interní poznámky před samotnou schůzkou."
          value={meeting.pre_meeting_note}
          emptyText="Zatím bez poznámky před schůzkou."
        />

        <ContentSection
          title="Výsledek schůzky"
          description="Shrnutí průběhu, závěrů a navazujících domluv."
          value={meeting.result_note}
          emptyText="Výsledek schůzky zatím nebyl doplněn."
        />

        <FollowUpTaskSection
          title="Navazující úkol"
          description="Navazující krok ze schůzky včetně názvu úkolu a doplňující poznámky."
          taskTitle={meeting.follow_up_task}
          taskNote={meeting.follow_up_task_note}
          taskPriority={meeting.follow_up_task_priority}
          taskDueDate={meeting.follow_up_task_due_date}
        />
      </div>
    </main>
  )
}
