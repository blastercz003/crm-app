import { createClient } from '@/lib/supabase/server'
import { createTask } from '../actions'
import TaskForm from '../TaskForm'
import { getAssignableUsers } from '@/lib/users/getAssignableUsers'

type ClientOption = {
  id: string
  name: string
}

export default async function NewTaskPage() {
  const supabase = await createClient()
  const users = await getAssignableUsers()

  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, name')
    .order('name', { ascending: true })

  if (clientsError) {
    throw new Error('Nepodařilo se načíst klienty.')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              Nový úkol
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              Vytvoř nový úkol a přiřaď ho konkrétnímu uživateli. Úkol může být
              interní nebo navázaný na klienta.
            </p>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
            <TaskForm
              action={createTask}
              users={users}
              clients={(clients ?? []) as ClientOption[]}
              submitLabel="Vytvořit úkol"
            />
          </div>
        </div>
      </div>
    </div>
  )
}