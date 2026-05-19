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
    <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.10)]">
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
  description?: string
  value: string | null | undefined
  emptyText: string
}) {
  return (
    <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.10)]">
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
  description?: string
  taskTitle: string | null | undefined
  taskNote: string | null | undefined
  taskPriority: string | null | undefined
  taskDueDate: string | null | undefined
}) {
  const hasTaskTitle = Boolean(taskTitle?.trim())
  const hasTaskNote = Boolean(taskNote?.trim())

  return (
    <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
        {description ? (
          <p className="mt-1 text-sm text-gray-500">{description}</p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.10)]">
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
    <main className="relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
      />
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
                  {meeting.title ?? meeting.company_name ?? 'Detail schůzky'}
                </h1>

                <MeetingStatusBadge status={displayStatus} />
                {hasTask ? <MeetingTaskBadge /> : null}
              </div>

            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end">
              {canDelete ? (
                <form action={deleteMeeting}>
                  <input type="hidden" name="id" value={meeting.id} />
                  <button
                    type="submit"
                    className="inline-flex items-center justify-center rounded-2xl border border-red-500/85 bg-[linear-gradient(155deg,#ef4444_0%,#dc2626_100%)] px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_22px_rgba(220,38,38,0.24)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_14px_28px_rgba(220,38,38,0.3)]"
                  >
                    SMAZAT SCHŮZKU
                  </button>
                </form>
              ) : null}

              <Link
                href={`/meetings/${meeting.id}/edit`}
                className="inline-flex items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800"
              >
                UPRAVIT SCHŮZKU
              </Link>

              <Link
                href="/meetings"
                className="inline-flex items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)]"
              >
                ZPĚT NA SCHŮZKY
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-gray-900">
                  Základní informace
                </h2>
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
            <div className="h-full rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-gray-900">
                  Shrnutí
                </h2>
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
          value={meeting.pre_meeting_note}
          emptyText="Zatím bez poznámky před schůzkou."
        />

        <ContentSection
          title="Výsledek schůzky"
          value={meeting.result_note}
          emptyText="Výsledek schůzky zatím nebyl doplněn."
        />

        <FollowUpTaskSection
          title="Navazující úkol"
          taskTitle={meeting.follow_up_task}
          taskNote={meeting.follow_up_task_note}
          taskPriority={meeting.follow_up_task_priority}
          taskDueDate={meeting.follow_up_task_due_date}
        />
      </div>
    </main>
  )
}
