import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { deleteMeeting } from '../actions'
import {
  MeetingStatusBadge,
  MeetingTaskBadge,
} from '@/components/meetings/meeting-status-badge'
import CommentSection from '@/components/comments/comment-section'

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
  status: 'planned' | 'completed'
  created_at: string | null
  updated_at: string | null
  assigned_user_id: string | null
  created_by: string | null
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

function DetailBlock({
  title,
  value,
  emptyText,
}: {
  title: string
  value: string | null | undefined
  emptyText: string
}) {
  return (
    <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
        {title}
      </h2>

      <div className="mt-4 whitespace-pre-wrap text-sm leading-6 text-zinc-800">
        {value?.trim() ? value : <span className="text-zinc-400">{emptyText}</span>}
      </div>
    </section>
  )
}

function InfoItem({
  label,
  value,
}: {
  label: string
  value: string
}) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-zinc-900">{value}</dd>
    </div>
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

  const canDelete = isAdmin || meeting.created_by === user.id
  const hasTask = Boolean(meeting.follow_up_task?.trim())

  return (
    <main className="min-h-screen bg-zinc-100 px-6 py-6 text-zinc-900 md:px-10 md:py-10">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-start lg:justify-between lg:p-10">
            <div>
              <Link
                href="/meetings"
                className="inline-flex items-center rounded-2xl border px-5 py-3 text-sm font-medium tracking-wide transition hover:opacity-90"
                style={{
                  borderColor: '#BFD9EC',
                  backgroundColor: '#EAF4FB',
                  color: '#2980B9',
                }}
              >
                ZPĚT NA SCHŮZKY
              </Link>

              <div className="mt-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
                Agenda
              </div>

              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-zinc-950">
                {meeting.title ?? meeting.company_name ?? 'Detail schůzky'}
              </h1>

              <div className="mt-2 text-sm text-zinc-500">
                {meeting.company_name ?? 'Bez firmy'} · {formatDateTime(meeting.meeting_datetime)}
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <MeetingStatusBadge status={meeting.status} />
                {hasTask ? <MeetingTaskBadge /> : null}
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <Link
                href={`/meetings/${meeting.id}/edit`}
                className="inline-flex items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-wide text-white transition hover:bg-zinc-800"
              >
                UPRAVIT SCHŮZKU
              </Link>

              {canDelete ? (
                <form action={deleteMeeting}>
                  <input type="hidden" name="id" value={meeting.id} />
                  <button
                    type="submit"
                    className="inline-flex items-center rounded-2xl border border-red-200 bg-red-50 px-5 py-3 text-sm font-medium tracking-wide text-red-700 transition hover:bg-red-100"
                  >
                    SMAZAT SCHŮZKU
                  </button>
                </form>
              ) : null}
            </div>
          </div>
        </section>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="rounded-[28px] border border-zinc-200 bg-white p-5 shadow-sm md:p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">
              Základní informace
            </div>

            <dl className="mt-5 grid gap-4">
              <InfoItem label="Firma" value={meeting.company_name ?? '—'} />
              <InfoItem label="Kontaktní osoba" value={meeting.contact_person ?? '—'} />
              <InfoItem label="Telefon" value={meeting.contact_phone ?? '—'} />
              <InfoItem label="E-mail" value={meeting.contact_email ?? '—'} />
              <InfoItem label="Adresa" value={meeting.address ?? '—'} />
              <InfoItem label="Datum a čas" value={formatDateTime(meeting.meeting_datetime)} />
              <InfoItem
                label="Stav"
                value={meeting.status === 'planned' ? 'Plánováno' : 'Proběhlo'}
              />
            </dl>
          </section>

          <DetailBlock
            title="Poznámka před schůzkou"
            value={meeting.pre_meeting_note}
            emptyText="Zatím bez poznámky."
          />

          <DetailBlock
            title="Výsledek schůzky"
            value={meeting.result_note}
            emptyText="Výsledek zatím nebyl doplněn."
          />

          <DetailBlock
            title="Úkol po schůzce"
            value={meeting.follow_up_task}
            emptyText="Zatím bez úkolu po schůzce."
          />
        </div>

        <CommentSection
          entityType="meeting"
          entityId={meeting.id}
          path={`/meetings/${meeting.id}`}
        />
      </div>
    </main>
  )
}