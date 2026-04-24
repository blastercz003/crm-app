import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/getCurrentProfile'
import { updateTaskStatus } from '../actions'
import {
  getStatusBadgeClass,
  getStatusLabel,
} from '../taskUi'

type TaskDetailPageProps = {
  params: Promise<{
    id: string
  }>
}

type TaskRow = {
  id: string
  title: string
  note: string | null
  due_date: string | null
  status: string | null
  priority: string | null
  assigned_to: string | null
  created_by: string | null
  client_id: string | null
  company_name: string | null
  contact_person: string | null
  created_at: string
  creator:
    | {
        id: string
        name: string | null
      }
    | {
        id: string
        name: string | null
      }[]
    | null
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
  client:
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

function resolvePersonName(
  person:
    | {
        id: string
        name: string | null
      }
    | {
        id: string
        name: string | null
      }[]
    | null,
  fallback: string
) {
  if (!person) return fallback
  if (Array.isArray(person)) return person[0]?.name ?? fallback
  return person.name ?? fallback
}

function resolveClientName(
  client:
    | {
        id: string
        name: string | null
      }
    | {
        id: string
        name: string | null
      }[]
    | null,
  fallback: string
) {
  if (!client) return fallback
  if (Array.isArray(client)) return client[0]?.name ?? fallback
  return client.name ?? fallback
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('cs-CZ', {
    dateStyle: 'medium',
  }).format(new Date(value))
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

export default async function TaskDetailPage({
  params,
}: TaskDetailPageProps) {
  const { id } = await params
  const supabase = await createClient()
  const currentProfile = await getCurrentProfile()

  const { data: task, error } = await supabase
    .from('tasks')
    .select(`
      id,
      title,
      note,
      due_date,
      status,
      priority,
      assigned_to,
      created_by,
      client_id,
      company_name,
      contact_person,
      created_at,
      creator:created_by (
        id,
        name
      ),
      assignee:assigned_to (
        id,
        name
      ),
      client:client_id (
        id,
        name
      )
    `)
    .eq('id', id)
    .single()

  if (error || !task) {
    notFound()
  }

  const typedTask = task as TaskRow

  const isAdmin = currentProfile.role === 'admin'
  const canView =
    isAdmin ||
    typedTask.created_by === currentProfile.id ||
    typedTask.assigned_to === currentProfile.id

  if (!canView) {
    notFound()
  }

  const creatorName = resolvePersonName(typedTask.creator, 'Neznámý uživatel')
  const assigneeName = resolvePersonName(typedTask.assignee, 'Nepřiřazeno')
  const clientName = resolveClientName(
    typedTask.client,
    typedTask.company_name ?? 'Bez klienta'
  )
  const canUpdateStatus =
    isAdmin ||
    typedTask.created_by === currentProfile.id ||
    typedTask.assigned_to === currentProfile.id

  const markTaskDoneAction = updateTaskStatus.bind(null, typedTask.id, 'done')

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2 lg:max-w-[calc(100%-24rem)]">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1
                  className="min-w-0 text-2xl font-semibold tracking-tight text-gray-900 lg:block lg:truncate"
                  title={typedTask.title}
                >
                  {typedTask.title}
                </h1>

                <span
                  className={`shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(typedTask.status)}`}
                >
                  {getStatusLabel(typedTask.status)}
                </span>

              </div>

              <p className="text-sm text-gray-500">
                Úkol vytvořen {formatDate(typedTask.created_at)}
              </p>
            </div>

            <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-nowrap sm:justify-end lg:w-[24rem]">
              {canUpdateStatus && typedTask.status !== 'done' ? (
                <form action={markTaskDoneAction}>
                  <button className="inline-flex whitespace-nowrap items-center justify-center rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-emerald-700 transition hover:bg-emerald-100">
                    DOKONČIT
                  </button>
                </form>
              ) : null}

              <Link
                href={`/tasks/${typedTask.id}/edit`}
                className="inline-flex whitespace-nowrap items-center justify-center rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:bg-gray-800"
              >
                UPRAVIT ÚKOL
              </Link>

              <Link
                href="/tasks"
                className="inline-flex whitespace-nowrap items-center justify-center rounded-2xl px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:opacity-90"
                style={{ backgroundColor: '#2980B9' }}
              >
                ZPĚT NA ÚKOLY
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
                  Přehled hlavních údajů o úkolu a jeho odpovědnosti.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <InfoCard label="Název úkolu" value={typedTask.title} />
                <InfoCard
                  label="Termín"
                  value={typedTask.due_date || 'Bez termínu'}
                />
                <InfoCard label="Přiřazeno" value={assigneeName} />
                <InfoCard label="Zadal" value={creatorName} />
                <InfoCard label="Klient" value={clientName} />
                <InfoCard
                  label="Kontaktní osoba"
                  value={typedTask.contact_person || '—'}
                />
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
                  Rychlý přehled toho nejdůležitějšího.
                </p>
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Stav
                  </p>
                  <p className="mt-2 text-sm font-medium text-gray-900">
                    {getStatusLabel(typedTask.status)}
                  </p>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Vytvořeno
                  </p>
                  <p className="mt-2 text-sm font-medium text-gray-900">
                    {formatDate(typedTask.created_at)}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-gray-900">
              Zadání úkolu
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Detailní popis, kontext a interní doplnění k úkolu.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-gray-50 p-5">
            {typedTask.note?.trim() ? (
              <p className="whitespace-pre-wrap text-sm leading-7 text-gray-700">
                {typedTask.note}
              </p>
            ) : (
              <p className="text-sm text-gray-500">
                Zatím bez doplněného zadání nebo poznámky.
              </p>
            )}
          </div>
        </section>

      </div>
    </main>
  )
}
