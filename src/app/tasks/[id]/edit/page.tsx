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
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-2 lg:max-w-[calc(100%-24rem)]">
              <h1
                className="min-w-0 text-2xl font-semibold tracking-tight text-gray-900 lg:block lg:truncate"
                title={taskTitle}
              >
                {taskTitle}
              </h1>
              <p className="text-sm text-gray-500">
                Uprav zadání úkolu, prioritu, termín, odpovědnost i vazbu na klienta.
              </p>
            </div>

            <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-nowrap sm:justify-end lg:w-[24rem]">
              {canDelete ? (
                <form action={deleteTaskAction}>
                  <button
                    type="submit"
                    className="inline-flex whitespace-nowrap items-center justify-center rounded-2xl border border-red-200/90 bg-[linear-gradient(155deg,rgba(255,255,255,0.9)_0%,rgba(254,242,242,0.82)_100%)] px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-red-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(185,28,28,0.14)] transition duration-200 hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_11px_22px_rgba(185,28,28,0.2)]"
                  >
                    SMAZAT ÚKOL
                  </button>
                </form>
              ) : null}

              <Link
                href={`/tasks/${task.id}`}
                className="inline-flex whitespace-nowrap items-center justify-center rounded-2xl border border-zinc-900 bg-zinc-900 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.18),0_10px_22px_rgba(24,24,27,0.24)] transition duration-200 hover:-translate-y-[1px] hover:bg-gray-800"
              >
                DETAIL ÚKOLU
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

        <section className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-gray-900">
              Úprava úkolu
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Změň stav, termín, prioritu, přiřazení i obsah zadání.
            </p>
          </div>

          <div className="rounded-2xl border border-white/75 bg-[linear-gradient(155deg,rgba(255,255,255,0.88)_0%,rgba(238,242,247,0.8)_100%)] p-2 sm:p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_8px_18px_rgba(15,23,42,0.10)]">
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
