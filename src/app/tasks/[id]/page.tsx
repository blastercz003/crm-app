import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/getCurrentProfile'
import CommentSection from '@/components/comments/comment-section'
import {
  getPriorityBadgeClass,
  getPriorityLabel,
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

  return (
    <main className="min-h-screen bg-zinc-100 px-6 py-6 text-zinc-900 md:px-10 md:py-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <section className="overflow-hidden rounded-[28px] border border-zinc-200 bg-white shadow-sm">
          <div className="flex flex-col gap-6 p-6 md:p-8 lg:flex-row lg:items-start lg:justify-between lg:p-10">
            <div>
              <Link
                href="/tasks"
                className="inline-flex items-center rounded-2xl border px-5 py-3 text-sm font-medium tracking-wide transition hover:opacity-90"
                style={{
                  borderColor: '#BFD9EC',
                  backgroundColor: '#EAF4FB',
                  color: '#2980B9',
                }}
              >
                ZPĚT NA ÚKOLY
              </Link>

              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950">
                {typedTask.title}
              </h1>

              <p className="mt-2 max-w-2xl text-sm text-zinc-500">
                Detail úkolu včetně odpovědnosti, vazby na klienta a týmových
                komentářů.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${getStatusBadgeClass(typedTask.status)}`}
              >
                {getStatusLabel(typedTask.status)}
              </span>

              <span
                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${getPriorityBadgeClass(typedTask.priority)}`}
              >
                Priorita: {getPriorityLabel(typedTask.priority)}
              </span>

              <Link
                href={`/tasks/${typedTask.id}/edit`}
                className="inline-flex items-center rounded-2xl bg-zinc-900 px-5 py-3 text-sm font-medium tracking-wide text-white transition hover:bg-zinc-800"
              >
                UPRAVIT ÚKOL
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <div className="rounded-[28px] border border-zinc-200 bg-white p-6 shadow-sm md:p-8">
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-zinc-950">
                  Základní informace
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Přehled hlavních údajů o úkolu.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Název úkolu
                  </p>
                  <p className="mt-2 text-sm font-medium text-zinc-900">
                    {typedTask.title}
                  </p>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Termín
                  </p>
                  <p className="mt-2 text-sm font-medium text-zinc-900">
                    {typedTask.due_date || 'Bez termínu'}
                  </p>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Přiřazeno
                  </p>
                  <p className="mt-2 text-sm font-medium text-zinc-900">
                    {assigneeName}
                  </p>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Zadal
                  </p>
                  <p className="mt-2 text-sm font-medium text-zinc-900">
                    {creatorName}
                  </p>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Klient
                  </p>
                  <p className="mt-2 text-sm font-medium text-zinc-900">
                    {clientName}
                  </p>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Kontaktní osoba
                  </p>
                  <p className="mt-2 text-sm font-medium text-zinc-900">
                    {typedTask.contact_person || '—'}
                  </p>
                </div>

                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:col-span-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Vytvořeno
                  </p>
                  <p className="mt-2 text-sm font-medium text-zinc-900">
                    {formatDate(typedTask.created_at)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-1">
            <div className="rounded-[28px] border border-zinc-200 bg-white p-6 shadow-sm md:p-8">
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-zinc-950">
                  Poznámka
                </h2>
                <p className="mt-1 text-sm text-zinc-500">
                  Detailní interní zadání nebo doplnění k úkolu.
                </p>
              </div>

              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="whitespace-pre-wrap text-sm leading-6 text-zinc-700">
                  {typedTask.note || 'Zatím bez poznámky.'}
                </p>
              </div>
            </div>
          </div>
        </section>

        <CommentSection
          entityType="task"
          entityId={typedTask.id}
          path={`/tasks/${typedTask.id}`}
        />
      </div>
    </main>
  )
}