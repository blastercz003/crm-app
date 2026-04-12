import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentProfile } from '@/lib/auth/getCurrentProfile'
import { getAssignableUsers } from '@/lib/users/getAssignableUsers'
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

export default async function EditTaskPage({ params }: EditTaskPageProps) {
  const { id } = await params
  const supabase = await createClient()
  const currentProfile = await getCurrentProfile()
  const users = await getAssignableUsers()

  const [taskResponse, clientsResponse] = await Promise.all([
    supabase
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
        contact_person
      `)
      .eq('id', id)
      .single(),
    supabase.from('clients').select('id, name').order('name', { ascending: true }),
  ])

  const { data: task, error } = taskResponse
  const { data: clients, error: clientsError } = clientsResponse

  if (error || !task) {
    notFound()
  }

  if (clientsError) {
    throw new Error('Nepodařilo se načíst klienty.')
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

  async function updateTaskAction(formData: FormData) {
    'use server'
    await updateTask(id, formData)
  }

  async function deleteTaskAction() {
    'use server'
    await deleteTask(id)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <Link
                href={`/tasks/${task.id}`}
                className="text-sm text-gray-500 transition hover:text-gray-900"
              >
                ← Zpět na detail úkolu
              </Link>

              <h1 className="mt-3 text-3xl font-bold tracking-tight text-gray-900">
                Upravit úkol
              </h1>

              <p className="mt-2 text-sm text-gray-500">
                Můžeš změnit stav, prioritu, termín, poznámku, přiřazeného
                uživatele i vazbu na klienta.
              </p>
            </div>

            {canDelete ? (
              <form action={deleteTaskAction}>
                <button
                  type="submit"
                  className="inline-flex items-center rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-medium text-red-700 transition hover:bg-red-100"
                >
                  Smazat úkol
                </button>
              </form>
            ) : null}
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <TaskForm
              action={updateTaskAction}
              users={users}
              clients={(clients ?? []) as ClientOption[]}
              submitLabel="Uložit změny"
              initialValues={{
                title: task.title,
                note: task.note,
                due_date: task.due_date,
                status: task.status,
                priority: task.priority,
                assigned_to: task.assigned_to,
                client_id: task.client_id,
                company_name: task.company_name,
                contact_person: task.contact_person,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}