import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { createTask } from '../actions'
import TaskForm from '../TaskForm'
import { getAssignableUsers } from '@/lib/users/getAssignableUsers'

export const metadata: Metadata = {
  title: 'Nový úkol',
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

export default async function NewTaskPage() {
  const supabase = await createClient()
  const users = await getAssignableUsers()

  const [clientsResponse, contactsResponse] = await Promise.all([
    supabase.from('clients').select('id, name').order('name', { ascending: true }),
    supabase
      .from('client_contacts')
      .select('id, client_id, name, is_primary')
      .order('is_primary', { ascending: false })
      .order('name', { ascending: true }),
  ])

  const { data: clients, error: clientsError } = clientsResponse
  const { data: contacts, error: contactsError } = contactsResponse

  if (clientsError) {
    throw new Error('Nepodařilo se načíst klienty.')
  }

  if (contactsError) {
    throw new Error('Nepodařilo se načíst kontaktní osoby klientů.')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">
              Nový úkol
            </h1>
            <p className="mt-2 text-sm text-gray-500">
              Vytvoř nový úkol a přiřaď ho konkrétnímu uživateli. Úkol může být
              interní nebo navázaný na klienta.
            </p>
          </div>

          <div className="rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-8 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
            <TaskForm
              action={createTask}
              users={users}
              clients={(clients ?? []) as ClientOption[]}
              contacts={(contacts ?? []) as ClientContactOption[]}
              submitLabel="Vytvořit úkol"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
