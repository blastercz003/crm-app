import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getPriorityBadgeClass,
  getPriorityLabel,
} from '@/app/tasks/taskUi'

type ClientRow = {
  id: string
  name: string
  ico: string | null
  contact_person: string | null
  contact_phone: string | null
  contact_email: string | null
  address: string | null
  note: string | null
  created_at: string
}

type ClientMeetingRow = {
  id: string
  title: string | null
  meeting_datetime: string | null
  status: 'planned' | 'completed'
  contact_person: string | null
  company_name: string | null
}

type ClientTaskRow = {
  id: string
  title: string
  note: string | null
  due_date: string | null
  status: string | null
  priority: string | null
  contact_person: string | null
  assigned_to: string | null
  assignee:
    | {
        id: string
        name: string | null
      }
    | {
        id: string
        name: string | null
      }[]
    | null
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
  }).format(new Date(value))
}

function formatDateTime(value: string | null) {
  if (!value) return 'Bez termínu'

  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function resolveAssigneeName(
  assignee:
    | {
        id: string
        name: string | null
      }
    | {
        id: string
        name: string | null
      }[]
    | null
) {
  if (!assignee) return 'Nepřiřazeno'
  if (Array.isArray(assignee)) return assignee[0]?.name ?? 'Nepřiřazeno'
  return assignee.name ?? 'Nepřiřazeno'
}

function getTaskStatusLabel(status: string | null) {
  if (status === 'done') return 'Hotovo'
  return 'K vyřízení'
}

function getTaskStatusClass(status: string | null) {
  if (status === 'done') return 'bg-emerald-100 text-emerald-700'
  return 'bg-slate-100 text-slate-700'
}

export default async function ClientDetailPage({
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

  const [clientResponse, meetingsResponse, tasksResponse] = await Promise.all([
    supabase.from('clients').select('*').eq('id', id).single(),
    supabase
      .from('meetings')
      .select('id, title, meeting_datetime, status, contact_person, company_name')
      .eq('client_id', id)
      .order('meeting_datetime', { ascending: false }),
    supabase
      .from('tasks')
      .select(`
        id,
        title,
        note,
        due_date,
        status,
        priority,
        contact_person,
        assigned_to,
        assignee:assigned_to (
          id,
          name
        )
      `)
      .eq('client_id', id)
      .order('created_at', { ascending: false }),
  ])

  const { data: client, error: clientError } = clientResponse
  const { data: meetings, error: meetingsError } = meetingsResponse
  const { data: tasks, error: tasksError } = tasksResponse

  if (clientError || !client) {
    notFound()
  }

  if (meetingsError) {
    throw new Error('Nepodařilo se načíst schůzky klienta.')
  }

  if (tasksError) {
    throw new Error('Nepodařilo se načíst úkoly klienta.')
  }

  const typedClient = client as ClientRow
  const typedMeetings = (meetings ?? []) as ClientMeetingRow[]
  const typedTasks = (tasks ?? []) as ClientTaskRow[]

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
                  {typedClient.name}
                </h1>

                {typedClient.ico ? (
                  <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                    IČO: {typedClient.ico}
                  </span>
                ) : null}
              </div>

              <p className="text-sm text-gray-500">
                Klient vytvořen {formatDate(typedClient.created_at)}
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Link
                href={`/clients/${typedClient.id}/edit`}
                className="inline-flex items-center justify-center rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
              >
                UPRAVIT KLIENTA
              </Link>

              <Link
                href="/clients"
                className="inline-flex items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-medium text-white transition hover:opacity-90"
                style={{ backgroundColor: '#2980B9' }}
              >
                ZPĚT NA KLIENTY
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
                  Přehled hlavních údajů o klientovi.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Název firmy
                  </p>
                  <p className="mt-2 text-sm font-medium text-gray-900">
                    {typedClient.name}
                  </p>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    IČO
                  </p>
                  <p className="mt-2 text-sm font-medium text-gray-900">
                    {typedClient.ico || '—'}
                  </p>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Kontaktní osoba
                  </p>
                  <p className="mt-2 text-sm font-medium text-gray-900">
                    {typedClient.contact_person || '—'}
                  </p>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Telefon
                  </p>
                  <p className="mt-2 text-sm font-medium text-gray-900">
                    {typedClient.contact_phone || '—'}
                  </p>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 sm:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    E-mail
                  </p>
                  <p className="mt-2 break-all text-sm font-medium text-gray-900">
                    {typedClient.contact_email || '—'}
                  </p>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 sm:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Adresa
                  </p>
                  <p className="mt-2 text-sm font-medium text-gray-900">
                    {typedClient.address || '—'}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-gray-900">
                  Poznámka
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Interní informace ke klientovi.
                </p>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                <p className="whitespace-pre-wrap text-sm leading-6 text-gray-700">
                  {typedClient.note || 'Zatím bez poznámky.'}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-gray-900">
                Schůzky klienta
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Přehled všech schůzek navázaných na tohoto klienta.
              </p>
            </div>

            {typedMeetings.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
                Klient zatím nemá žádné schůzky.
              </div>
            ) : (
              <div className="space-y-3">
                {typedMeetings.map((meeting) => (
                  <Link
                    key={meeting.id}
                    href={`/meetings/${meeting.id}`}
                    className="block rounded-2xl border border-gray-200 bg-gray-50 p-4 transition hover:bg-gray-100"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {meeting.title || 'Bez názvu schůzky'}
                        </p>

                        <p className="mt-1 text-sm text-gray-600">
                          {meeting.contact_person ||
                            meeting.company_name ||
                            'Bez doplňujících údajů'}
                        </p>

                        <p className="mt-2 text-xs text-gray-500">
                          {formatDateTime(meeting.meeting_datetime)}
                        </p>
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                          meeting.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {meeting.status === 'completed'
                          ? 'Dokončeno'
                          : 'Plánováno'}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-5">
              <h2 className="text-lg font-semibold text-gray-900">
                Úkoly klienta
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Přehled úkolů navázaných na tohoto klienta.
              </p>
            </div>

            {typedTasks.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-500">
                Klient zatím nemá žádné úkoly.
              </div>
            ) : (
              <div className="space-y-3">
                {typedTasks.map((task) => (
                  <Link
                    key={task.id}
                    href={`/tasks/${task.id}/edit`}
                    className="block rounded-2xl border border-gray-200 bg-gray-50 p-4 transition hover:bg-gray-100"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {task.title}
                        </p>

                        <p className="mt-1 text-sm text-gray-600">
                          {task.contact_person || 'Bez kontaktní osoby'}
                        </p>

                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
                          <span>Termín: {task.due_date || 'Bez termínu'}</span>
                          <span>Řeší: {resolveAssigneeName(task.assignee)}</span>
                        </div>

                        {task.note ? (
                          <p className="mt-2 line-clamp-2 text-xs leading-5 text-gray-500">
                            {task.note}
                          </p>
                        ) : null}
                      </div>

                      <span
                        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${getTaskStatusClass(task.status)}`}
                      >
                        {getTaskStatusLabel(task.status)}
                      </span>
                    </div>

                    {task.priority ? (
                      <div className="mt-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getPriorityBadgeClass(task.priority)}`}
                        >
                          Priorita: {getPriorityLabel(task.priority)}
                        </span>
                      </div>
                    ) : null}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}
