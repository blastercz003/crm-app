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
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
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
                    className="inline-flex whitespace-nowrap items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-red-700 transition hover:bg-red-100"
                  >
                    SMAZAT ÚKOL
                  </button>
                </form>
              ) : null}

              <Link
                href={`/tasks/${task.id}`}
                className="inline-flex whitespace-nowrap items-center justify-center rounded-2xl bg-gray-900 px-4 py-2.5 text-sm font-medium uppercase tracking-[0.04em] text-white transition hover:bg-gray-800"
              >
                DETAIL ÚKOLU
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

        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-5">
            <h2 className="text-lg font-semibold text-gray-900">
              Úprava úkolu
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Změň stav, termín, prioritu, přiřazení i obsah zadání.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-2 sm:p-3">
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
