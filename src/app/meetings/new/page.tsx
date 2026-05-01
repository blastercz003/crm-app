import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createMeeting } from '../actions'
import { MeetingForm } from '@/components/meetings/meeting-form'

export const metadata: Metadata = {
  title: 'Nová schůzka',
}

type ClientOption = {
  id: string
  name: string
}

type ClientContactOption = {
  id: string
  client_id: string
  name: string
  phone: string | null
  email: string | null
  is_primary: boolean
}

export default async function NewMeetingPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const [clientsResponse, contactsResponse] = await Promise.all([
    supabase.from('clients').select('id, name').order('name', { ascending: true }),
    supabase
      .from('client_contacts')
      .select('id, client_id, name, phone, email, is_primary')
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
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
              Nová schůzka
            </h1>
            <p className="text-sm text-gray-500">
              Naplánuj schůzku a případně ji napoj na klienta z databáze.
            </p>
          </div>
        </section>

        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
          <MeetingForm
            action={createMeeting}
            submitLabel="Uložit schůzku"
            cancelHref="/meetings"
            clients={(clients ?? []) as ClientOption[]}
            contacts={(contacts ?? []) as ClientContactOption[]}
          />
        </section>
      </div>
    </main>
  )
}
