import Link from 'next/link'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/getCurrentProfile'
import { getAssignableUsers } from '@/lib/users/getAssignableUsers'
import { cleanTitlePart } from '@/lib/pageTitles'
import TaskForm from '../../TaskForm'
import { updateTask, deleteTask } from '../../actions'

type EditTaskPageProps = {
  params: Promise<{
    id: string
  }>
}

type ClientOption = {
  id: string
  name: string
}

type ClientContactOption = {
  id: string
  client_id: string
  name: string
  is_primary: boolean
}

type TaskTitleRow = {
  title: string
}

export async function generateMetadata({
  params,
}: EditTaskPageProps): Promise<Metadata> {
  const { id } = await params
  const supabase = await createClient()
  const { data } = await supabase
    .from('tasks')
    .select('title')
    .eq('id', id)
    .maybeSingle<TaskTitleRow>()

  const taskTitle = cleanTitlePart(data?.title)

  return {
    title: taskTitle ? `Upravit úkol - ${taskTitle}` : 'Upravit úkol',
  }
}

export default async function EditTaskPage({ params }: EditTaskPageProps) {
  const { id } = await params
  const supabase = await createClient()
  const currentProfile = await getCurrentProfile()
  const users = await getAssignableUsers()

  const [taskResponse, clientsResponse, contactsResponse] = await Promise.all([
    supabase
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
        client_contact_id,
        company_name,
        contact_person
      `)
      .eq('id', id)
      .single(),
    supabase.from('clients').select('id, name').order('name', { ascending: true }),
    supabase
      .from('client_contacts')
      .select('id, client_id, name, is_primary')
      .order('is_primary', { ascending: false })
      .order('name', { ascending: true }),
  ])

  const { data: task, error } = taskResponse
  const { data: clients, error: clientsError } = clientsResponse
  const { data: contacts, error: contactsError } = contactsResponse

  if (error || !task) {
    notFound()
  }

  if (clientsError) {
    throw new Error('Nepodařilo se načíst klienty.')
  }

  if (contactsError) {
    throw new Error('Nepodařilo se načíst kontaktní osoby klientů.')
  }

  const isAdmin = currentProfile.role === 'admin'
  const canEdit =
    isAdmin ||
    task.created_by === currentProfile.id ||
    task.assigned_to === currentProfile.id

  if (!canEdit) {
    notFound()
  }

  const canDelete =
    isAdmin ||
    task.created_by === currentProfile.id ||
    task.assigned_to === currentProfile.id

  const taskTitle = task.title ?? 'Upravit úkol'

  const updateTaskAction = updateTask.bind(null, id)
  const deleteTaskAction = deleteTask.bind(null, id)

  return (
    <main className="tasks-page relative min-h-screen overflow-hidden bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <div
        aria-hidden
        className="clients-page__glow--right pointer-events-none absolute -right-20 top-16 h-72 w-72 rounded-full bg-[#9dc7e5]/25 blur-3xl"
      />
      <div
        aria-hidden
        className="clients-page__glow--left pointer-events-none absolute -left-24 bottom-20 h-80 w-80 rounded-full bg-white/55 blur-3xl"
      />
      <div className="relative z-10 mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="tasks-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <h1
                className="tasks-page__hero-title text-2xl font-semibold tracking-tight text-gray-900"
                title={taskTitle}
              >
                {taskTitle}
              </h1>
            </div>

            <div className="flex flex-row items-center gap-3 lg:justify-end">
              {canDelete ? (
                <form action={deleteTaskAction} className="shrink-0">
                  <button
                    type="submit"
                    className="clients-modal__delete inline-flex whitespace-nowrap items-center justify-center rounded-2xl border border-red-500/85 bg-[linear-gradient(155deg,#ef4444_0%,#dc2626_100%)] px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_10px_22px_rgba(220,38,38,0.24)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_14px_28px_rgba(220,38,38,0.3)]"
                  >
                    SMAZAT ÚKOL
                  </button>
                </form>
              ) : null}

              <Link
                href={`/tasks/${task.id}`}
                className="tasks-page__action-detail inline-flex shrink-0 whitespace-nowrap items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800"
              >
                DETAIL ÚKOLU
              </Link>

              <Link
                href="/tasks"
                className="clients-page__back-button inline-flex shrink-0 whitespace-nowrap items-center justify-center rounded-2xl border border-[#76a9d3]/85 bg-[linear-gradient(155deg,#4f92cb_0%,#3a7eb8_55%,#2b679a_100%)] px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.34),0_14px_28px_rgba(24,78,129,0.34)] transition duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_18px_32px_rgba(24,78,129,0.4)]"
              >
                ZPĚT NA ÚKOLY
              </Link>
            </div>
          </div>
        </section>

        <section className="tasks-page__content rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="mb-5">
            <h2 className="tasks-page__section-title text-lg font-semibold text-gray-900">
              Úprava úkolu
            </h2>
          </div>

          <div className="tasks-page__section rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] p-2 sm:p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.10)]">
            <TaskForm
              action={updateTaskAction}
              users={users}
              clients={(clients ?? []) as ClientOption[]}
              contacts={(contacts ?? []) as ClientContactOption[]}
              submitLabel="ULOŽIT ZMĚNY"
              initialValues={{
                title: task.title,
                note: task.note,
                due_date: task.due_date,
                status: task.status,
                priority: task.priority,
                repeat_interval: task.repeat_interval,
                assigned_to: task.assigned_to,
                client_id: task.client_id,
                client_contact_id: task.client_contact_id,
                company_name: task.company_name,
                contact_person: task.contact_person,
              }}
              cancelHref={`/tasks/${task.id}`}
              cancelLabel="ZRUŠIT ÚPRAVY"
            />
          </div>
        </section>
      </div>
    </main>
  )
}
