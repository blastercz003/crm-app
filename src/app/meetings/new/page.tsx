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
    <main className="meetings-page min-h-screen bg-[linear-gradient(160deg,#f8fafc_0%,#eef3f8_50%,#e9f0f7_100%)]">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="meetings-page__hero rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
          <div className="space-y-1">
            <h1 className="meetings-page__title text-2xl font-semibold tracking-tight text-gray-900">
              Nová schůzka
            </h1>
            <p className="meetings-page__text text-sm text-gray-500">
              Naplánuj schůzku a případně ji napoj na klienta z databáze.
            </p>
          </div>
        </section>

        <section className="meetings-page__panel rounded-3xl border border-white/70 bg-[linear-gradient(155deg,rgba(255,255,255,0.96)_0%,rgba(248,250,252,0.92)_48%,rgba(241,245,249,0.88)_100%)] p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_20px_44px_rgba(15,23,42,0.12)] backdrop-blur-[10px]">
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
