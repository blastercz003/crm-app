import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/getCurrentProfile'
import { cleanTitlePart } from '@/lib/pageTitles'
import { endTaskRecurrence, updateTaskStatus } from '../actions'
import { TaskCompleteButton } from '../task-complete-button'
import { RepeatTaskBadge } from '../repeat-task-badge'
import {
  getPriorityBadgeClass,
  getPriorityLabel,
  getRepeatIntervalLabel,
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
  repeat_interval: string | null
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

export async function generateMetadata({
  params,
}: TaskDetailPageProps): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('tasks')
    .select('title')
    .eq('id', id)
    .maybeSingle<Pick<TaskRow, 'title'>>()

  const taskTitle = cleanTitlePart(data?.title)

  return {
    title: taskTitle ? `Úkol - ${taskTitle}` : 'Detail úkolu',
  }
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
    <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.10)]">
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
      repeat_interval,
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
  const endTaskRecurrenceAction = endTaskRecurrence.bind(null, typedTask.id)

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
            <div className="min-w-0 space-y-2 lg:max-w-[calc(100%-24rem)]">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1
                  className="min-w-0 text-2xl font-semibold tracking-tight text-gray-900 lg:block lg:truncate"
                  title={typedTask.title}
                >
                  {typedTask.title}
                </h1>

                <RepeatTaskBadge repeatInterval={typedTask.repeat_interval} />

              </div>

              <p className="text-sm text-gray-500">
                Úkol vytvořen {formatDate(typedTask.created_at)}
              </p>
            </div>

            <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-end lg:w-auto lg:flex-nowrap">
              {canUpdateStatus && typedTask.status !== 'done' ? (
                <>
                  {typedTask.repeat_interval ? (
                    <form action={endTaskRecurrenceAction}>
                      <button
                        type="submit"
                        className="inline-flex whitespace-nowrap items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]"
                      >
                        UKONČIT OPAKOVÁNÍ
                      </button>
                    </form>
                  ) : null}
                </>
              ) : null}

              <Link
                href={`/tasks/${typedTask.id}/edit`}
                className="inline-flex whitespace-nowrap items-center justify-center rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(241,245,249,0.84)_100%)] px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-zinc-800 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.1)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_10px_22px_rgba(15,23,42,0.14)]"
              >
                UPRAVIT ÚKOL
              </Link>

              <Link
                href="/tasks"
                className="inline-flex whitespace-nowrap items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)]"
              >
                ZPĚT NA ÚKOLY
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
                <InfoCard label="Název úkolu" value={typedTask.title} />
                <InfoCard
                  label="Termín"
                  value={typedTask.due_date || 'Bez termínu'}
                />
                <InfoCard label="Přiřazeno" value={assigneeName} />
                <InfoCard label="Zadal" value={creatorName} />
                <InfoCard label="Klient" value={clientName} />
                <InfoCard
                  label="Priorita"
                  value={getPriorityLabel(typedTask.priority)}
                />
                <InfoCard
                  label="Opakování"
                  value={getRepeatIntervalLabel(typedTask.repeat_interval)}
                />
                <InfoCard
                  label="Kontaktní osoba"
                  value={typedTask.contact_person || '—'}
                />
              </div>
            </div>
          </div>

          <div className="flex h-full flex-col justify-between gap-4 lg:col-span-1">
            <div className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
              <div className="mb-5">
                <h2 className="text-lg font-semibold text-gray-900">
                  Shrnutí
                </h2>
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.10)]">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Stav
                  </p>
                  <div className="mt-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(typedTask.status)}`}
                    >
                      {getStatusLabel(typedTask.status)}
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.10)]">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Priorita
                  </p>
                  <div className="mt-2">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${getPriorityBadgeClass(typedTask.priority)}`}
                    >
                      {getPriorityLabel(typedTask.priority)}
                    </span>
                  </div>
                </div>

                <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.10)]">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                    Vytvořeno
                  </p>
                  <p className="mt-2 text-sm font-medium text-gray-900">
                    {formatDate(typedTask.created_at)}
                  </p>
                </div>
              </div>

            </div>

            {canUpdateStatus && typedTask.status !== 'done' ? (
              <form action={markTaskDoneAction} className="mt-auto">
                <TaskCompleteButton className="inline-flex w-full items-center justify-center rounded-2xl border border-emerald-500/85 bg-[linear-gradient(155deg,#17a56f_0%,#0f9b68_100%)] px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.24),0_8px_16px_rgba(16,185,129,0.22)] transition duration-200 hover:-translate-y-[1px]" />
              </form>
            ) : null}
          </div>
        </section>

        <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-gray-900">
              Zadání úkolu
            </h2>
          </div>

          <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.10)]">
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
